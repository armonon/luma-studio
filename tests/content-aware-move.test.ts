import assert from "node:assert/strict";
import test from "node:test";
import "./canvas-harness.ts";
import { Studio, planSelectionContentMove } from "../app/engine/studio.ts";
import { PrecisionTileSurface } from "../app/engine/tile-store.ts";
import { selectionRegionCanvas } from "../app/engine/selection.ts";
import { testCanvas } from "./canvas-harness.ts";

function pixels(canvas: HTMLCanvasElement) {
  return new Uint8ClampedArray(
    canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data,
  );
}

function alphaPixels(canvas: HTMLCanvasElement) {
  const rgba = pixels(canvas);
  const alpha = new Uint8ClampedArray(canvas.width * canvas.height);
  for (let pixel = 0; pixel < alpha.length; pixel += 1) alpha[pixel] = rgba[pixel * 4 + 3];
  return alpha;
}

function selectionAlpha(studio: Studio) {
  const mask = selectionRegionCanvas(studio.doc, {
    x: 0,
    y: 0,
    width: studio.doc.width,
    height: studio.doc.height,
  });
  assert.ok(mask);
  return alphaPixels(mask);
}

function patternedCanvas(width: number, height: number) {
  const canvas = testCanvas(width, height);
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#183050";
  context.fillRect(0, 0, width, height);
  for (let y = 0; y < height; y += 8) {
    context.fillStyle = y % 16 ? "#f0a020" : "#20b8e8";
    context.fillRect(0, y, width, 4);
  }
  context.fillStyle = "#f02070";
  context.fillRect(Math.floor(width / 3), 0, 7, height);
  return canvas;
}

function rectangularMask(width: number, height: number, x: number, y: number, w: number, h: number) {
  const mask = testCanvas(width, height);
  const context = mask.getContext("2d")!;
  context.fillStyle = "white";
  context.fillRect(x, y, w, h);
  return mask;
}

