import test from "node:test";
import assert from "node:assert/strict";
import { testCanvas } from "./canvas-harness";
import { Studio } from "../app/engine/studio";
import { SparseAlphaSurface } from "../app/engine/alpha-surface";

for (const present of [false, true]) test(`locked mask commands cannot change pixels, history or dirty state (mask ${present ? "present" : "absent"})`, async () => {
  const studio = new Studio(32, 32, testCanvas(32, 32));
  try {
    const layer = studio.addBlankRaster("Locked master");
    if (present) { layer.maskSurface = new SparseAlphaSurface(32, 32, { defaultAlpha: 128 }); layer.maskSurface.writeUniform("0:0", 64); }
    layer.locked = true; studio.markDocumentSaved();
    studio.actions.start("Rejected mask edits");
    const mask = layer.maskSurface, stats = mask?.stats(), history = studio.historyState(), state = studio.activeDocumentState();
    studio.invertMask(layer.id); studio.clearMask(layer.id); assert.equal(studio.featherMask(layer.id, 4), false); studio.autoLumaMask(layer.id);
    await assert.rejects(studio.neuralSubject(layer.id), /Unlock/);
    assert.equal(layer.maskSurface, mask); assert.equal(layer.mask, undefined); assert.deepEqual(mask?.stats(), stats);
    assert.deepEqual(studio.historyState(), history); assert.deepEqual(studio.activeDocumentState(), state); assert.deepEqual(studio.actions.stop()!.steps, []);
  } finally { studio.dispose(); }
});

test("unlocked mask edits remain undoable after the lock admission guard", () => {
  const studio = new Studio(32, 32, testCanvas(32, 32));
  try {
    const layer = studio.addBlankRaster("Editable");layer.maskSurface = new SparseAlphaSurface(32, 32, { defaultAlpha: 128 });
    studio.invertMask(layer.id); assert.equal(studio.findLayer(layer.id)!.maskSurface!.defaultAlpha, 127);
    studio.undo(); assert.equal(studio.findLayer(layer.id)!.maskSurface!.defaultAlpha, 128);
    studio.redo(); assert.equal(studio.findLayer(layer.id)!.maskSurface!.defaultAlpha, 127);
  } finally { studio.dispose(); }
});
