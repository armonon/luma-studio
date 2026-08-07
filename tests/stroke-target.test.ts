import assert from "node:assert/strict";
import test from "node:test";
import { paintTarget } from "../app/engine/stroke-target.ts";
import type { Layer } from "../app/engine/document.ts";
import type { BrushParams } from "../app/engine/brush.ts";

const params = (mode: BrushParams["mode"]): BrushParams => ({
  size: 32,
  hardness: 0.7,
  opacity: 1,
  color: "#fff",
  mode,
});

function fakeCanvas(w: number, h: number): HTMLCanvasElement {
  return { width: w, height: h } as unknown as HTMLCanvasElement;
}

test("paint/erase modes return the layer bitmap (or null when absent)", () => {
  const bitmap = fakeCanvas(10, 10);
  const layer = { id: "l1", bitmap } as unknown as Layer;
  assert.equal(paintTarget(layer, params("paint"), 10, 10), bitmap);
  assert.equal(paintTarget(layer, params("erase"), 10, 10), bitmap);

  const empty = { id: "l2" } as unknown as Layer;
  assert.equal(paintTarget(empty, params("paint"), 10, 10), null);
});
