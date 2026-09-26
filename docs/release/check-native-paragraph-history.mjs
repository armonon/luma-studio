// Validate a private archive written through the actual native Save As dialog.
// This tests file/history survival, not Photoshop pixel-rendering equivalence.
import "../../tests/canvas-harness.ts";
import assert from "node:assert/strict";
import { readFile, stat, mkdtemp, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { Studio } from "../../app/engine/studio.ts";
import { testCanvas } from "../../tests/canvas-harness.ts";
import { releaseSourceId } from "../../build/release-source-id.mjs";
import { acquireQualificationLock } from "../../build/qualification-lock.mjs";

const file = resolve(process.argv[2] ?? "artifacts/native-trust-pass8-gkRzYs/native-paragraph.luma");
if ((await stat(file)).size > 16 * 1024 * 1024) throw new Error("Diagnostic archive exceeds 16 MiB");
const release = acquireQualificationLock("Native paragraph history validation");
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const output = await mkdtemp(resolve("artifacts/native-paragraph-history-"));
const bytes = await readFile(file);
const report = { generatedAt: new Date().toISOString(), sourceSha256: releaseSourceId(),
  harnessSha256: sha(await readFile(new URL(import.meta.url))), input: file, inputSha256: sha(bytes),
  scope: "Native-written paragraph archive, editable model and persisted undo/redo; not external rendering", pass: false };
const studio = new Studio(8, 8, testCanvas(1, 1));
try {
  await studio.importProject(new Blob([bytes]));
  const saved = studio.doc.layers.find(layer => layer.kind === "text");
  assert.ok(saved?.text);
  const expected = "Professional proof requires editable text, wrapping, and reliable delivery.\nNative desktop save and reopen verified.";
  assert.equal(saved.text.text, expected);
  assert.deepEqual([studio.doc.width, studio.doc.height, studio.doc.layers.length], [600, 400, 2]);
  assert.deepEqual([saved.text.layout, saved.text.frameOrigin, saved.text.boxWidth, saved.text.boxHeight], ["paragraph", "top", 300, 250]);
  const savedModel = JSON.stringify(saved.text), currentDepth = studio.historyState().currentDepth;
  assert.ok(currentDepth > 1, "The native save must persist editing history");
  let undoSteps = 0;
  while (studio.canUndo()) {
    assert.ok(undoSteps < 500, "Diagnostic history step limit exceeded");
    studio.undo(); undoSteps++;
  }
  const initial = studio.doc.layers.find(layer => layer.kind === "text");
  assert.equal(initial?.text?.text, "Professional proof requires editable text, wrapping, and reliable delivery.\nSecond paragraph remains editable.");
  for (let step = 0; step < undoSteps; step++) { assert.ok(studio.canRedo()); studio.redo(); }
  assert.equal(JSON.stringify(studio.doc.layers.find(layer => layer.kind === "text")?.text), savedModel);
  assert.equal(studio.historyState().currentDepth, currentDepth);
  Object.assign(report, { pass: true, undoSteps, currentDepth, dimensions: [600, 400], layers: 2, paragraphFrame: [300, 250] });
} catch (error) { report.error = String(error); process.exitCode = 1; }
finally {
  studio.dispose(); report.unchanged = report.sourceSha256 === releaseSourceId();
  if (!report.unchanged) { report.pass = false; process.exitCode = 1; }
  await writeFile(resolve(output, "report.json"), JSON.stringify(report, null, 2));
  release(); console.log(JSON.stringify(report, null, 2), output);
}
