import "../tests/canvas-harness.ts";
import { mkdir, mkdtemp, readFile, writeFile, copyFile, stat, readdir, rename, open } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, join, relative, isAbsolute } from "node:path";
import { loadImage } from "@napi-rs/canvas";
import { newCanvas, type Document } from "../app/engine/document.ts";
import { importPsd, exportPhotoshopDocument } from "../app/engine/psd.ts";
import { encodeLumaProject, decodeLumaProject } from "../app/engine/project.ts";
import { renderViewport } from "../app/engine/renderer.ts";
import { photoshopReference, type ExternalDocument } from "./photoshop-external-reference.ts";
import { BASELINE_FIDELITY_TOLERANCES, fidelityMetrics, withinFidelityTolerance } from "./fidelity-metrics.ts";
import { releaseSourceId } from "./release-source-id.mjs";
import { acquireQualificationLock } from "./qualification-lock.mjs";
import { sampleQualificationHost } from "./qualification-host.mjs";

async function hash(file: string) {
  const digest = createHash("sha256"); for await (const bytes of createReadStream(file)) digest.update(bytes); return digest.digest("hex");
}
async function image(file: string, width: number, height: number) {
  const source = await loadImage(await readFile(file));
  if (source.width !== width || source.height !== height) throw new Error("Reference render dimensions differ");
  const canvas = newCanvas(width, height), ctx = canvas.getContext("2d")!;
  try { ctx.drawImage(source as unknown as CanvasImageSource, 0, 0); return ctx.getImageData(0, 0, width, height).data; }
  finally { canvas.width = 1; canvas.height = 1; }
}
async function preview(doc: Document, file: string, width: number, height: number) {
  const canvas = newCanvas(width, height);
  try {
    renderViewport(doc, canvas, { x: 0, y: 0, width: doc.width, height: doc.height, zoom: width / doc.width, outputWidth: width, outputHeight: height, cssScale: 1, devicePixelRatio: 1 }, { checkerboard: false, selectionOverlay: false, proofing: false });
    const png = (canvas as unknown as { toBuffer(type: string): Buffer }).toBuffer("image/png");
    await writeFile(file, png, { flag: "wx" });
    return canvas.getContext("2d")!.getImageData(0, 0, width, height).data;
  } finally { canvas.width = 1; canvas.height = 1; }
}
export function structureDifferences(expected: ExternalDocument, actual: ExternalDocument) {
  const differences: string[] = [];
  if (expected.profileReadError || actual.profileReadError) differences.push("Color profile could not be independently inspected");
  for (const key of ["width", "height", "resolution", "depth", "profile", "mode"] as const) if (expected[key] !== actual[key]) differences.push(`Document ${key}: ${expected[key]} → ${actual[key]}`);
  if (JSON.stringify(expected.channels) !== JSON.stringify(actual.channels)) differences.push("Named channels differ");
  if (expected.layers.length !== actual.layers.length) differences.push(`Layer count: ${expected.layers.length} → ${actual.layers.length}`);
  for (const layer of expected.layers) {
    const other = actual.layers.find(candidate => candidate.path.join("/") === layer.path.join("/"));
    if (!other) { differences.push(`Missing layer at ${layer.path.join("/")}`); continue; }
    for (const key of ["name", "type", "kind", "visible", "blend", "clipping", "mask", "vectorMask", "text", "font"] as const) if (layer[key] !== other[key]) differences.push(`${layer.name}: ${key} differs`);
    if (Math.abs(layer.opacity - other.opacity) > 100 / 255 + 1e-6) differences.push(`${layer.name}: opacity differs`);
  }
  return differences;
}

