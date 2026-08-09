import assert from "node:assert/strict";
import test from "node:test";
import "./canvas-harness.ts";
import { createDocument, createRasterLayer } from "../app/engine/document.ts";
import {
  filterRegionForSelection,
  gaussianBlur,
  invertColors,
  unsharpMask,
} from "../app/engine/filters.ts";
import { pixelAt, solidCanvas, testCanvas } from "./canvas-harness.ts";

function rectangularSelection(width: number, height: number, x: number, y: number, w: number, h: number) {
  const mask = testCanvas(width, height);
  const context = mask.getContext("2d")!;
  context.fillStyle = "white";
  context.fillRect(x, y, w, h);
  return { mask, bounds: { x, y, w, h } };
}

function patternedCanvas(width: number, height: number) {
  const canvas = testCanvas(width, height);
  const context = canvas.getContext("2d")!;
  const image = context.createImageData(width, height);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const offset = (y * width + x) * 4;
    image.data[offset] = (x * 17 + y * 3) % 256;
    image.data[offset + 1] = (x * 5 + y * 19) % 256;
    image.data[offset + 2] = (x * 11 + y * 7) % 256;
    image.data[offset + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

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

test("selected point filters read and write only the selection rectangle", () => {
  const width = 512;
  const height = 384;
  const bitmap = solidCanvas(width, height, "rgba(20, 40, 60, 1)");
  const layer = createRasterLayer("bounded", bitmap);
  const doc = createDocument(width, height);
  doc.selection = rectangularSelection(width, height, 203, 117, 9, 7);

  const context = bitmap.getContext("2d")!;
  const originalGetImageData = context.getImageData.bind(context);
  const reads: number[][] = [];
  context.getImageData = ((...args: Parameters<typeof context.getImageData>) => {
    reads.push(args.slice(0, 4) as number[]);
    return originalGetImageData(...args);
  }) as typeof context.getImageData;

  invertColors(doc, layer);

  assert.deepEqual(reads, [[203, 117, 9, 7]]);
  assert.deepEqual(pixelAt(bitmap, 205, 120), { r: 235, g: 215, b: 195, a: 255 });
  assert.deepEqual(pixelAt(bitmap, 202, 120), { r: 20, g: 40, b: 60, a: 255 });
  assert.deepEqual(pixelAt(bitmap, 212, 120), { r: 20, g: 40, b: 60, a: 255 });
  assert.ok(reads[0][2] * reads[0][3] < (width * height) / 1000);
});

test("selection regions map from document coordinates into transformed layer pixels", () => {
  const bitmap = solidCanvas(100, 80, "rgba(10, 20, 30, 1)");
  const layer = createRasterLayer("transformed", bitmap);
  layer.transform = { tx: 20, ty: 10, sx: 2, sy: 0.5, rotation: 0 };
  const doc = createDocument(240, 120);
  doc.selection = rectangularSelection(240, 120, 40, 20, 20, 10);

  assert.deepEqual(filterRegionForSelection(doc, layer), {
    x: 10,
    y: 20,
    width: 10,
    height: 20,
  });

  invertColors(doc, layer);
  assert.deepEqual(pixelAt(bitmap, 15, 30), { r: 245, g: 235, b: 225, a: 255 });
  assert.deepEqual(pixelAt(bitmap, 9, 30), { r: 10, g: 20, b: 30, a: 255 });
  assert.deepEqual(pixelAt(bitmap, 20, 30), { r: 10, g: 20, b: 30, a: 255 });
});

test("selection region bounds remain tight for rotated layers", () => {
  const bitmap = solidCanvas(80, 80, "black");
  const layer = createRasterLayer("rotated", bitmap);
  layer.transform = { tx: 50, ty: 10, sx: 1, sy: 1, rotation: Math.PI / 2 };
  const doc = createDocument(100, 100);
  doc.selection = rectangularSelection(100, 100, 30, 20, 10, 20);

  assert.deepEqual(filterRegionForSelection(doc, layer), {
    x: 10,
    y: 10,
    width: 20,
    height: 10,
  });

  invertColors(doc, layer);
  assert.deepEqual(pixelAt(bitmap, 15, 15), { r: 255, g: 255, b: 255, a: 255 });
  assert.deepEqual(pixelAt(bitmap, 5, 15), { r: 0, g: 0, b: 0, a: 255 });
});

test("bounded selected Gaussian matches a full-image blur within the selection", () => {
  const width = 64;
  const height = 56;
  const original = patternedCanvas(width, height);
  const selectedBitmap = testCanvas(width, height);
  selectedBitmap.getContext("2d")!.drawImage(original, 0, 0);
  const referenceBitmap = testCanvas(width, height);
  referenceBitmap.getContext("2d")!.drawImage(original, 0, 0);
  const selectedLayer = createRasterLayer("selected", selectedBitmap);
  const referenceLayer = createRasterLayer("reference", referenceBitmap);
  const selectedDoc = createDocument(width, height);
  selectedDoc.selection = rectangularSelection(width, height, 25, 19, 11, 9);

  gaussianBlur(selectedDoc, selectedLayer, 4);
  gaussianBlur(createDocument(width, height), referenceLayer, 4);

  for (let y = 19; y < 28; y += 1) for (let x = 25; x < 36; x += 1) {
    assert.deepEqual(pixelAt(selectedBitmap, x, y), pixelAt(referenceBitmap, x, y));
  }
  for (const [x, y] of [[24, 22], [36, 22], [30, 18], [30, 28]] as const) {
    assert.deepEqual(pixelAt(selectedBitmap, x, y), pixelAt(original, x, y));
  }
});

test("empty selections skip filter allocations and leave pixels unchanged", () => {
  const bitmap = solidCanvas(128, 96, "rgba(30, 60, 90, 1)");
  const layer = createRasterLayer("empty", bitmap);
  const doc = createDocument(128, 96);
  doc.selection = rectangularSelection(128, 96, 0, 0, 0, 0);
  const context = bitmap.getContext("2d")!;
  const originalGetImageData = context.getImageData.bind(context);
  let reads = 0;
  context.getImageData = ((...args: Parameters<typeof context.getImageData>) => {
    reads += 1;
    return originalGetImageData(...args);
  }) as typeof context.getImageData;

  invertColors(doc, layer);

  assert.equal(reads, 0);
  assert.deepEqual(pixelAt(bitmap, 64, 48), { r: 30, g: 60, b: 90, a: 255 });
});

test("selected unsharp mask includes a bounded blur halo, not the whole layer", () => {
  const width = 400;
  const height = 300;
  const bitmap = patternedCanvas(width, height);
  const layer = createRasterLayer("unsharp", bitmap);
  const doc = createDocument(width, height);
  doc.selection = rectangularSelection(width, height, 190, 140, 8, 6);
  const context = bitmap.getContext("2d")!;
  const originalGetImageData = context.getImageData.bind(context);
  const reads: number[][] = [];
  context.getImageData = ((...args: Parameters<typeof context.getImageData>) => {
    reads.push(args.slice(0, 4) as number[]);
    return originalGetImageData(...args);
  }) as typeof context.getImageData;

  unsharpMask(doc, layer, 3, 0.8);

  assert.equal(reads.length, 1);
  assert.ok(reads[0][0] < 190 && reads[0][1] < 140);
  assert.ok(reads[0][2] < 40 && reads[0][3] < 40);
  assert.ok(reads[0][2] * reads[0][3] < (width * height) / 100);
  assert.deepEqual(pixelAt(bitmap, 50, 50), pixelAt(patternedCanvas(width, height), 50, 50));
});
