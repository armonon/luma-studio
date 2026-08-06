import assert from "node:assert/strict";
import test from "node:test";
import { refineSelectionAlpha } from "../app/engine/selection.ts";

test("selection refinement can grow, smooth, and harden an edge", () => {
  const width = 9;
  const height = 9;
  const source = new Uint8ClampedArray(width * height);
  source[4 * width + 4] = 255;
  const grown = refineSelectionAlpha(source, width, height, { smooth: 0, contrast: 0, shiftEdge: 6 });
  assert.equal(grown[4 * width + 4], 255);
  assert.equal(grown[4 * width + 3], 255);
  assert.equal(grown[3 * width + 4], 255);

  const smoothed = refineSelectionAlpha(grown, width, height, { smooth: 2, contrast: 0, shiftEdge: 0 });
  assert.ok(smoothed.some((value) => value > 0 && value < 255));
  const hardened = refineSelectionAlpha(smoothed, width, height, { smooth: 0, contrast: 40, shiftEdge: 0 });
  assert.ok(Math.abs(hardened[4 * width + 4] - 127.5) >= Math.abs(smoothed[4 * width + 4] - 127.5));
});

test("negative edge shift contracts a selection", () => {
  const width = 7;
  const height = 7;
  const source = new Uint8ClampedArray(width * height).fill(255);
  for (let x = 0; x < width; x += 1) {
    source[x] = 0;
    source[(height - 1) * width + x] = 0;
  }
  for (let y = 0; y < height; y += 1) {
    source[y * width] = 0;
    source[y * width + width - 1] = 0;
  }
  const contracted = refineSelectionAlpha(source, width, height, { smooth: 0, contrast: 0, shiftEdge: -7 });
  assert.equal(contracted[1 * width + 1], 0);
  assert.equal(contracted[3 * width + 3], 255);
});
