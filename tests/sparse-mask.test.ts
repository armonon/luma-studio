import assert from "node:assert/strict";
import test from "node:test";
import "./canvas-harness.ts";
import { Studio } from "../app/engine/studio.ts";
import { createDocument, createRasterLayer } from "../app/engine/document.ts";
import { SparseAlphaSurface } from "../app/engine/alpha-surface.ts";
import { clearMaskInPlace, invertMaskInPlace } from "../app/engine/mask-ops.ts";
import { renderClean } from "../app/engine/renderer.ts";
import { decodeLumaProject, encodeLumaProject } from "../app/engine/project.ts";
import { pixelAt, solidCanvas, testCanvas } from "./canvas-harness.ts";
import type { BrushParams } from "../app/engine/brush.ts";

const maskRemove: BrushParams = {
  size: 48,
  hardness: 1,
  opacity: 1,
  flow: 1,
  spacing: 0.15,
  pressureSize: false,
  pressureOpacity: false,
  color: "#000000",
  mode: "mask-remove",
};

test("50K mask painting and undo stay sparse and bounded", () => {
  const studio = new Studio(50_000, 50_000, testCanvas(1, 1));
  const layer = studio.addBlankRaster("Extreme mask");
  const allocated: HTMLCanvasElement[] = [];
  const documentObject = globalThis.document;
  const originalCreateElement = documentObject.createElement.bind(documentObject);
  documentObject.createElement = ((tagName: string, options?: ElementCreationOptions) => {
    const element = originalCreateElement(tagName, options);
    if (tagName === "canvas") allocated.push(element as HTMLCanvasElement);
    return element;
  }) as typeof documentObject.createElement;
  try {
    studio.beginStroke(layer.id, maskRemove, { x: 25_000, y: 24_000, p: 1 });
    studio.paintTo(layer.id, maskRemove, { x: 25_090, y: 24_040, p: 1 });
    studio.endStroke(layer.id, maskRemove);
  } finally {
    documentObject.createElement = originalCreateElement as typeof documentObject.createElement;
  }

  assert.ok(layer.maskSurface);
  assert.equal(layer.mask, undefined);
  assert.equal(layer.maskSurface.sample(25_000, 24_000), 0);
  assert.ok(layer.maskSurface.stats().residentBytes < 1024 * 1024);
  assert.ok(allocated.every((canvas) => canvas.width < 512 && canvas.height < 512));
  assert.equal(studio.engineState().alphaBytes, layer.maskSurface.stats().residentBytes);

  studio.undo();
  assert.equal(layer.maskSurface.sample(25_000, 24_000), 255);
  assert.equal(layer.maskSurface.stats().residentTiles, 0);
  studio.redo();
  assert.equal(layer.maskSurface.sample(25_000, 24_000), 0);
  studio.dispose();
});

test("uniform extreme masks invert and clear without resident tiles", () => {
  const layer = createRasterLayer("Mask constants");
  invertMaskInPlace(layer, 300_000, 275_000);
  assert.equal(layer.maskSurface?.defaultAlpha, 0);
  assert.equal(layer.maskSurface?.stats().residentTiles, 0);
  clearMaskInPlace(layer, 300_000, 275_000);
  assert.equal(layer.maskSurface?.defaultAlpha, 255);
  assert.equal(layer.maskSurface?.stats().residentTiles, 0);
});

test("50K mask feathering and undo remain region bounded", () => {
  const studio = new Studio(50_000, 50_000, testCanvas(1, 1));
  const layer = studio.addBlankRaster("Feathered mask");
  layer.maskSurface = new SparseAlphaSurface(50_000, 50_000);
  layer.maskSurface.fillRect({ x: 24_940, y: 24_960, width: 120, height: 80 }, 255);
  const before = layer.maskSurface.clone();
  const allocated: HTMLCanvasElement[] = [];
  const documentObject = globalThis.document;
  const originalCreateElement = documentObject.createElement.bind(documentObject);
  documentObject.createElement = ((tagName: string, options?: ElementCreationOptions) => {
    const element = originalCreateElement(tagName, options);
    if (tagName === "canvas") allocated.push(element as HTMLCanvasElement);
    return element;
  }) as typeof documentObject.createElement;
  try {
    assert.equal(studio.featherMask(layer.id, 8), true);
  } finally {
    documentObject.createElement = originalCreateElement as typeof documentObject.createElement;
  }
  assert.ok(layer.maskSurface.sample(24_940, 25_000) > 0);
  assert.ok(layer.maskSurface.sample(24_940, 25_000) < 255);
  assert.ok(layer.maskSurface.stats().residentBytes < 2 * 1024 * 1024);
  assert.ok(allocated.every((canvas) => canvas.width < 512 && canvas.height < 512));
  studio.undo();
  assert.equal(layer.maskSurface.sample(24_940, 25_000), before.sample(24_940, 25_000));
  assert.equal(layer.maskSurface.stats().residentBytes, before.stats().residentBytes);
  studio.dispose();
});

test("the viewport compositor consumes sparse masks tilewise", () => {
  const doc = createDocument(8, 8);
  const layer = createRasterLayer("Sparse render", solidCanvas(8, 8, "#ff0000"));
  layer.maskSurface = new SparseAlphaSurface(8, 8);
  layer.maskSurface.fillRect({ x: 0, y: 0, width: 4, height: 8 }, 255);
  doc.layers = [layer];
  const output = testCanvas(8, 8);
  renderClean(doc, output);
  assert.deepEqual(pixelAt(output, 1, 4), { r: 255, g: 0, b: 0, a: 255 });
  assert.deepEqual(pixelAt(output, 6, 4), { r: 0, g: 0, b: 0, a: 0 });
});

test("sparse mask tiles survive project save and reopen", async () => {
  const doc = createDocument(50_000, 25_000);
  const layer = createRasterLayer("Saved sparse mask");
  layer.maskSurface = new SparseAlphaSurface(doc.width, doc.height, { defaultAlpha: 255 });
  layer.maskSurface.fillRect({ x: 22_000, y: 11_000, width: 80, height: 60 }, 0);
  doc.layers = [layer];
  const blob = await encodeLumaProject(doc, [], "Sparse mask");
  const restored = await decodeLumaProject(await blob.arrayBuffer());
  const mask = restored.doc.layers[0].maskSurface;
  assert.ok(mask);
  assert.equal(mask.sample(22_010, 11_010), 0);
  assert.equal(mask.sample(100, 100), 255);
  assert.equal(mask.stats().residentTiles, layer.maskSurface.stats().residentTiles);
});