async function main() {
  const args = process.argv.slice(2), value = (key: string) => args[args.indexOf(key) + 1];
  if (!args.includes("--case")) throw new Error("Choose retained private fixtures explicitly: --case private-ndw,private-sattari-music-psb");
  const selected = value("--case").split(","), manifestFile = resolve("compatibility-corpus/manifest.json");
  const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  const root = resolve("compatibility-corpus", manifest.sourceRoot ?? ".");
  const cases = selected.map(id => {
    const entry = manifest.cases.find((entry: { id: string }) => entry.id === id);
    if (!entry || !["psd", "psb"].includes(entry.kind) || !/^[a-z0-9-]+$/.test(id)) throw new Error(`Unknown Photoshop case: ${id}`);
    const file = resolve(root, entry.file), path = relative(root, file);
    if (path.startsWith("..") || isAbsolute(path)) throw new Error("Fixture escapes the declared source root");
    return { ...entry, file };
  });
  const unlock = acquireQualificationLock("Independent Photoshop baseline");
  try {
    await mkdir("artifacts", { recursive: true });
    const directory = await mkdtemp(resolve("artifacts/photoshop-external-"));
    const sourceSha256 = releaseSourceId(), manifestSha256 = await hash(manifestFile);
    const results: Array<Record<string, unknown>> = [];
    const checkpoint = async () => {
      const report = { version: 1, qualificationLevel: "preview-baseline", sourceSha256, unchanged: releaseSourceId() === sourceSha256, manifestSha256,
        manifestUnchanged: await hash(manifestFile) === manifestSha256, generatedAt: new Date().toISOString(),
        scope: "Retained private projects, real Photoshop import and external reopen. 512px visual baseline, not full-resolution or installed-Luma qualification. No performance-parity claim.",
        limitations: ["Headless Luma canvas: not native WKWebView text rendering", "Mask presence, not independent mask-plane fidelity", "Primary text font and contents, not every character style", "No full-resolution visual or color-chart comparison", "Photoshop process memory and input latency not measured"],
        tolerances: BASELINE_FIDELITY_TOLERANCES, total: cases.length, executed: results.length,
        completed: results.length === cases.length, passed: results.filter(r => r.status === "pass").length, results };
      await writeFile(join(directory, "report.json"), JSON.stringify(report, null, 2));
      const pending = resolve("artifacts/photoshop-external-report.pending.json");
      await writeFile(pending, JSON.stringify({ ...report, evidenceDirectory: relative(process.cwd(), directory) }, null, 2));
      await rename(pending, resolve("artifacts/photoshop-external-report.json"));
    };
    console.log(`Evidence: ${directory}`); await checkpoint();
    for (const entry of cases) {
      const started = performance.now(), host = sampleQualificationHost(), caseDir = join(directory, entry.id);
      await mkdir(caseDir);
      const result: Record<string, unknown> = { id: entry.id, kind: entry.kind, status: "fail", host };
      try {
        const metadata = await stat(entry.file);
        if (!metadata.isFile() || metadata.size > 256 * 1024 * 1024) throw new Error("This independent baseline accepts inputs up to 256 MiB; larger jobs need isolated-worker qualification");
        const inputSha256 = await hash(entry.file), input = join(caseDir, `source.${entry.kind}`);
        await copyFile(entry.file, input); result.inputSha256 = inputSha256;
        if (await hash(input) !== inputSha256) throw new Error("Input changed while making the private copy");
        // Admit actual header dimensions before asking another application to decode.
        const file = await open(input, "r"), header = Buffer.alloc(26);
        try {
          const { bytesRead } = await file.read(header, 0, header.length, 0);
          const h = header.readUInt32BE(14), w = header.readUInt32BE(18);
          if (bytesRead !== 26 || header.toString("ascii", 0, 4) !== "8BPS" ||
              ![1, 2].includes(header.readUInt16BE(4)) || !w || !h || w * h > 32_000_000 ||
              w !== entry.expected.width || h !== entry.expected.height) {
            throw new Error("External baseline requires valid, matching Photoshop dimensions up to 32 megapixels");
          }
        } finally { await file.close(); }
        const width = Math.max(1, Math.round(entry.expected.width * Math.min(1, 512 / Math.max(entry.expected.width, entry.expected.height))));
        const height = Math.max(1, Math.round(entry.expected.height * Math.min(1, 512 / Math.max(entry.expected.width, entry.expected.height))));
        result.stage = "external-original";
        const original = await photoshopReference(input, join(caseDir, "photoshop-original.png"), width, height);
        await writeFile(join(caseDir, "photoshop-original.json"), JSON.stringify(original, null, 2));
        result.application = original.application; result.version = original.version;
        result.stage = "luma-import";
        const buffer = await readFile(input), doc = await importPsd(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
        const imported = await preview(doc, join(caseDir, "luma-import.png"), width, height);
        result.importVisual = fidelityMetrics(imported, await image(join(caseDir, "photoshop-original.png"), width, height), width, height);
        const layer = doc.layers.find(layer => layer.kind !== "group");
        if (!layer) throw new Error("No editable layer for the declared opacity workflow");
        const externalTargets = original.layers.filter(candidate => candidate.name === layer.name && candidate.type !== "LayerSet");
        if (externalTargets.length !== 1) throw new Error("Edit target is missing or ambiguous in the external layer tree; requires a specific case recipe");
        layer.opacity = layer.opacity > .98 ? .97 : Math.min(1, layer.opacity + .01);
        const edit = { path: externalTargets[0].path, opacity: layer.opacity * 100 };
        result.edit = { ...edit, operation: "layer-opacity" };
        result.stage = "native-save-reopen";
        const archive = await encodeLumaProject(doc, [], entry.id);
        await writeFile(join(caseDir, "edited.luma"), new Uint8Array(await archive.arrayBuffer()), { flag: "wx" });
        const reopened = (await decodeLumaProject(archive)).doc;
        const edited = await preview(doc, join(caseDir, "luma-edited.png"), width, height);
        const native = await preview(reopened, join(caseDir, "luma-reopened.png"), width, height);
        result.nativeVisual = fidelityMetrics(edited, native, width, height);
        result.stage = "photoshop-expected-edit";
        const expected = await photoshopReference(input, join(caseDir, "photoshop-expected.png"), width, height, edit);
        await writeFile(join(caseDir, "photoshop-expected.json"), JSON.stringify(expected, null, 2));
        result.stage = "luma-export";
        const output = exportPhotoshopDocument(reopened, { format: entry.kind });
        result.deliveryIssues = output.report.issues;
        const exported = join(caseDir, `luma-output.${entry.kind}`);
        await writeFile(exported, new Uint8Array(output.buffer), { flag: "wx" });
        result.stage = "external-reopen";
        const actual = await photoshopReference(exported, join(caseDir, "photoshop-reopened.png"), width, height);
        await writeFile(join(caseDir, "photoshop-reopened.json"), JSON.stringify(actual, null, 2));
        const expectedPixels = await image(join(caseDir, "photoshop-expected.png"), width, height);
        const externalVisual = fidelityMetrics(expectedPixels, await image(join(caseDir, "photoshop-reopened.png"), width, height), width, height);
        const editingVisual = fidelityMetrics(edited, expectedPixels, width, height);
        const differences = structureDifferences(expected, actual);
        result.externalVisual = externalVisual; result.editingVisual = editingVisual; result.structuralDifferences = differences;
        result.status = withinFidelityTolerance(result.importVisual as ReturnType<typeof fidelityMetrics>) && withinFidelityTolerance(editingVisual) && withinFidelityTolerance(externalVisual) &&
          (result.nativeVisual as ReturnType<typeof fidelityMetrics>).maxDelta === 0 && !differences.length ? "pass" : "fail";
        result.stage = "complete";
        result.outputSha256 = await hash(exported);
        result.sourceUnchanged = await hash(entry.file) === inputSha256;
        if (!result.sourceUnchanged) result.status = "fail";
      } catch (error) { result.error = error instanceof Error ? error.message : String(error); }
      result.durationMs = performance.now() - started;
      result.engineProcessPeakRssMiB = process.resourceUsage().maxRSS / 1024;
      result.memoryScope = "Cumulative Luma engine harness peak only; Photoshop and WebView memory are not measured";
      result.artifacts = await Promise.all((await readdir(caseDir)).map(async file => ({ file: relative(process.cwd(), join(caseDir, file)), sha256: await hash(join(caseDir, file)) })));
      results.push(result); await checkpoint();
      console.log(`${String(result.status).toUpperCase()} ${entry.id}: ${result.error ?? result.stage}`);
    }
    if (results.some(result => result.status !== "pass") || releaseSourceId() !== sourceSha256) process.exitCode = 1;
  } finally { unlock(); }
}

if (process.argv[1]?.endsWith("qualify-photoshop-external.ts")) main().catch(error => { console.error(error); process.exitCode = 1; });
