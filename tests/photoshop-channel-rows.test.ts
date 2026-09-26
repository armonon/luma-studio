import test from "node:test";
import assert from "node:assert/strict";
import "./canvas-harness.ts";
import { photoshopChannelRows, decodePhotoshopRasterRows } from "../app/engine/photoshop-channel-rows.ts";
import { readPsd, writePsd, decodeLayerPixels } from "../app/engine/ag-psd-io.ts";
import { createDocument, createRasterLayer, newCanvas } from "../app/engine/document.ts";
import { exportPsd } from "../app/engine/psd.ts";

for (const psb of [false, true]) test(`bounded row decode equals codec pixels across strips (${psb ? "PSB" : "PSD"})`, () => {
  const canvas = newCanvas(1024, 259), ctx = canvas.getContext("2d")!;
  const pixels = ctx.createImageData(canvas.width, canvas.height);
  for (let i = 0; i < pixels.data.length; i += 4) {
    pixels.data[i] = (i * 7) % 255; pixels.data[i + 1] = (i >> 6) % 255;
    pixels.data[i + 2] = (i >> 12) % 255; pixels.data[i + 3] = i % 16 ? 255 : 128;
  }
  ctx.putImageData(pixels, 0, 0);
  const bytes = writePsd({ width: canvas.width, height: canvas.height, children: [{ canvas }] }, { psb, noBackground: true });
  const layer = readPsd(bytes, { useRawData: true, skipCompositeImageData: true }).children![0];
  const bounded = decodePhotoshopRasterRows(layer)!;
  assert.ok(bounded);
  decodeLayerPixels(layer);
  const reference = newCanvas(canvas.width, canvas.height);
  reference.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(layer.imageData!.data), canvas.width, canvas.height), 0, 0);
  assert.deepEqual(bounded.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data,
    reference.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data);
});

test("row decoder enforces raw length and rejects malformed PackBits", () => {
  const row = new Uint8Array(3);
  photoshopChannelRows(new Uint8Array([1, 2, 3]), 3, 1, 0, false)(0, row);
  assert.deepEqual([...row], [1, 2, 3]);
  assert.throws(() => photoshopChannelRows(new Uint8Array(3), 3, 1, 0, false)(1, row), /row target/);
  assert.throws(() => photoshopChannelRows(new Uint8Array(3), 3, 1, 0, false)(0, new Uint8Array(2)), /row target/);
  assert.throws(() => photoshopChannelRows(new Uint8Array(2), 3, 1, 0, false), /size mismatch/);
  for (const bytes of [[0], [0, 5, 1], [0, 1, 254], [0, 2, 253, 1], [0, 2, 0, 1]]) {
    assert.throws(() => photoshopChannelRows(new Uint8Array(bytes), 3, 1, 1, false)(0, row), /Truncated|exceeds|incomplete/);
  }
  photoshopChannelRows(new Uint8Array([0, 3, 128, 254, 9]), 3, 1, 1, false)(0, row);
  assert.deepEqual([...row], [9, 9, 9]);
});

test("ZIP raster decoding stays on the existing admitted codec path", () => {
  const canvas = newCanvas(8, 8);
  canvas.getContext("2d")!.fillRect(0, 0, 8, 8);
  const bytes = writePsd({ width: 8, height: 8, children: [{ canvas }] }, { noBackground: true, compress: true });
  const layer = readPsd(bytes, { useRawData: true, skipCompositeImageData: true }).children![0];
  assert.equal(decodePhotoshopRasterRows(layer), null);
  assert.ok(layer.rawData, "fallback must leave input intact");
  decodeLayerPixels(layer);
  assert.equal(layer.imageData!.width, 8);
});

test("export borrows identity bitmap without releasing or modifying user pixels", () => {
  const doc = createDocument(32, 32), bitmap = newCanvas(8, 6);
  bitmap.getContext("2d")!.fillRect(0, 0, 8, 6);
  const layer = createRasterLayer("owned", bitmap);
  layer.transform.tx = 4; layer.transform.ty = -2;
  doc.layers = [layer];
  const before = bitmap.getContext("2d")!.getImageData(0, 0, 8, 6).data;
  const reopened = readPsd(exportPsd(doc));
  assert.equal(reopened.children![0].left, 4);
  assert.equal(reopened.children![0].top, -2);
  assert.equal(layer.bitmap, bitmap);
  assert.equal(bitmap.width, 8); assert.equal(bitmap.height, 6);
  assert.deepEqual(bitmap.getContext("2d")!.getImageData(0, 0, 8, 6).data, before);
});
