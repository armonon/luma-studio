// Explicit opt-in: downloads the same local SAM model used by the editor.
// Usage: npx tsx build/run-selection-pilot.ts image.jpg x y /tmp/result [photoshop.psd]
import { readFile, writeFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createCanvas, loadImage, type Canvas } from "@napi-rs/canvas";
import { readPsd, initializeCanvas } from "ag-psd";
import "../tests/canvas-harness.ts";
import { samPromptMask } from "../app/engine/neural.ts";
import { selectionMetrics, selectionEvidenceGate } from "./selection-accuracy.ts";
import { inspectRasterHeader, inspectPhotoshopHeader } from "../app/engine/input-limits.ts";

const [input, xArg, yArg, output, photoshop] = process.argv.slice(2);
if (!input || !output || !Number.isFinite(Number(xArg)) || !Number.isFinite(Number(yArg))) throw new Error("Usage: image.jpg x y output-prefix [photoshop.psd]");
if ((await stat(input)).size > 32 * 1024 * 1024) throw new Error("Pilot input exceeds 32 MiB");
const bytes = await readFile(input);
const header = inspectRasterHeader(bytes);
if (!header || header.width * header.height > 4 * 1024 * 1024) throw new Error("Pilot needs a recognized image of at most 4 MP");
const image = await loadImage(bytes);
if (image.width * image.height > 4 * 1024 * 1024) throw new Error("Pilot input exceeds 4 MP");
const scale = Math.min(1, 1024 / Math.max(image.width, image.height));
const source = createCanvas(Math.round(image.width * scale), Math.round(image.height * scale));
source.getContext("2d").drawImage(image, 0, 0, source.width, source.height);
const start = performance.now();
let last = "";
const mask = await samPromptMask(source as unknown as HTMLCanvasElement, [{ x: Number(xArg) * scale, y: Number(yArg) * scale }], (message) => {
  if (message !== last) { console.error(message); last = message; }
});
const inferenceMs = performance.now() - start;
const canvas = createCanvas(image.width, image.height);
canvas.getContext("2d").drawImage(mask as unknown as Canvas, 0, 0, image.width, image.height);
const rgba = canvas.getContext("2d").getImageData(0, 0, image.width, image.height).data;
const alpha = Uint8Array.from({ length: image.width * image.height }, (_, i) => rgba[i * 4 + 3]);
await writeFile(`${output}-luma.png`, canvas.toBuffer("image/png"));
let agreement = null;
let photoshopHash: string | null = null;
if (photoshop) {
  if ((await stat(photoshop)).size > 64 * 1024 * 1024) throw new Error("Pilot Photoshop file exceeds 64 MiB");
  initializeCanvas((w, h) => createCanvas(w, h) as unknown as HTMLCanvasElement);
  const psdBytes = await readFile(photoshop);
  photoshopHash = createHash("sha256").update(psdBytes).digest("hex");
  const psdHeader = inspectPhotoshopHeader(psdBytes);
  if (!psdHeader || psdHeader.width !== image.width || psdHeader.height !== image.height || psdHeader.layers > 8) throw new Error("Reference must match the source dimensions and contain at most 8 layers");
  const psd = readPsd(psdBytes, { useImageData: true, skipCompositeImageData: true });
  if (psd.width !== image.width || psd.height !== image.height) throw new Error("Photoshop document dimensions differ");
  const layer = psd.children?.find(layer => layer.mask?.imageData);
  if (!layer?.mask?.imageData) throw new Error("Photoshop PSD must contain a layer selection mask");
  const pm = layer.mask, data = pm.imageData!;
  const ref = new Uint8Array(image.width * image.height).fill(pm.defaultColor ?? 0);
  for (let y = 0; y < data.height; y++) for (let x = 0; x < data.width; x++) {
    const xx = x + (pm.left ?? 0), yy = y + (pm.top ?? 0);
    if (xx >= 0 && yy >= 0 && xx < image.width && yy < image.height) ref[yy * image.width + xx] = data.data[(y * data.width + x) * 4];
  }
  agreement = selectionMetrics({ width: image.width, height: image.height, alpha }, { width: image.width, height: image.height, alpha: ref });
}
const report = { input, imageHash: createHash("sha256").update(bytes).digest("hex"), width: image.width, height: image.height,
  model: "Xenova/slimsam-77-uniform", dtype: "q8", runtime: "Node CPU; not a native-webview latency measurement", prompt: { x: Number(xArg), y: Number(yArg) },
  inferenceMsIncludingColdLoad: inferenceMs, peakRssMiB: process.resourceUsage().maxRSS / 1024,
  photoshopReference: photoshop ?? null, photoshopHash, photoshopAgreement: agreement,
  pipelineSourceHash: createHash("sha256").update(await readFile(new URL("../app/engine/neural.ts", import.meta.url))).update(await readFile(new URL("../app/engine/smart-selection.ts", import.meta.url))).digest("hex"),
  caveat: "Single documentation sample, no independent ground truth. Agreement is not accuracy and cannot establish Photoshop parity.",
  qualification: selectionEvidenceGate([]) };
await writeFile(`${output}-report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
