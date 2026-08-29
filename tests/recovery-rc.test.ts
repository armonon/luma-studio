import assert from "node:assert/strict";
import test from "node:test";
import "./canvas-harness.ts";
import { Studio } from "../app/engine/studio.ts";
import { SparseAlphaSurface } from "../app/engine/alpha-surface.ts";
import { decodeLumaProject } from "../app/engine/project.ts";
import { testCanvas } from "./canvas-harness.ts";

test("crash recovery checkpoints every open document and restores the active tab", async () => {
  const studio = new Studio(64, 48, testCanvas(1, 1));
  const firstLayer = studio.addBlankRaster("First work");
  firstLayer.maskSurface = new SparseAlphaSurface(64, 48, { defaultAlpha: 255 });
  firstLayer.maskSurface.fillRect({ x: 10, y: 12, width: 8, height: 6 }, 0);
  firstLayer.bitmap = undefined;
  const firstId = studio.activeDocumentState().id;
  studio.markDocumentSaved(firstId, "/projects/first-work.luma");
  studio.setLayerProp(firstLayer.id, "opacity", 0.75, "Unsaved opacity");

  studio.resetDocument(80, 60);
  studio.addBlankRaster("Second work").bitmap = undefined;
  const secondId = studio.activeDocumentState().id;
  const checkpoints = await studio.exportRecoveryWorkspace();
  assert.equal(checkpoints.length, 2);
  assert.equal(checkpoints.filter((entry) => entry.active).length, 1);
  assert.equal(checkpoints.find((entry) => entry.active)?.id, secondId);
  const firstCheckpoint = checkpoints.find((entry) => entry.id === firstId);
  assert.equal(firstCheckpoint?.nativePath, "/projects/first-work.luma");
  assert.equal(firstCheckpoint?.dirty, true);

  const decoded = await Promise.all(checkpoints.map(async (entry) =>
    decodeLumaProject(await entry.blob.arrayBuffer(), { restoreHistory: false })));
  assert.deepEqual(decoded.map((entry) => [entry.doc.width, entry.doc.height]), [[64, 48], [80, 60]]);
  const first = decoded[checkpoints.findIndex((entry) => entry.id === firstId)];
  assert.equal(first.doc.layers[0].name, "First work");
  assert.equal(first.doc.layers[0].maskSurface?.sample(12, 14), 0);

  studio.dispose();
});

test("recovered session metadata retains Save routing and dirty close protection", async () => {
  const source = new Studio(40, 30, testCanvas(1, 1));
  const sourceId = source.activeDocumentState().id;
  source.markDocumentSaved(sourceId, "/projects/remembered.luma");
  source.addBlankRaster("Unsaved recovered edit").bitmap = undefined;
  const checkpoint = await source.exportRecoveryDocument();

  const restored = new Studio(1, 1, testCanvas(1, 1));
  await restored.importProject(checkpoint.blob, { restoreHistory: false });
  restored.restoreDocumentSessionState(restored.activeDocumentState().id, checkpoint);

  assert.equal(restored.activeDocumentState().nativePath, "/projects/remembered.luma");
  assert.equal(restored.activeDocumentState().dirty, true);
  source.dispose();
  restored.dispose();
});

test("routine recovery exports only the active document", async () => {
  const studio = new Studio(64, 48, testCanvas(1, 1));
  const firstId = studio.activeDocumentState().id;
  studio.addBlankRaster("First work").bitmap = undefined;
  studio.resetDocument(80, 60);
  studio.addBlankRaster("Second work").bitmap = undefined;

  const checkpoint = await studio.exportRecoveryDocument();
  assert.notEqual(checkpoint.id, firstId);
  assert.equal(checkpoint.active, true);
  const decoded = await decodeLumaProject(await checkpoint.blob.arrayBuffer(), { restoreHistory: false });
  assert.deepEqual([decoded.doc.width, decoded.doc.height], [80, 60]);
  assert.equal(decoded.doc.layers[0].name, "Second work");
  studio.dispose();
});

test("a corrupt recovery import cannot replace or damage the open document", async () => {
  const studio = new Studio(32, 24, testCanvas(1, 1));
  const layer = studio.addBlankRaster("Protected work");
  studio.fillLayer(layer.id, "#336699", 1);
  layer.bitmap = undefined;
  const beforeDocument = studio.doc;
  const beforeHistory = studio.historyState();
  const valid = new Uint8Array(await (await studio.exportRecoveryWorkspace())[0].blob.arrayBuffer());
  const corrupt = new Blob([valid.subarray(0, Math.min(31, valid.length))]);

  await assert.rejects(() => studio.importProject(corrupt));
  assert.equal(studio.doc, beforeDocument);
  assert.equal(studio.doc.layers[0].name, "Protected work");
  assert.deepEqual(studio.historyState(), beforeHistory);
  studio.dispose();
});

test("a long edit session stays within the bounded history window and remains undoable", () => {
  const studio = new Studio(16, 16, testCanvas(1, 1));
  const layer = studio.addBlankRaster("Long session");
  for (let index = 0; index < 400; index += 1) {
    studio.setLayerProp(layer.id, "opacity", ((index % 99) + 1) / 100, `Opacity ${index}`);
  }
  const state = studio.historyState();
  assert.ok(state.operations <= 80, `history retained ${state.operations} operations`);
  assert.equal(state.overBudget, false);
  let undos = 0;
  while (studio.canUndo()) {
    studio.undo();
    undos += 1;
  }
  assert.ok(undos > 0);
  assert.ok(undos <= 80);
  studio.dispose();
});
