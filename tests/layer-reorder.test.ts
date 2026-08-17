import assert from "node:assert/strict";
import test from "node:test";

import { Studio } from "../app/engine/studio.ts";
import { testCanvas } from "./canvas-harness.ts";

test("layer reorder history is compact and restores exact order", () => {
  const studio = new Studio(16, 16, testCanvas(16, 16));
  const bottom = studio.addBlankRaster("Bottom");
  const middle = studio.addBlankRaster("Middle");
  const top = studio.addBlankRaster("Top");
  const before = studio.doc.layers.map((layer) => layer.id);
  const bytesBefore = studio.historyState().bytes;

  studio.reorderLayer(top.id, 2);
  const reordered = studio.doc.layers.map((layer) => layer.id);
  assert.notDeepEqual(reordered, before);
  assert.ok(studio.historyState().bytes - bytesBefore < 1_000);

  studio.undo();
  assert.deepEqual(studio.doc.layers.map((layer) => layer.id), before);
  studio.redo();
  assert.deepEqual(studio.doc.layers.map((layer) => layer.id), reordered);
  assert.deepEqual(new Set(reordered), new Set([top.id, middle.id, bottom.id]));
});
