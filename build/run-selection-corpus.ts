// Offline evidence campaign. This does NOT synthesize annotations or run either
// application's selection tools. Inputs must be retained from matched jobs.
import { readFile, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { createHash } from "node:crypto";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { inspectRasterHeader } from "../app/engine/input-limits";
import { evaluateSelectionPair, selectionEvidenceGate, REQUIRED_SELECTION_CATEGORIES } from "./selection-accuracy";
import { releaseSourceId } from "./release-source-id.mjs";

type Case = { id: string; category: string; image: string; luma: string; photoshop: string; truth: string; protocol: string; independentAnnotation: boolean; real: boolean };
const [manifestPath, reportPath] = process.argv.slice(2);
if (!manifestPath || !reportPath) throw new Error("Usage: npx tsx build/run-selection-corpus.ts manifest.json report.json");
if ((await stat(manifestPath)).size > 1024 * 1024) throw new Error("Selection manifest exceeds 1 MiB");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (manifest.schema !== "luma/selection-corpus@1" || !Array.isArray(manifest.cases) || manifest.cases.length > 200 || typeof manifest.photoshopVersion !== "string" || !manifest.photoshopVersion.trim()) throw new Error("Expected selection-corpus@1, an identified Photoshop version, and at most 200 cases");
const root = await realpath(dirname(resolve(manifestPath)));
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
async function artifact(path: string, limit = 32 * 1024 * 1024) {
  if (typeof path !== "string" || !path.trim() || isAbsolute(path)) throw new Error("Artifact paths must be relative to the manifest");
  const full = await realpath(resolve(root, path));
  const rel = relative(root, full);
  if (rel.startsWith("..") || isAbsolute(rel) || (await stat(full)).size > limit) throw new Error("Artifact escapes corpus root or exceeds its byte limit");
  return readFile(full);
}
async function mask(path: string, width: number, height: number) {
  const bytes = await artifact(path);
  const header = inspectRasterHeader(bytes);
  if (!header || header.format !== "png" || header.width !== width || header.height !== height) throw new Error("Mask must be a dimension-matched opaque grayscale PNG");
  const image = await loadImage(bytes);
  const canvas = createCanvas(width, height), context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  const rgba = context.getImageData(0, 0, width, height).data, alpha = new Uint8Array(width * height);
  for (let p = 0; p < alpha.length; p++) {
    const i = p * 4;
    if (rgba[i + 3] !== 255 || rgba[i] !== rgba[i + 1] || rgba[i] !== rgba[i + 2]) throw new Error("Mask must encode coverage as opaque grayscale, not ambiguous RGB/transparency");
    alpha[p] = rgba[i];
  }
  return { mask: { width, height, alpha }, sha256: hash(bytes) };
}
const results = [], evidence = [], ids = new Set<string>();
for (const item of manifest.cases as Case[]) {
  try {
    if (!item || typeof item.id !== "string" || !item.id.trim() || ids.has(item.id) || !REQUIRED_SELECTION_CATEGORIES.includes(item.category as typeof REQUIRED_SELECTION_CATEGORIES[number])) throw new Error("Invalid/duplicate case ID or unsupported category");
    ids.add(item.id);
    const bytes = await artifact(item.image), header = inspectRasterHeader(bytes);
    if (!header || header.width * header.height > 4 * 1024 * 1024) throw new Error("Source image must have recognized dimensions of at most 4 MP");
    const protocol = await artifact(item.protocol, 64 * 1024);
    if (!new TextDecoder("utf-8", { fatal: true }).decode(protocol).trim()) throw new Error("Empty selection protocol");
    const luma = await mask(item.luma, header.width, header.height);
    const photoshop = await mask(item.photoshop, header.width, header.height);
    const truth = await mask(item.truth, header.width, header.height);
    const comparison = evaluateSelectionPair(luma.mask, photoshop.mask, truth.mask);
    const hashes = { image: hash(bytes), protocol: hash(protocol), luma: luma.sha256, photoshop: photoshop.sha256, truth: truth.sha256 };
    results.push({ id: item.id, category: item.category, hashes, ...comparison });
    evidence.push({ id: item.id, imageHash: hashes.image, category: item.category, real: item.real === true, groundTruth: item.independentAnnotation === true,
      photoshop: true, protocol: hashes.protocol, passed: comparison.passed });
  } catch (error) { results.push({ id: item?.id ?? "invalid", passed: false, error: error instanceof Error ? error.message : String(error) }); }
}
const gate = selectionEvidenceGate(evidence);
const qualified = gate.qualified && results.every(r => r.passed);
await writeFile(reportPath, JSON.stringify({ schema: "luma/selection-corpus-report@1", sourceSha256: releaseSourceId(), generatedAt: new Date().toISOString(), photoshopVersion: manifest.photoshopVersion,
  qualified, gate, cases: results, notice: "Offline mask evaluation, not native latency or product certification. Independent annotations, real-image declarations and application provenance require human review. Run matched workflow benchmarks separately." }, null, 2));
console.log(`${results.length} cases measured; ${qualified ? "declared selection gate passes" : "NOT QUALIFIED"}`);
if (!qualified) process.exitCode = 1;
