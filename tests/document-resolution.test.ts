import assert from "node:assert/strict";
import test from "node:test";
import "./canvas-harness.ts";
import { Studio } from "../app/engine/studio";
import { testCanvas } from "./canvas-harness.ts";

test("print resolution changes metadata without resampling and is undoable", () => {
  const studio = new Studio(2400, 1600, testCanvas(2400, 1600));
  assert.equal(studio.setDocumentResolution(300), true);
  assert.deepEqual(studio.doc.resolution, { x: 300, y: 300, unit: "ppi" });
  assert.equal(studio.doc.width, 2400);
  assert.equal(studio.doc.height, 1600);
  studio.undo();
  assert.deepEqual(studio.doc.resolution, { x: 72, y: 72, unit: "ppi" });
});

test("print resolution rejects invalid metadata values", () => {
  const studio = new Studio(10, 10, testCanvas(10, 10));
  for (const value of [0, -1, 12001, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(studio.setDocumentResolution(value), false);
  }
  assert.deepEqual(studio.doc.resolution, { x: 72, y: 72, unit: "ppi" });
});
