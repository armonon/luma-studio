import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { releaseSourceId } from "./release-source-id.mjs";
import { acquireQualificationLock } from "./qualification-lock.mjs";
import { sampleQualificationHost, qualificationHostRefusal, qualifiedHostSamples } from "./qualification-host.mjs";
import { execFile } from "node:child_process";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { loadImage } from "@napi-rs/canvas";
import "../tests/canvas-harness.ts";
import { newCanvas, type Document } from "../app/engine/document.ts";
import { exceedsBrowserCanvas } from "../app/engine/large-documents.ts";
import { assertSafePhotoshopHeader, FILE_INPUT_LIMITS } from "../app/engine/input-limits.ts";
import { decodeLumaProject, encodeLumaProject } from "../app/engine/project.ts";
import { exportPhotoshopDocument, importPsd } from "../app/engine/psd.ts";
import { ingestRaw } from "../app/engine/raw.ts";
import { renderViewport } from "../app/engine/renderer.ts";
import { Studio } from "../app/engine/studio.ts";
import { classifyPhotoshopImport } from "./compatibility-corpus-policy.ts";
import { hasLayerMask } from "../app/engine/layer-mask.ts";

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
    sourceLayers?: number;
    minimumLayers?: number;
    allowFlattenedFallback?: boolean;
    rawMode?: "developed-raw" | "embedded-preview";
    maximumPsdMeanError?: number;
    referencePng?: string;
    maximumReferenceMeanError?: number;
    maximumWarnings?: number;
    maximumPeakRssMiB?: number;
    maximumDurationMs?: number;
  };
};
type CorpusManifest = { version: 1; sourceRoot?: string; cases: CorpusCase[] };
type CaseResult = {
  id: string;
  kind: CorpusKind;
  status: "pass" | "fail";
  durationMs: number;
  peakRssMiB: number;
  detail: string;
  metrics?: Record<string, number | string>;
};

const execFileAsync = promisify(execFile);
const WORKER_RESULT_PREFIX = "LUMA_CORPUS_RESULT=";

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
    caseIds: (value("--case") ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
    workerCase: value("--worker-case"),
    requiredKinds: (value("--require-kinds") ?? "psd,psb,raw")
      .split(",")
      .map((kind) => kind.trim())
      .filter(Boolean) as CorpusKind[],
  };
}

async function runCaseIsolated(manifest: string, entry: CorpusCase, signal: AbortSignal): Promise<CaseResult> {
  const started = process.hrtime.bigint();
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [
      "--import",
      "tsx",
      fileURLToPath(import.meta.url),
      "--manifest",
      manifest,
      "--worker-case",
      entry.id,
      ...(process.argv.includes("--source-backed") ? ["--source-backed"] : []),
    ], {
      cwd: process.cwd(),
      maxBuffer: 10 * 1024 * 1024,
      // Keep a small process-start allowance; the worker still enforces the
      // original workflow duration threshold. Never let a 120s case run 10min.
      timeout: Math.min(10 * 60 * 1000, (entry.expected?.maximumDurationMs ?? 595_000) + 5_000),
      signal,
    });
    if (stderr.trim()) process.stderr.write(stderr);
    const encoded = stdout.split(/\r?\n/).findLast((line) => line.startsWith(WORKER_RESULT_PREFIX));
    if (!encoded) throw new Error("corpus worker exited without a result");
    return JSON.parse(encoded.slice(WORKER_RESULT_PREFIX.length)) as CaseResult;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      id: entry.id,
      kind: entry.kind,
      status: "fail",
      durationMs: elapsedMs(started),
      peakRssMiB: 0,
      detail: `isolated corpus worker failed: ${detail}`,
    };
  }
}

function elapsedMs(started: bigint) {
  return Number(process.hrtime.bigint() - started) / 1_000_000;
}

