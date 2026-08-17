import assert from "node:assert/strict";
import test from "node:test";
import "./canvas-harness.ts";
import {
  replayStroke,
  replayStrokeFloat,
  type BrushParams,
  type ImageBrushTip,
  type RgbaSurface,
} from "../app/engine/brush.ts";
import { Studio } from "../app/engine/studio.ts";
import { PrecisionTileSurface } from "../app/engine/tile-store.ts";
import { pixelAt, testCanvas } from "./canvas-harness.ts";

function rgbaSurface(width = 24, height = 24): RgbaSurface {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

function pixel(surface: RgbaSurface, x: number, y: number) {
  const offset = (y * surface.width + x) * 4;
  return [...surface.data.slice(offset, offset + 4)];
}

function imageParams(imageTip: ImageBrushTip, color = "#23b95f"): BrushParams {
  return {
    size: 12,
    hardness: 1,
    opacity: 1,
    flow: 1,
    spacing: 1,
    pressureSize: false,
    pressureOpacity: false,
    buildUp: false,
    color,
    mode: "paint",
    imageTip,
  };
}

test("full-color image tips preserve sampled colors during replay", () => {
  const data = new Uint8ClampedArray(4 * 4 * 4);
  for (let y = 0; y < 4; y += 1) for (let x = 0; x < 4; x += 1) {
    data.set(x < 2 ? [255, 0, 0, 255] : [0, 0, 255, 255], (y * 4 + x) * 4);
  }
  const tip: ImageBrushTip = { id: "color", name: "Color", width: 4, height: 4, data, mode: "color" };
  const target = rgbaSurface();
  replayStroke(target, {
    layerId: "paint",
    params: imageParams(tip),
    points: [{ x: 12, y: 12, p: 1 }],
  });
  const left = pixel(target, 9, 11);
  const right = pixel(target, 14, 11);
  assert.ok(left[0] > left[2] * 2, `expected red-dominant sampled paint, got ${left}`);
  assert.ok(right[2] > right[0] * 2, `expected blue-dominant sampled paint, got ${right}`);
  assert.ok(left[3] > 200 && right[3] > 200);
});

test("tint and stencil modes colorize alpha independently", () => {
  const data = new Uint8ClampedArray(4 * 4 * 4);
  for (let y = 0; y < 4; y += 1) for (let x = 0; x < 4; x += 1) {
    const value = x < 2 ? 0 : 255;
    data.set([value, value, value, 255], (y * 4 + x) * 4);
  }
  const tinted = rgbaSurface();
  replayStroke(tinted, {
    layerId: "paint",
    params: imageParams({ id: "tint", name: "Tint", width: 4, height: 4, data, mode: "tint" }, "#20c060"),
    points: [{ x: 12, y: 12, p: 1 }],
  });
  const tintPixel = pixel(tinted, 12, 11);
  assert.ok(tintPixel[1] > tintPixel[0] * 3 && tintPixel[1] > tintPixel[2]);

  const stencil = rgbaSurface();
  replayStroke(stencil, {
    layerId: "paint",
    params: imageParams({ id: "stencil", name: "Stencil", width: 4, height: 4, data, mode: "stencil" }, "#ff8000"),
    points: [{ x: 12, y: 12, p: 1 }],
  });
  assert.ok(pixel(stencil, 9, 11)[3] > 200, "black sample should deposit stencil paint");
  assert.ok(pixel(stencil, 14, 11)[3] < 12, "white sample should remain transparent");
});

test("float replay uses the captured tip's working-space color", () => {
  const tip: ImageBrushTip = {
    id: "float",
    name: "Float",
    width: 1,
    height: 1,
    data: new Uint8ClampedArray([255, 64, 26, 255]),
    workingData: new Float32Array([1.4, 0.22, 0.05, 1]),
    mode: "color",
  };
  const data = new Float32Array(9 * 9 * 4);
  replayStrokeFloat({ width: 9, height: 9, data }, {
    layerId: "precision",
    params: { ...imageParams(tip), size: 6 },
    points: [{ x: 4.5, y: 4.5, p: 1 }],
  });
  const offset = (4 * 9 + 4) * 4;
  assert.ok(Math.abs(data[offset] - 1.4) < 1e-5);
  assert.ok(Math.abs(data[offset + 1] - 0.22) < 1e-5);
  assert.ok(Math.abs(data[offset + 2] - 0.05) < 1e-5);
  assert.equal(data[offset + 3], 1);
});

test("Studio creates circular, bounded document brush assets and reusable tips", () => {
  const studio = new Studio(16, 16, testCanvas(16, 16));
  const source = testCanvas(16, 16);
  const context = source.getContext("2d")!;
  context.fillStyle = "#ee2244";
  context.fillRect(0, 0, 16, 16);
  context.fillStyle = "#2244ee";
  context.fillRect(6, 6, 4, 4);

  const asset = studio.addCapturedBrush("Two tone", source, 8, 8, 4);
  assert.ok(asset);
  assert.equal(asset.sourceDiameter, 8);
  assert.equal(asset.bitmap.width, 8);
  assert.equal(pixelAt(asset.bitmap, 0, 0).a, 0);
  assert.ok(pixelAt(asset.bitmap, 4, 4).b > 200);

  const tip = studio.capturedBrushTip(asset.id, "color");
  assert.ok(tip);
  assert.equal(tip.data.length, 8 * 8 * 4);
  assert.equal(tip.workingData?.length, tip.data.length);
  assert.equal(studio.removeCapturedBrush(asset.id), true);
  assert.equal(studio.capturedBrushTip(asset.id), null);
  studio.dispose();
});

test("document brush capture renders only the sampled region for merged and layer sources", () => {
  const studio = new Studio(64, 64, testCanvas(64, 64));
  const layer = studio.addBlankRaster("Sample source");
  const context = layer.bitmap!.getContext("2d")!;
  context.fillStyle = "#ed294f";
  context.fillRect(20, 20, 16, 16);
  layer.surface = PrecisionTileSurface.fromImageData(context.getImageData(0, 0, 64, 64));

  const isolated = studio.captureBrushFromDocument(28, 28, 4, { sourceLayerId: layer.id, name: "Layer sample" });
  assert.ok(isolated);
  assert.equal(isolated.bitmap.width, 8);
  assert.ok(pixelAt(isolated.bitmap, 4, 4).r > 220);

  const merged = studio.captureBrushFromDocument(28, 28, 4, { name: "Merged sample" });
  assert.ok(merged);
  assert.equal(merged.bitmap.width, 8);
  assert.ok(pixelAt(merged.bitmap, 4, 4).r > 220);
  studio.dispose();
});

test("Living Source Brush refreshes from its linked layer once content changes", () => {
  const studio = new Studio(32, 32, testCanvas(32, 32));
  const layer = studio.addBlankRaster("Living source");
  const context = layer.bitmap!.getContext("2d")!;
  context.fillStyle = "#e51d3f";
  context.fillRect(8, 8, 16, 16);
  layer.surface = PrecisionTileSurface.fromImageData(context.getImageData(0, 0, 32, 32));
  const asset = studio.captureBrushFromDocument(16, 16, 5, { sourceLayerId: layer.id, live: true });
  assert.ok(asset?.liveSource?.live);
  const center = (5 * 10 + 5) * 4;
  assert.ok(studio.capturedBrushTip(asset.id, "color")!.data[center] > 200);
  context.fillStyle = "#164dea";
  context.fillRect(8, 8, 16, 16);
  layer.surface = PrecisionTileSurface.fromImageData(context.getImageData(0, 0, 32, 32));
  assert.equal(studio.refreshCapturedBrush(asset.id), true);
  const refreshed = studio.capturedBrushTip(asset.id, "material")!;
  assert.ok(refreshed.data[center + 2] > 200);
  assert.equal(refreshed.mode, "material");
  studio.dispose();
});

test("captured brushes paint into precision layers with undo and redo", () => {
  const studio = new Studio(20, 20, testCanvas(20, 20));
  const layer = studio.addBlankRaster("Captured paint");
  const source = testCanvas(8, 8);
  const context = source.getContext("2d")!;
  context.fillStyle = "#1950e8";
  context.fillRect(0, 0, 8, 8);
  const asset = studio.addCapturedBrush("Blue sample", source)!;
  const tip = studio.capturedBrushTip(asset.id, "color")!;
  const params = { ...imageParams(tip), size: 8 };

  studio.beginStroke(layer.id, params, { x: 10.5, y: 10.5, p: 1 });
  studio.endStroke(layer.id, params);
  const painted = studio.findLayer(layer.id)!.surface!.readPixel(10, 10);
  assert.ok(painted[2] > 0.7 && painted[3] > 0.9);

  studio.undo();
  assert.equal(studio.findLayer(layer.id)!.surface!.readPixel(10, 10)[3], 0);
  studio.redo();
  assert.ok(studio.findLayer(layer.id)!.surface!.readPixel(10, 10)[2] > 0.7);
  studio.dispose();
});
