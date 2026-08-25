import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import "../tests/canvas-harness.ts";
import { newCanvas, type Document } from "../app/engine/document.ts";
import { exceedsBrowserCanvas } from "../app/engine/large-documents.ts";
import { assertSafePhotoshopHeader, FILE_INPUT_LIMITS } from "../app/engine/input-limits.ts";
import { decodeLumaProject, encodeLumaProject } from "../app/engine/project.ts";
import { exportPhotoshopDocument, importPsd } from "../app/engine/psd.ts";
import { ingestRaw } from "../app/engine/raw.ts";
import { renderViewport } from "../app/engine/renderer.ts";
import { Studio } from "../app/engine/studio.ts";

type CorpusKind = "psd" | "psb" | "raw";
type CorpusCase = {
  id: string;
  file: string;
  kind: CorpusKind;
  expected?: {
    outcome?: "pass" | "reject";
    errorPattern?: string;
    width?: number;
    height?: number;
    minimumLayers?: number;
    rawMode?: "developed-raw" | "embedded-preview";
    maximumPsdMeanError?: number;
    maximumWarnings?: number;
  };
};
type CorpusManifest = { version: 1; cases: CorpusCase[] };
type CaseResult = {
  id: string;
  kind: CorpusKind;
  status: "pass" | "fail";
  durationMs: number;
  detail: string;
  metrics?: Record<string, number | string>;
};

function parseArgs() {
  const args = process.argv.slice(2);
  const value = (flag: string) => {
    const index = args.indexOf(flag);
    return index < 0 ? undefined : args[index + 1];
  };
  return {
    manifest: resolve(value("--manifest") ?? "compatibility-corpus/manifest.json"),
    report: resolve(value("--report") ?? "artifacts/compatibility-corpus-report.json"),
    minimum: Number(value("--minimum") ?? 50),
  };
}

function assertManifest(value: unknown): asserts value is CorpusManifest {
  const manifest = value as Partial<CorpusManifest> | null;
  if (!manifest || manifest.version !== 1 || !Array.isArray(manifest.cases)) {
    throw new Error("Compatibility corpus manifest must have version 1 and a cases array");
  }
  const ids = new Set<string>();
  for (const entry of manifest.cases) {
    if (!entry || typeof entry.id !== "string" || !entry.id || ids.has(entry.id)) throw new Error("Corpus case ids must be non-empty and unique");
    if (!entry.file || !["psd", "psb", "raw"].includes(entry.kind)) throw new Error(`Corpus case ${entry.id} is malformed`);
    ids.add(entry.id);
  }
}

function safeCasePath(root: string, file: string) {
  if (isAbsolute(file)) throw new Error("Corpus paths must be relative to the manifest");
  const path = resolve(root, file);
  const escape = relative(root, path);
  if (escape.startsWith("..") || isAbsolute(escape)) throw new Error("Corpus path escapes the manifest directory");
  return path;
}

function assertExpectedDimensions(entry: CorpusCase, doc: Document) {
  const expected = entry.expected;
  if (expected?.width !== undefined && doc.width !== expected.width) throw new Error(`width ${doc.width}, expected ${expected.width}`);
  if (expected?.height !== undefined && doc.height !== expected.height) throw new Error(`height ${doc.height}, expected ${expected.height}`);
  if (expected?.minimumLayers !== undefined && doc.layers.length < expected.minimumLayers) {
    throw new Error(`${doc.layers.length} layers, expected at least ${expected.minimumLayers}`);
  }
}

function preview(doc: Document, edge = 192) {
  const scale = Math.min(edge / doc.width, edge / doc.height, 1);
  const width = Math.max(1, Math.round(doc.width * scale));
  const height = Math.max(1, Math.round(doc.height * scale));
  const canvas = newCanvas(width, height);
  renderViewport(doc, canvas, {
    x: 0, y: 0, width: doc.width, height: doc.height,
    zoom: scale, outputWidth: width, outputHeight: height,
    cssScale: 1, devicePixelRatio: 1,
  }, { checkerboard: false, selectionOverlay: false, proofing: false });
  return canvas.getContext("2d")!.getImageData(0, 0, width, height).data;
}

function meanAbsoluteError(a: Uint8ClampedArray, b: Uint8ClampedArray) {
  if (a.length !== b.length) return Number.POSITIVE_INFINITY;
  let total = 0;
  for (let index = 0; index < a.length; index += 1) total += Math.abs(a[index] - b[index]);
  return total / a.length;
}

function applyCorpusEdit(doc: Document) {
  const layer = doc.layers.find((candidate) => candidate.kind !== "group");
  if (!layer) throw new Error("document has no editable non-group layer");
  layer.opacity = layer.opacity > 0.98 ? 0.97 : Math.min(1, layer.opacity + 0.01);
}