function peakRssMiB() {
  return Number((process.resourceUsage().maxRSS / 1024).toFixed(1));
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
    if (entry.expected?.outcome !== "reject") {
      if (!entry.expected || !Number.isInteger(entry.expected.width) || !Number.isInteger(entry.expected.height)) {
        throw new Error(`Corpus case ${entry.id} must declare expected width and height`);
      }
      if (!Number.isFinite(entry.expected.maximumPeakRssMiB) || (entry.expected.maximumPeakRssMiB ?? 0) <= 0 ||
          !Number.isFinite(entry.expected.maximumDurationMs) || (entry.expected.maximumDurationMs ?? 0) <= 0) {
        throw new Error(`Corpus case ${entry.id} must declare peak-RAM and duration ceilings`);
      }
      if (entry.kind !== "raw") {
        if (!Number.isInteger(entry.expected.sourceLayers) || (entry.expected.sourceLayers ?? -1) < 0) {
          throw new Error(`Corpus case ${entry.id} must declare the source Photoshop layer count`);
        }
        if ((entry.expected.sourceLayers ?? 0) > 0 && entry.expected.minimumLayers === undefined && !entry.expected.allowFlattenedFallback) {
          throw new Error(`Corpus case ${entry.id} must require editable layers or explicitly declare a flattened fallback`);
        }
      }
    }
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

async function referencePreview(root: string, file: string, width: number, height: number) {
  const path = safeCasePath(root, file);
  const image = await loadImage(await readFile(path));
  const canvas = newCanvas(width, height);
  canvas.getContext("2d")!.drawImage(image as unknown as CanvasImageSource, 0, 0, width, height);
  return canvas.getContext("2d")!.getImageData(0, 0, width, height).data;
}

function applyCorpusEdit(doc: Document) {
  const layer = doc.layers.find((candidate) => candidate.kind !== "group") ?? doc.layers[0];
  if (!layer) throw new Error("document has no editable layer");
  layer.opacity = layer.opacity > 0.98 ? 0.97 : Math.min(1, layer.opacity + 0.01);
}

function assertLayerStructure(before: Document, after: Document, stage: string) {
  const shape = (doc: Document) => doc.layers.map(layer => ({
    name: layer.name, kind: layer.kind,
    parent: layer.parentId ? doc.layers.findIndex(parent => parent.id === layer.parentId) : -1,
    mask: hasLayerMask(layer),
  }));
  if (JSON.stringify(shape(before)) !== JSON.stringify(shape(after))) throw new Error(`${stage} changed layer names, types, hierarchy or masks`);
  for (let i = 0; i < before.layers.length; i++) {
    if (Math.abs(before.layers[i].opacity - after.layers[i].opacity) > 1 / 255 + 1e-9) throw new Error(`${stage} lost the layer-opacity edit`);
  }
}

async function runPhotoshop(root: string, entry: CorpusCase, bytes: ArrayBuffer, metrics: Record<string, number | string>): Promise<Record<string, number | string>> {
  const sample = (stage: string) => {
    const memory = process.memoryUsage();
    metrics.lastCompletedStage = stage;
    for (const key of ["rss", "external", "arrayBuffers", "heapUsed"] as const) metrics[`${stage}.${key}MiB`] = Math.round(memory[key] / 1024 / 1024 * 10) / 10;
    metrics[`${stage}.peakRssMiB`] = peakRssMiB();
  };
  sample("input");
  const header = assertSafePhotoshopHeader(bytes, entry.file, exceedsBrowserCanvas, { allowFlattenedFallback: true });
  if (header.container !== entry.kind) throw new Error(`container is ${header.container}, manifest says ${entry.kind}`);
  if (entry.expected?.sourceLayers !== header.layers) throw new Error(`source has ${header.layers} layers, manifest expects ${entry.expected?.sourceLayers}`);
  const forceSourceBacked = process.argv.includes("--source-backed");
  const opened = await importPsd(bytes, forceSourceBacked ? { sourceBacked: true } : {});
  const sourceBacked = opened.layers.some(layer => layer.surface?.store.sourceState());
  metrics.storage = sourceBacked ? "compressed-source-backed" : "default";
  sample("import");
  assertExpectedDimensions(entry, opened);
  const importMode = classifyPhotoshopImport({
    sourceLayers: header.layers,
    openedLayers: opened.layers.length,
    minimumLayers: entry.expected?.minimumLayers,
    allowFlattenedFallback: entry.expected?.allowFlattenedFallback,
  });
  const openedPreview = preview(opened);
  let referenceMeanError: number | undefined;
  if (entry.expected?.referencePng) {
    const scale = Math.min(192 / opened.width, 192 / opened.height, 1);
    const reference = await referencePreview(root, entry.expected.referencePng,
      Math.max(1, Math.round(opened.width * scale)), Math.max(1, Math.round(opened.height * scale)));
    referenceMeanError = meanAbsoluteError(openedPreview, reference);
    const maximum = entry.expected.maximumReferenceMeanError ?? 3;
    if (referenceMeanError > maximum) throw new Error(`Photoshop reference mean error ${referenceMeanError.toFixed(3)} exceeds ${maximum}`);
  }
  applyCorpusEdit(opened);
  const paintedIndex = sourceBacked ? opened.layers.reduce((best, layer, index) => {
    if (!layer.surface?.store.sourceState()) return best;
    return best < 0 || layer.surface.grid.totalTiles > opened.layers[best].surface!.grid.totalTiles ? index : best;
  }, -1) : -1;
  if (paintedIndex >= 0) {
    const surface = opened.layers[paintedIndex].surface!;
    surface.writePixel(0, 0, [1, 0, 0, 1]);
    metrics.editedSourceTiles = surface.stats().residentTiles;
  }
  const assertPixelEdit = (document: Document, stage: string) => {
    if (paintedIndex >= 0 && document.layers[paintedIndex].surface?.readPixel(0, 0).join(",") !== "1,0,0,1") throw new Error(`${stage} lost the source-backed pixel edit`);
  };
  const importPeakRssMiB = peakRssMiB();

  const native = await encodeLumaProject(opened, [], entry.id);
  sample("nativeEncode");
  const reopenedNative = await decodeLumaProject(native);
  sample("nativeDecode");
  assertExpectedDimensions(entry, reopenedNative.doc);
  assertLayerStructure(opened, reopenedNative.doc, "Native reopen");
  assertPixelEdit(reopenedNative.doc, "Native reopen");
  const nativeError = meanAbsoluteError(preview(opened), preview(reopenedNative.doc));
  if (nativeError !== 0) throw new Error(`native save/reopen preview drifted by ${nativeError.toFixed(3)} levels`);
  const nativeRoundTripPeakRssMiB = peakRssMiB();

  const exported = exportPhotoshopDocument(reopenedNative.doc, { format: entry.kind });
  sample("photoshopExport");
  const photoshopExportPeakRssMiB = peakRssMiB();
  const warningCount = exported.report.issues.filter((issue) => issue.severity === "warning").length;
  if (entry.expected?.maximumWarnings !== undefined && warningCount > entry.expected.maximumWarnings) {
    throw new Error(`${warningCount} Photoshop warnings, allowed ${entry.expected.maximumWarnings}`);
  }
  const reopenedPhotoshop = await importPsd(exported.buffer, sourceBacked ? { sourceBacked: true } : {});
  sample("photoshopReopen");
  assertExpectedDimensions(entry, reopenedPhotoshop);
  assertLayerStructure(reopenedNative.doc, reopenedPhotoshop, "Photoshop reopen");
  assertPixelEdit(reopenedPhotoshop, "Photoshop reopen");
  const psdError = meanAbsoluteError(preview(reopenedNative.doc), preview(reopenedPhotoshop));
  const maximum = entry.expected?.maximumPsdMeanError ?? 3;
  if (psdError > maximum) throw new Error(`Photoshop round-trip mean error ${psdError.toFixed(3)} exceeds ${maximum}`);
  return Object.assign(metrics, {
    width: opened.width,
    height: opened.height,
    sourceLayers: header.layers,
    layers: opened.layers.length,
    importMode,
    reference: entry.expected?.referencePng ? "photoshop-golden" : "self-roundtrip-only",
    ...(referenceMeanError === undefined ? {} : { referenceMeanError: Number(referenceMeanError.toFixed(4)) }),
    warnings: warningCount,
    nativeMeanError: nativeError,
    photoshopMeanError: Number(psdError.toFixed(4)),
    importPeakRssMiB,
    nativeRoundTripPeakRssMiB,
    photoshopExportPeakRssMiB,
    photoshopReopenPeakRssMiB: peakRssMiB(),
  });
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
  const started = process.hrtime.bigint();
  let inputReady = false;
  const metrics: Record<string, number | string> = {};
  try {
    const path = safeCasePath(root, entry.file);
    const metadata = await stat(path);
    const limit = entry.kind === "raw" ? FILE_INPUT_LIMITS.rawBytes : FILE_INPUT_LIMITS.photoshopBytes;
    if (!metadata.isFile() || metadata.size < 1 || metadata.size > limit) throw new Error(`file is outside the 1..${Math.round(limit / 1024 / 1024)} MB bound`);
    const source = await readFile(path);
    metrics.inputSha256 = createHash("sha256").update(source).digest("hex");
    metrics.inputBytes = source.byteLength;
    const bytes = source.byteOffset === 0 && source.byteLength === source.buffer.byteLength
      ? source.buffer as ArrayBuffer
      : source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength) as ArrayBuffer;
    inputReady = true;
    Object.assign(metrics, entry.kind === "raw" ? await runRaw(entry, bytes) : await runPhotoshop(root, entry, bytes, metrics));
    if (entry.expected?.outcome === "reject") {
      return {
        id: entry.id,
        kind: entry.kind,
        status: "fail",
        durationMs: elapsedMs(started),
        peakRssMiB: peakRssMiB(),
        detail: "unsafe input was accepted",
        metrics,
      };
    }
    const durationMs = elapsedMs(started);
    const rss = peakRssMiB();
    if (durationMs > (entry.expected?.maximumDurationMs ?? Number.POSITIVE_INFINITY)) {
      throw new Error(`duration ${durationMs.toFixed(0)} ms exceeds ${entry.expected?.maximumDurationMs} ms`);
    }
    if (rss > (entry.expected?.maximumPeakRssMiB ?? Number.POSITIVE_INFINITY)) {
      throw new Error(`peak RSS ${rss.toFixed(1)} MiB exceeds ${entry.expected?.maximumPeakRssMiB} MiB`);
    }
    const fallback = metrics.importMode === "flattened-fallback" ? " with declared flattened fallback" : "";
    return { id: entry.id, kind: entry.kind, status: "pass", durationMs, peakRssMiB: rss, detail: `workflow passed${fallback}`, metrics };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (inputReady && entry.expected?.outcome === "reject") {
      const pattern = entry.expected.errorPattern ? new RegExp(entry.expected.errorPattern, "i") : null;
      if (!pattern || pattern.test(message)) {
        return { id: entry.id, kind: entry.kind, status: "pass", durationMs: elapsedMs(started), peakRssMiB: peakRssMiB(), detail: `safely rejected: ${message}`, metrics };
      }
    }
    return { id: entry.id, kind: entry.kind, status: "fail", durationMs: elapsedMs(started), peakRssMiB: peakRssMiB(), detail: message, metrics };
  }
}

