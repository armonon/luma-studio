// Usage: npx tsx docs/release/check-native-artifact-history.mjs source.psb saved.luma
// Validates an actual native-written archive; does not certify Photoshop rendering.
import "../../tests/canvas-harness.ts";
import assert from "node:assert/strict";
import { readFile, stat, mkdtemp, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { Studio } from "../../app/engine/studio.ts";
import { testCanvas } from "../../tests/canvas-harness.ts";
import { releaseSourceId } from "../../build/release-source-id.mjs";

const inputs = process.argv.slice(2).map(value => resolve(value));
if (inputs.length !== 2 || !/\.ps[db]$/i.test(inputs[0]) || !/\.luma$/i.test(inputs[1])) throw new Error("Expected original PSD/PSB and native-written Luma archive");
for (const input of inputs) if ((await stat(input)).size > 256 * 1024 * 1024) throw new Error("Fixture exceeds 256 MiB diagnostic cap");
const sourceSha256 = releaseSourceId(), buffers = await Promise.all(inputs.map(input => readFile(input)));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const output = await mkdtemp(resolve("artifacts/native-artifact-history-"));
const original = new Studio(8, 8, testCanvas(1, 1)), saved = new Studio(8, 8, testCanvas(1, 1));
const report = { sourceSha256, harnessSha256: sha(await readFile(new URL(import.meta.url))), generatedAt: new Date().toISOString(), scope: "Native-written archive raster/history validation; not independent Photoshop visual fidelity", inputSha256: buffers.map(sha), pass: false };
try {
  const bytes = buffers[0];
  await original.importPsd(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  await saved.importProject(new Blob([buffers[1]]));
  assert.deepEqual([saved.doc.width, saved.doc.height], [original.doc.width, original.doc.height]);
  assert.deepEqual(saved.doc.layers.map(layer => [layer.name, layer.kind]), original.doc.layers.map(layer => [layer.name, layer.kind]));
  const rasterPixels = studio => studio.doc.layers.filter(layer => layer.bitmap).map(layer => sha(layer.bitmap.toDataURL("image/png")));
  const inputPixels = rasterPixels(original), savedPixels = rasterPixels(saved);
  assert.notDeepEqual(savedPixels, inputPixels, "The native artifact must contain an actual raster edit");
  const state = saved.historyState();
  let steps = 0;
  while (saved.historyState().currentDepth > 1) { saved.undo(); steps++; }
  assert.ok(steps > 0, "Restorable editing history is required");
  assert.deepEqual(rasterPixels(saved), inputPixels, "Undo must restore every original raster");
  for (let i = 0; i < steps; i++) saved.redo();
  assert.deepEqual(rasterPixels(saved), savedPixels, "Redo must restore every saved raster");
  Object.assign(report, { pass: true, dimensions: [saved.doc.width, saved.doc.height], layers: saved.doc.layers.length, editingSteps: steps, historyBytes: state.bytes, originalRasterHashes: inputPixels, savedRasterHashes: savedPixels });
} catch (error) {
  report.error = String(error); process.exitCode = 1;
} finally {
  saved.dispose(); original.dispose();
  report.unchanged = releaseSourceId() === sourceSha256;
  if (!report.unchanged) { report.pass = false; process.exitCode = 1; }
  await writeFile(resolve(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2), output);
}