async function runPhotoshop(entry: CorpusCase, bytes: ArrayBuffer): Promise<Record<string, number | string>> {
  const header = assertSafePhotoshopHeader(bytes, entry.file, exceedsBrowserCanvas);
  if (header.container !== entry.kind) throw new Error(`container is ${header.container}, manifest says ${entry.kind}`);
  const opened = await importPsd(bytes.slice(0));
  assertExpectedDimensions(entry, opened);
  applyCorpusEdit(opened);

  const native = await encodeLumaProject(opened, [], entry.id);
  const reopenedNative = await decodeLumaProject(native);
  assertExpectedDimensions(entry, reopenedNative.doc);
  const nativeError = meanAbsoluteError(preview(opened), preview(reopenedNative.doc));
  if (nativeError !== 0) throw new Error(`native save/reopen preview drifted by ${nativeError.toFixed(3)} levels`);

  const exported = exportPhotoshopDocument(reopenedNative.doc, { format: entry.kind });
  const warningCount = exported.report.issues.filter((issue) => issue.severity === "warning").length;
  if (entry.expected?.maximumWarnings !== undefined && warningCount > entry.expected.maximumWarnings) {
    throw new Error(`${warningCount} Photoshop warnings, allowed ${entry.expected.maximumWarnings}`);
  }
  const reopenedPhotoshop = await importPsd(exported.buffer.slice(0));
  assertExpectedDimensions(entry, reopenedPhotoshop);
  const psdError = meanAbsoluteError(preview(reopenedNative.doc), preview(reopenedPhotoshop));
  const maximum = entry.expected?.maximumPsdMeanError ?? 3;
  if (psdError > maximum) throw new Error(`Photoshop round-trip mean error ${psdError.toFixed(3)} exceeds ${maximum}`);
  return {
    width: opened.width,
    height: opened.height,
    layers: opened.layers.length,
    warnings: warningCount,
    nativeMeanError: nativeError,
    photoshopMeanError: Number(psdError.toFixed(4)),
  };
}

async function runRaw(entry: CorpusCase, bytes: ArrayBuffer): Promise<Record<string, number | string>> {
  const ingested = ingestRaw(bytes.slice(0), entry.file);
  if (entry.expected?.rawMode && ingested.kind !== entry.expected.rawMode) {
    throw new Error(`RAW mode ${ingested.kind}, expected ${entry.expected.rawMode}`);
  }
  if (ingested.kind === "embedded-preview") {
    if (ingested.preview.byteLength < 1024) throw new Error("embedded preview is implausibly small");
    return { mode: ingested.kind, previewBytes: ingested.preview.byteLength };
  }

  const studio = new Studio(ingested.developed.width, ingested.developed.height, newCanvas(1, 1));
  try {
    const layer = studio.openDevelopedDng(entry.id, bytes, ingested.developed);
    studio.redevelopRaw(layer.id, { exposureEV: ingested.developed.settings.exposureEV + 0.05 });
    const project = await studio.exportProject(entry.id);
    const reopened = new Studio(1, 1, newCanvas(1, 1));
    try {
      await reopened.importProject(project);
      const png = await reopened.exportImage("image/png");
      if (!png.size) throw new Error("RAW export produced an empty PNG");
      return {
        mode: ingested.kind,
        width: ingested.developed.width,
        height: ingested.developed.height,
        pngBytes: png.size,
      };
    } finally {
      reopened.dispose();
    }
  } finally {
    studio.dispose();
  }
}

async function runCase(root: string, entry: CorpusCase): Promise<CaseResult> {
  const started = performance.now();
  let inputReady = false;
  try {
    const path = safeCasePath(root, entry.file);
    const metadata = await stat(path);
    const limit = entry.kind === "raw" ? FILE_INPUT_LIMITS.rawBytes : FILE_INPUT_LIMITS.photoshopBytes;
    if (!metadata.isFile() || metadata.size < 1 || metadata.size > limit) throw new Error(`file is outside the 1..${Math.round(limit / 1024 / 1024)} MB bound`);
    const source = await readFile(path);
    const bytes = source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength) as ArrayBuffer;
    inputReady = true;
    const metrics = entry.kind === "raw" ? await runRaw(entry, bytes) : await runPhotoshop(entry, bytes);
    if (entry.expected?.outcome === "reject") {
      return {
        id: entry.id,
        kind: entry.kind,
        status: "fail",
        durationMs: performance.now() - started,
        detail: "unsafe input was accepted",
        metrics,
      };
    }
    return { id: entry.id, kind: entry.kind, status: "pass", durationMs: performance.now() - started, detail: "workflow passed", metrics };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (inputReady && entry.expected?.outcome === "reject") {
      const pattern = entry.expected.errorPattern ? new RegExp(entry.expected.errorPattern, "i") : null;
      if (!pattern || pattern.test(message)) {
        return { id: entry.id, kind: entry.kind, status: "pass", durationMs: performance.now() - started, detail: `safely rejected: ${message}` };
      }
    }
    return { id: entry.id, kind: entry.kind, status: "fail", durationMs: performance.now() - started, detail: message };
  }
}

async function main() {
  const options = parseArgs();
  const manifest = JSON.parse(await readFile(options.manifest, "utf8")) as unknown;
  assertManifest(manifest);
  if (!Number.isInteger(options.minimum) || options.minimum < 1 || manifest.cases.length < options.minimum) {
    throw new Error(`Corpus has ${manifest.cases.length} cases; this gate requires at least ${options.minimum}`);
  }
  const kinds = new Set(manifest.cases.map((entry) => entry.kind));
  for (const kind of ["psd", "psb", "raw"] as const) if (!kinds.has(kind)) throw new Error(`Corpus is missing ${kind.toUpperCase()} coverage`);

  const root = dirname(options.manifest);
  const results: CaseResult[] = [];
  for (const entry of manifest.cases) {
    const result = await runCase(root, entry);
    results.push(result);
    console.log(`${result.status === "pass" ? "PASS" : "FAIL"} ${entry.id}: ${result.detail}`);
  }
  const report = {
    generatedAt: new Date().toISOString(),
    manifest: options.manifest,
    total: results.length,
    passed: results.filter((result) => result.status === "pass").length,
    failed: results.filter((result) => result.status === "fail").length,
    results,
  };
  await mkdir(dirname(options.report), { recursive: true });
  await writeFile(options.report, `${JSON.stringify(report, null, 2)}\n`);
  if (report.failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