async function main() {
  const options = parseArgs();
  const manifestBytes = await readFile(options.manifest);
  const manifestSha256 = createHash("sha256").update(manifestBytes).digest("hex");
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as unknown;
  assertManifest(manifest);
  const root = manifest.sourceRoot
    ? resolve(dirname(options.manifest), manifest.sourceRoot)
    : dirname(options.manifest);
  if (options.workerCase) {
    const entry = manifest.cases.find((candidate) => candidate.id === options.workerCase);
    if (!entry) throw new Error(`Corpus worker case not found: ${options.workerCase}`);
    const result = await runCase(root, entry);
    console.log(`${WORKER_RESULT_PREFIX}${JSON.stringify(result)}`);
    return;
  }
  const selectedIds = new Set(options.caseIds);
  const cases = selectedIds.size
    ? manifest.cases.filter((entry) => selectedIds.has(entry.id))
    : manifest.cases;
  if (selectedIds.size) {
    const missing = [...selectedIds].filter((id) => !cases.some((entry) => entry.id === id));
    if (missing.length) throw new Error(`Corpus case${missing.length === 1 ? "" : "s"} not found: ${missing.join(", ")}`);
  }
  if (!Number.isInteger(options.minimum) || options.minimum < 1 || cases.length < options.minimum) {
    throw new Error(`Corpus run has ${cases.length} cases; this gate requires at least ${options.minimum}`);
  }
  const kinds = new Set(cases.map((entry) => entry.kind));
  for (const kind of options.requiredKinds) {
    if (!["psd", "psb", "raw"].includes(kind)) throw new Error(`Unknown required corpus kind: ${kind}`);
    if (!kinds.has(kind)) throw new Error(`Corpus is missing ${kind.toUpperCase()} coverage`);
  }
  const releaseLock = acquireQualificationLock("Compatibility corpus");
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.once("SIGINT", interrupt); process.once("SIGTERM", interrupt);
  try {
    const results: CaseResult[] = [];
    const hostSamples: ReturnType<typeof sampleQualificationHost>[] = [];
    let environmentBlock: string | null = null;
    const recordHost = () => {
      const sample = sampleQualificationHost();
      hostSamples.push(sample);
      environmentBlock ??= qualificationHostRefusal(sample);
    };
    recordHost();
    const sourceSha256 = releaseSourceId();
    await mkdir(dirname(options.report), { recursive: true });
    const checkpoint = async (completed: boolean) => {
      const manifestUnchanged = createHash("sha256").update(await readFile(options.manifest)).digest("hex") === manifestSha256;
      const report = {
        sourceSha256, unchanged: releaseSourceId() === sourceSha256,
        manifestSha256, manifestUnchanged,
        completed, interrupted: controller.signal.aborted,
        environmentQualified: !environmentBlock && qualifiedHostSamples(hostSamples),
        environmentBlock, hostSamples,
        generatedAt: new Date().toISOString(), manifest: options.manifest,
        total: cases.length, executed: results.length,
        passed: results.filter(result => result.status === "pass").length,
        failed: results.filter(result => result.status === "fail").length, results,
      };
      const pending = `${options.report}.pending-${process.pid}`;
      await writeFile(pending, `${JSON.stringify(report, null, 2)}\n`);
      await rename(pending, options.report);
      return report;
    };
    await checkpoint(false);
    for (const entry of cases) {
      if (controller.signal.aborted) break;
      recordHost();
      if (environmentBlock) break;
      if (releaseSourceId() !== sourceSha256) throw new Error("Source changed during corpus qualification; rerun against a frozen candidate.");
      if (createHash("sha256").update(await readFile(options.manifest)).digest("hex") !== manifestSha256) throw new Error("Manifest changed during corpus qualification; do not mix fixture expectations.");
      // Sample throughout the worker, not just after it has released its memory.
      // CPU pressure invalidates timing evidence but does not erase fidelity results.
      const sampler = setInterval(recordHost, 2000);
      let result: CaseResult;
      try { result = await runCaseIsolated(options.manifest, entry, controller.signal); }
      finally { clearInterval(sampler); recordHost(); }
      results.push(result);
      console.log(`${result.status === "pass" ? "PASS" : "FAIL"} ${entry.id}: ${result.detail}`);
      await checkpoint(false);
      if (environmentBlock) break;
    }
    const report = await checkpoint(!controller.signal.aborted && !environmentBlock && results.length === cases.length);
    if (environmentBlock) console.error(`BLOCKED: ${environmentBlock}`);
    if (!report.unchanged || !report.manifestUnchanged || !report.completed || !report.environmentQualified || report.failed) process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", interrupt); process.removeListener("SIGTERM", interrupt);
    releaseLock();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