function alphaBounds(mask: HTMLCanvasElement) {
  const data = pixels(mask);
  let minX = mask.width;
  let minY = mask.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < mask.height; y += 1) for (let x = 0; x < mask.width; x += 1) {
    if (data[(y * mask.width + x) * 4 + 3] === 0) continue;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return maxX < 0
    ? { x: 0, y: 0, w: 0, h: 0 }
    : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function cloneCanvas(source: HTMLCanvasElement) {
  const canvas = testCanvas(source.width, source.height);
  canvas.getContext("2d")!.drawImage(source, 0, 0);
  return canvas;
}

/** Previous full-document implementation retained as the pixel-parity oracle. */
function fullCanvasMove(
  source: HTMLCanvasElement,
  mask: HTMLCanvasElement,
  documentWidth: number,
  documentHeight: number,
  deltaX: number,
  deltaY: number,
  healSource: boolean,
) {
  const bitmap = cloneCanvas(source);
  const content = testCanvas(documentWidth, documentHeight);
  const contentContext = content.getContext("2d")!;
  contentContext.drawImage(bitmap, 0, 0);
  contentContext.globalCompositeOperation = "destination-in";
  contentContext.drawImage(mask, 0, 0);

  const context = bitmap.getContext("2d")!;
  context.save();
  context.globalCompositeOperation = "destination-out";
  context.drawImage(mask, 0, 0);
  context.restore();
  if (healSource) {
    const fill = testCanvas(documentWidth, documentHeight);
    const fillContext = fill.getContext("2d")!;
    fillContext.filter = "blur(14px)";
    fillContext.drawImage(bitmap, 0, 0);
    fillContext.filter = "none";
    fillContext.globalCompositeOperation = "destination-in";
    fillContext.drawImage(mask, 0, 0);
    context.drawImage(fill, 0, 0);
  }
  context.drawImage(content, deltaX, deltaY);
  const movedMask = testCanvas(documentWidth, documentHeight);
  movedMask.getContext("2d")!.drawImage(mask, deltaX, deltaY);
  return { bitmap, movedMask };
}

function configuredStudio(
  width: number,
  height: number,
  bounds: { x: number; y: number; w: number; h: number },
) {
  const studio = new Studio(width, height, testCanvas(width, height));
  const layer = studio.addBlankRaster("Move source");
  const source = patternedCanvas(width, height);
  layer.bitmap!.getContext("2d")!.drawImage(source, 0, 0);
  layer.surface = PrecisionTileSurface.fromImageData(
    layer.bitmap!.getContext("2d")!.getImageData(0, 0, width, height),
  );
  const mask = rectangularMask(width, height, bounds.x, bounds.y, bounds.w, bounds.h);
  studio.doc.selection = { mask, bounds: { ...bounds } };
  return { studio, layer, source, mask };
}

for (const scenario of [
  { name: "interior healed move", bounds: { x: 31, y: 24, w: 17, h: 13 }, dx: 18, dy: -9, heal: true },
  { name: "document-edge healed move", bounds: { x: 0, y: 3, w: 19, h: 14 }, dx: 11, dy: 8, heal: true },
  { name: "unhealed move clipped at destination", bounds: { x: 6, y: 5, w: 15, h: 12 }, dx: -13, dy: -9, heal: false },
] as const) {
  test(`bounded content-aware move has exact full-canvas parity for ${scenario.name}`, () => {
    const width = 96;
    const height = 72;
    const { studio, layer, source, mask } = configuredStudio(width, height, scenario.bounds);
    layer.transform = { tx: 7, ty: -3, sx: 1.2, sy: 0.8, rotation: 0.25 };
    const expected = fullCanvasMove(source, mask, width, height, scenario.dx, scenario.dy, scenario.heal);

    assert.equal(studio.moveSelectionContent(layer.id, scenario.dx, scenario.dy, scenario.heal), true);
    assert.deepEqual(pixels(layer.bitmap!), pixels(expected.bitmap));
    assert.deepEqual(selectionAlpha(studio), alphaPixels(expected.movedMask));
    assert.deepEqual(studio.doc.selection!.bounds, {
      x: scenario.bounds.x + scenario.dx,
      y: scenario.bounds.y + scenario.dy,
      w: scenario.bounds.w,
      h: scenario.bounds.h,
    });
    assert.deepEqual(layer.transform, { tx: 7, ty: -3, sx: 1.2, sy: 0.8, rotation: 0.25 });
    studio.dispose();
  });
}

test("bounded content-aware move preserves feathered mask pixels exactly", () => {
  const width = 112;
  const height = 84;
  const source = patternedCanvas(width, height);
  const mask = testCanvas(width, height);
  const maskContext = mask.getContext("2d")!;
  maskContext.fillStyle = "white";
  maskContext.filter = "blur(3px)";
  maskContext.fillRect(42, 31, 16, 12);
  maskContext.filter = "none";
  const bounds = alphaBounds(mask);
  const { studio, layer } = configuredStudio(width, height, bounds);
  layer.bitmap!.getContext("2d")!.clearRect(0, 0, width, height);
  layer.bitmap!.getContext("2d")!.drawImage(source, 0, 0);
  layer.surface = PrecisionTileSurface.fromImageData(
    layer.bitmap!.getContext("2d")!.getImageData(0, 0, width, height),
  );
  studio.doc.selection = { mask, bounds };
  const expected = fullCanvasMove(source, mask, width, height, 13.5, -7.25, true);

  assert.equal(studio.moveSelectionContent(layer.id, 13.5, -7.25, true), true);
  assert.deepEqual(pixels(layer.bitmap!), pixels(expected.bitmap));
  assert.deepEqual(selectionAlpha(studio), alphaPixels(expected.movedMask));
  const movedPixels = pixels(layer.bitmap!);
  const movedMask = selectionAlpha(studio);
  studio.undo();
  assert.deepEqual(pixels(studio.findLayer(layer.id)!.bitmap!), pixels(source));
  assert.deepEqual(selectionAlpha(studio), alphaPixels(mask));
  studio.redo();
  assert.deepEqual(pixels(studio.findLayer(layer.id)!.bitmap!), movedPixels);
  assert.deepEqual(selectionAlpha(studio), movedMask);
  studio.dispose();
});

test("content-aware move preserves undo, redo, and the precision surface", () => {
  const width = 320;
  const height = 96;
  const bounds = { x: 246, y: 24, w: 19, h: 17 };
  const { studio, layer, mask } = configuredStudio(width, height, bounds);
  const beforePixels = pixels(layer.bitmap!);
  const beforeMask = alphaPixels(mask);

  assert.equal(studio.moveSelectionContent(layer.id, 31, 8, true), true);
  const movedPixels = pixels(layer.bitmap!);
  const movedMask = selectionAlpha(studio);
  const expectedSurface = PrecisionTileSurface.fromImageData(
    layer.bitmap!.getContext("2d")!.getImageData(0, 0, width, height),
  );
  assert.deepEqual(layer.surface!.store.entries(), expectedSurface.store.entries());

  studio.undo();
  assert.deepEqual(pixels(studio.findLayer(layer.id)!.bitmap!), beforePixels);
  assert.deepEqual(selectionAlpha(studio), beforeMask);
  assert.deepEqual(studio.doc.selection!.bounds, bounds);

  studio.redo();
  assert.deepEqual(pixels(studio.findLayer(layer.id)!.bitmap!), movedPixels);
  assert.deepEqual(selectionAlpha(studio), movedMask);
  assert.deepEqual(studio.doc.selection!.bounds, { x: 277, y: 32, w: 19, h: 17 });
  studio.dispose();
});

test("content and heal scratch allocation scales with selection, not document area", () => {
  const largePlan = planSelectionContentMove(
    { x: 20_000, y: 21_000, w: 100, h: 80 },
    50_000,
    50_000,
    40,
    -30,
    true,
  )!;
  assert.deepEqual(largePlan.content, { x: 20_000, y: 21_000, width: 100, height: 80 });
  assert.deepEqual(largePlan.contentScratch, { x: 19_998, y: 20_998, width: 104, height: 84 });
  assert.deepEqual(largePlan.healWork, { x: 19_942, y: 20_942, width: 216, height: 196 });
  assert.ok(largePlan.healWork!.width * largePlan.healWork!.height < 43_000);
  assert.ok(largePlan.healWork!.width * largePlan.healWork!.height < (50_000 * 50_000) / 50_000);

  const width = 320;
  const height = 240;
  const bounds = { x: 140, y: 105, w: 17, h: 13 };
  const { studio, layer } = configuredStudio(width, height, bounds);
  const documentObject = globalThis.document;
  const originalCreateElement = documentObject.createElement.bind(documentObject);
  const allocated: HTMLCanvasElement[] = [];
  let moveDimensions: string[] = [];
  let undoDimensions: string[] = [];
  let redoDimensions: string[] = [];
  documentObject.createElement = ((tagName: string, options?: ElementCreationOptions) => {
    const element = originalCreateElement(tagName, options);
    if (tagName === "canvas") allocated.push(element as HTMLCanvasElement);
    return element;
  }) as typeof documentObject.createElement;
  try {
    assert.equal(studio.moveSelectionContent(layer.id, 9, -7, true), true);
    moveDimensions = allocated.map((canvas) => `${canvas.width}x${canvas.height}`);
    allocated.length = 0;
    studio.undo();
    undoDimensions = allocated.map((canvas) => `${canvas.width}x${canvas.height}`);
    allocated.length = 0;
    studio.redo();
    redoDimensions = allocated.map((canvas) => `${canvas.width}x${canvas.height}`);
  } finally {
    documentObject.createElement = originalCreateElement as typeof documentObject.createElement;
  }

  assert.equal(moveDimensions.filter((size) => size === `${width}x${height}`).length, 0,
    "sparse selection movement must not allocate a document-sized mask");
  assert.ok(moveDimensions.includes("21x17"), "selected content uses a guarded cropped scratch");
  assert.ok(moveDimensions.includes("133x129"), "healing uses a padded cropped scratch");
  assert.deepEqual(
    undoDimensions.filter((size) => size === `${width}x${height}`),
    [],
    "undo restores sparse selection state without a document-sized mask",
  );
  assert.deepEqual(
    redoDimensions.filter((size) => size === `${width}x${height}`),
    [],
    "redo restores sparse selection state without a document-sized mask",
  );
  studio.dispose();
});
