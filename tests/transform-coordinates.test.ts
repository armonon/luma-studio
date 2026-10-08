import assert from "node:assert/strict";
import test from "node:test";
import "./canvas-harness.ts";
import {
  documentPointToLayer,
  rotateLayerTransformAround,
} from "../app/engine/document.ts";
import { Studio } from "../app/engine/studio.ts";
import { selectionSurface } from "../app/engine/selection.ts";
import type { BrushParams } from "../app/engine/brush.ts";
import { pixelAt, testCanvas } from "./canvas-harness.ts";

test("document coordinates invert translated, scaled, and rotated layer transforms", () => {
  const transform = { tx: 10, ty: 20, sx: 2, sy: 4, rotation: Math.PI / 2 };
  // Local (3, 2) maps to document (2, 26).
  const local = documentPointToLayer(transform, 2, 26);
  assert.ok(local);
  assert.ok(Math.abs(local.x - 3) < 1e-9);
  assert.ok(Math.abs(local.y - 2) < 1e-9);
});

test("eyedropper samples transformed layer pixels and rejects points outside the layer", () => {
  const studio = new Studio(8, 8, testCanvas(8, 8));
  const layer = studio.addBlankRaster("sample");
  const context = layer.bitmap!.getContext("2d")!;
  context.fillStyle = "#ff0000";
  context.fillRect(1, 1, 1, 1);
  layer.transform = { tx: 2, ty: 1, sx: 2, sy: 2, rotation: 0 };

  assert.equal(studio.sampleLayerColor(layer.id, 4.5, 3.5), "#ff0000");
  assert.equal(studio.sampleLayerColor(layer.id, 1, 1), null);
  studio.dispose();
});

test("merged eyedropper sampling uses the bounded viewport compositor", () => {
  const studio = new Studio(32, 32, testCanvas(32, 32));
  const layer = studio.addBlankRaster("merged sample");
  studio.fillLayer(layer.id, "#39b86a");
  // Sampling the merged 8-bit bitmap must retain the fill's exact sRGB code,
  // not the old one-code drift introduced by its linear rgba8 derivative.
  assert.equal(studio.sampleLayerColor(layer.id, 7, 11, true), "#39b86a");
  studio.dispose();
});

test("generated document-space fills are inverse-mapped into transformed layers", () => {
  const studio = new Studio(8, 8, testCanvas(8, 8));
  const layer = studio.addBlankRaster("fill");
  layer.transform = { tx: 2, ty: 0, sx: 1, sy: 1, rotation: 0 };
  assert.equal(studio.gradientFill(layer.id, { x: 0, y: 0 }, { x: 8, y: 0 }, "#ff0000", "#ff0000"), true);
  assert.deepEqual(pixelAt(layer.bitmap!, 0, 0), { r: 255, g: 0, b: 0, a: 255 });
  assert.deepEqual(pixelAt(layer.bitmap!, 7, 0), { r: 0, g: 0, b: 0, a: 0 });
  studio.dispose();
});

test("selected fill and clear use transformed layer space and bounded history patches", () => {
  const studio = new Studio(512, 384, testCanvas(512, 384));
  const layer = studio.addBlankRaster("bounded fill");
  layer.transform = { tx: 20, ty: 10, sx: 2, sy: 2, rotation: 0 };
  studio.selectRect(40, 30, 12, 10);
  const beforeFill = studio.historyState().bytes;

  studio.fillLayer(layer.id, "#ff0000");
  assert.deepEqual(pixelAt(layer.bitmap!, 11, 11), { r: 255, g: 0, b: 0, a: 255 });
  assert.deepEqual(pixelAt(layer.bitmap!, 9, 11), { r: 0, g: 0, b: 0, a: 0 });
  assert.ok(studio.historyState().bytes - beforeFill < 10_000, "history must scale with the 6×5 layer-space selection");

  studio.clearPixels(layer.id);
  assert.equal(pixelAt(layer.bitmap!, 11, 11).a, 0);
  studio.undo();
  assert.equal(pixelAt(layer.bitmap!, 11, 11).a, 255);
  studio.undo();
  assert.equal(pixelAt(layer.bitmap!, 11, 11).a, 0);
  studio.redo();
  assert.equal(pixelAt(layer.bitmap!, 11, 11).a, 255);
  studio.dispose();
});

test("straightening composes a document-space rotation around the canvas center", () => {
  const rotated = rotateLayerTransformAround(
    { tx: 2, ty: 3, sx: 1.5, sy: 0.75, rotation: 0.25 },
    Math.PI / 2,
    10,
    10,
  );
  assert.ok(Math.abs(rotated.tx - 17) < 1e-9);
  assert.ok(Math.abs(rotated.ty - 2) < 1e-9);
  assert.ok(Math.abs(rotated.rotation - (0.25 + Math.PI / 2)) < 1e-9);
  assert.equal(rotated.sx, 1.5);
  assert.equal(rotated.sy, 0.75);
});

const brush: BrushParams = {
  size: 3,
  hardness: 1,
  opacity: 1,
  flow: 1,
  spacing: 0.15,
  pressureSize: false,
  pressureOpacity: false,
  color: "#00ff00",
  mode: "paint",
};

test("painting and magic-wand selection operate in transformed layer space", () => {
  const studio = new Studio(16, 16, testCanvas(16, 16));
  const layer = studio.addBlankRaster("transformed paint");
  layer.transform = { tx: 4, ty: 2, sx: 2, sy: 2, rotation: 0 };
  studio.beginStroke(layer.id, brush, { x: 7, y: 5, p: 1 });
  studio.endStroke(layer.id, brush);
  assert.ok(layer.surface!.sampleBilinearWorking(1.5, 1.5)[1] > 0.8);

  studio.selectByColor(layer.id, 7, 5, 16, "replace", true);
  const selected = selectionSurface(studio.doc)!.sample(7, 5);
  assert.equal(selected, 255);
  studio.dispose();
});
