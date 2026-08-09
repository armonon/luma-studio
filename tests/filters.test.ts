import assert from "node:assert/strict";
import test from "node:test";
import "./canvas-harness.ts";
import { createDocument, createRasterLayer } from "../app/engine/document.ts";
import { gaussianBlur } from "../app/engine/filters.ts";
import { pixelAt, solidCanvas } from "./canvas-harness.ts";

test("oversized Gaussian radii preserve a solid small image", () => {
  for (const [width, height] of [[1, 1], [1, 5], [5, 1], [2, 2]] as const) {
    const bitmap = solidCanvas(width, height, "rgba(128, 96, 64, 1)");
    const layer = createRasterLayer("small", bitmap);
    gaussianBlur(createDocument(width, height), layer, 64);
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      assert.deepEqual(pixelAt(bitmap, x, y), { r: 128, g: 96, b: 64, a: 255 });
    }
  }
});

test("oversized Gaussian radii never introduce transparent or invalid edge pixels", () => {
  const bitmap = solidCanvas(2, 2, "rgba(255, 255, 255, 1)");
  const context = bitmap.getContext("2d")!;
  context.fillStyle = "rgba(0, 0, 0, 1)";
  context.fillRect(0, 0, 1, 1);
  const layer = createRasterLayer("contrast", bitmap);
  gaussianBlur(createDocument(2, 2), layer, 64);
  for (let y = 0; y < 2; y += 1) for (let x = 0; x < 2; x += 1) {
    const pixel = pixelAt(bitmap, x, y);
    assert.equal(pixel.a, 255);
    assert.ok(pixel.r >= 0 && pixel.r <= 255);
    assert.equal(pixel.r, pixel.g);
    assert.equal(pixel.g, pixel.b);
  }
});
