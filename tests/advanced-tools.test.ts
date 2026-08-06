import assert from "node:assert/strict";
import test from "node:test";
import {
  createGradientPixels,
  createPatternPixels,
  radialWarp,
  rectifyQuadrilateral,
  snapPointToEdge,
  warpToQuadrilateral,
} from "../app/engine/advanced-tools.ts";

const pixel = (data: Uint8ClampedArray, width: number, x: number, y: number) =>
  Array.from(data.slice((y * width + x) * 4, (y * width + x) * 4 + 4));

test("linear and radial gradients interpolate exact endpoint colors", () => {
  const linear = createGradientPixels(3, 1, { x: 0.5, y: 0.5 }, { x: 2.5, y: 0.5 }, "#ff0000", "#0000ff");
  assert.deepEqual(pixel(linear.data, 3, 0, 0), [255, 0, 0, 255]);
  assert.deepEqual(pixel(linear.data, 3, 1, 0), [128, 0, 128, 255]);
  assert.deepEqual(pixel(linear.data, 3, 2, 0), [0, 0, 255, 255]);
  const radial = createGradientPixels(3, 3, { x: 1.5, y: 1.5 }, { x: 2.5, y: 1.5 }, "#ffffff", "#000000", "radial");
  assert.deepEqual(pixel(radial.data, 3, 1, 1), [255, 255, 255, 255]);
  assert.deepEqual(pixel(radial.data, 3, 2, 1), [0, 0, 0, 255]);
});

test("procedural patterns repeat predictably", () => {
  const checker = createPatternPixels(5, 5, "checker", "#ffffff", "#000000", 2);
  assert.deepEqual(pixel(checker.data, 5, 0, 0), [255, 255, 255, 255]);
  assert.deepEqual(pixel(checker.data, 5, 2, 0), [0, 0, 0, 255]);
  assert.deepEqual(pixel(checker.data, 5, 2, 2), [255, 255, 255, 255]);
});

test("perspective rectification preserves the four selected corners", () => {
  const data = new Uint8ClampedArray(3 * 3 * 4);
  data.set([255, 0, 0, 255], 0);
  data.set([0, 255, 0, 255], 8);
  data.set([0, 0, 255, 255], 24);
  data.set([255, 255, 255, 255], 32);
  const result = rectifyQuadrilateral({ width: 3, height: 3, data }, [
    { x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 },
  ]);
  assert.equal(result.width, 2);
  assert.equal(result.height, 2);
  assert.deepEqual(pixel(result.data, 2, 0, 0), [255, 0, 0, 255]);
  assert.deepEqual(pixel(result.data, 2, 1, 0), [0, 255, 0, 255]);
  assert.deepEqual(pixel(result.data, 2, 0, 1), [0, 0, 255, 255]);
  assert.deepEqual(pixel(result.data, 2, 1, 1), [255, 255, 255, 255]);
});

test("radial warp moves local detail while preserving distant pixels", () => {
  const data = new Uint8ClampedArray(7 * 5 * 4);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  data.set([255, 0, 0, 255], (2 * 7 + 2) * 4);
  data.set([0, 255, 0, 255], 0);
  const warped = radialWarp({ width: 7, height: 5, data }, { x: 2, y: 2 }, { x: 4, y: 2 }, 3);
  assert.ok(pixel(warped.data, 7, 4, 2)[0] > 200);
  assert.deepEqual(pixel(warped.data, 7, 0, 0), [0, 255, 0, 255]);
});

test("perspective warp reverse-maps a filled quad without interior pinholes", () => {
  const data = new Uint8ClampedArray(4 * 4 * 4).fill(255);
  const warped = warpToQuadrilateral({ width: 4, height: 4, data }, 8, 8, [
    { x: 1, y: 1 }, { x: 6, y: 2 }, { x: 5, y: 6 }, { x: 2, y: 5 },
  ]);
  for (const [x, y] of [[2, 2], [3, 3], [4, 4], [4, 5]]) {
    assert.equal(pixel(warped.data, 8, x, y)[3], 255, `expected opaque pixel at ${x},${y}`);
  }
  assert.equal(pixel(warped.data, 8, 0, 0)[3], 0);
});

test("magnetic snapping locks onto the strongest nearby edge", () => {
  const data = new Uint8ClampedArray(9 * 7 * 4);
  for (let y = 0; y < 7; y += 1) for (let x = 0; x < 9; x += 1) {
    const offset = (y * 9 + x) * 4;
    const value = x >= 4 ? 255 : 0;
    data.set([value, value, value, 255], offset);
  }
  const snapped = snapPointToEdge({ width: 9, height: 7, data }, { x: 6, y: 3 }, 4);
  assert.ok(snapped.x === 3 || snapped.x === 4);
  assert.equal(snapped.y, 3);
});
