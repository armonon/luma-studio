import assert from "node:assert/strict";
import test from "node:test";
import "./canvas-harness.ts";
import { testCanvas, pixelAt } from "./canvas-harness.ts";
import { affineForLayerTransform, documentPointToLayer, layerCorners, createRasterLayer, transformPoint } from "../app/engine/document.ts";
import { drawLayerContentManaged } from "../app/engine/precision-renderer.ts";
import { Studio } from "../app/engine/studio.ts";
import { encodeLumaProject, decodeLumaProject } from "../app/engine/project.ts";
import { constrainedTranslation, cornerDragTransform, skewDragTransform, rotationDragTransform, isValidTransformQuad, transformContentBounds, snapTranslation } from "../app/studio/canvas-geometry.ts";

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
const start = { tx: 17, ty: 21, sx: 1.3, sy: .7, rotation: .4, skewX: .35 };

test("offset shape bounds drive handles, all pinned corners, skew edges and guide snapping", () => {
  const studio = new Studio(900, 600, testCanvas(900, 600));
  const layer = studio.addShapeLayer({ x: 200, y: 240, w: 240, h: 160, fill: "#000000" });
  const b = transformContentBounds(layer, 900, 600);
  assert.deepEqual(b, { x: 200, y: 240, width: 240, height: 160 });
  for (const [index, corner] of (["tl", "tr", "br", "bl"] as const).entries()) {
    layer.transform = start;
    const before = layerCorners(layer, b.width, b.height, b.x, b.y), pin = (index + 2) % 4;
    const pointer = [before[index][0] + 15, before[index][1] + 10];
    layer.transform = { ...start, ...cornerDragTransform(corner, start, b.width, b.height, pointer[0], pointer[1], false, b.x, b.y) };
    const after = layerCorners(layer, b.width, b.height, b.x, b.y);
    near(after[pin][0], before[pin][0]); near(after[pin][1], before[pin][1]);
    near(after[index][0], pointer[0]); near(after[index][1], pointer[1]);
  }
  for (const top of [true, false]) {
    layer.transform = start;
    const before = layerCorners(layer, b.width, b.height, b.x, b.y);
    layer.transform = skewDragTransform(start, top, b.height, 20, -5, b.y);
    const after = layerCorners(layer, b.width, b.height, b.x, b.y);
    for (const index of top ? [2, 3] : [0, 1]) { near(after[index][0], before[index][0]); near(after[index][1], before[index][1]); }
  }
  layer.transform = { tx: 0, ty: 0, sx: 1, sy: 1, rotation: 0 };
  near(snapTranslation(layer, { width: 900, height: 600, guides: [{ orientation: "vertical", position: 205 }] }, 1, 0, 0).tx, 5);
  studio.dispose();
});

test("text handles use bounded ink metrics rather than the full document", () => {
  const studio = new Studio(900, 600, testCanvas(900, 600));
  const layer = studio.addTextLayer("Text", { font: "24px sans-serif", x: 100, y: 100 });
  const bounds = transformContentBounds(layer, 900, 600);
  assert.ok(bounds.x >= 95 && bounds.x < 120 && bounds.width > 10 && bounds.width < 200);
  assert.ok(bounds.y > 50 && bounds.y < 110 && bounds.height < 70);
  studio.dispose();
});

test("Luma projects preserve skew and transformed coordinates on reopen", async () => {
  const studio = new Studio(32, 32, testCanvas(32, 32));
  const layer = studio.addBlankRaster("saved skew");
  studio.updateTransform(layer.id, start);
  const encoded = await encodeLumaProject(studio.doc, [], "Transform round trip");
  const decoded = await decodeLumaProject(encoded);
  assert.deepEqual(decoded.doc.layers[0].transform, start);
  studio.dispose();
});

test("skew keeps opposite edge fixed and inverse picking matches the renderer", () => {
  const layer = createRasterLayer("test", testCanvas(100, 80));
  layer.transform = start;
  const before = layerCorners(layer, 100, 80);
  layer.transform = skewDragTransform(start, true, 80, 20, -5);
  const after = layerCorners(layer, 100, 80);
  for (const index of [2, 3]) { near(after[index][0], before[index][0]); near(after[index][1], before[index][1]); }
  const mapped = transformPoint(affineForLayerTransform(layer.transform), 13, 27);
  const local = documentPointToLayer(layer.transform, mapped.x, mapped.y)!;
  near(local.x, 13); near(local.y, 27);
});

test("scaling a sheared layer pins the opposite corner and follows the pointer", () => {
  const layer = createRasterLayer("test", testCanvas(100, 80));
  layer.transform = start;
  const before = layerCorners(layer, 100, 80);
  layer.transform = { ...start, ...cornerDragTransform("br", start, 100, 80, 200, 150) };
  const after = layerCorners(layer, 100, 80);
  near(after[0][0], before[0][0]); near(after[0][1], before[0][1]);
  near(after[2][0], 200); near(after[2][1], 150);
  const constrained = cornerDragTransform("br", start, 100, 80, 200, 150, true);
  near(constrained.sx / constrained.sy, start.sx / start.sy);
});

test("constrained rotation preserves the sheared center and snaps to 15 degrees", () => {
  const center = transformPoint(affineForLayerTransform(start), 50, 40);
  const next = rotationDragTransform(start, .23, center.x, center.y, true);
  const moved = transformPoint(affineForLayerTransform(next), 50, 40);
  near(moved.x, center.x); near(moved.y, center.y);
  near(next.rotation / (Math.PI / 12), Math.round(next.rotation / (Math.PI / 12)));
  assert.deepEqual(constrainedTranslation(22, 4, true), { dx: 22, dy: 0 });
  assert.deepEqual(constrainedTranslation(2, -31, true), { dx: 0, dy: -31 });
});

test("transform bursts create one undo; cancel restores pixels' placement without history", () => {
  const studio = new Studio(32, 32, testCanvas(32, 32));
  const layer = studio.addBlankRaster("transform");
  const original = { ...layer.transform };
  const before = studio.historyState().nodes.length;
  for (let i = 1; i <= 100; i++) studio.liveUpdateTransform(layer.id, { tx: i, skewX: i / 100 });
  studio.updateTransform(layer.id, {});
  assert.equal(studio.historyState().nodes.length, before + 1);
  studio.undo(); assert.deepEqual(layer.transform, original);
  studio.redo(); assert.equal(layer.transform.tx, 100); assert.equal(layer.transform.skewX, 1);
  studio.liveUpdateTransform(layer.id, { tx: 200, skewX: 2 });
  studio.cancelLiveTransform(layer.id);
  assert.equal(layer.transform.tx, 100); assert.equal(layer.transform.skewX, 1);
  assert.equal(studio.historyState().nodes.length, before + 1);
  studio.resetTransform(layer.id); assert.equal(layer.transform.skewX, 0);
  studio.dispose();
});

test("managed tiled rendering includes skew, not just the bitmap fallback", () => {
  const studio = new Studio(32, 32, testCanvas(32, 32));
  const layer = studio.addBlankRaster("skewed");
  studio.fillLayer(layer.id, "#ff0000");
  studio.updateTransform(layer.id, { skewX: 1 });
  const output = testCanvas(64, 32);
  drawLayerContentManaged(output.getContext("2d")!, layer);
  assert.equal(pixelAt(output, 4, 20).a, 0);
  assert.ok(pixelAt(output, 40, 20).a > 0);
  studio.dispose();
});

test("distortion rejects crossed, singular, malformed, masked and over-budget inputs", () => {
  const valid = [{ x: 0, y: 0 }, { x: 16, y: 0 }, { x: 14, y: 16 }, { x: 2, y: 16 }] as const;
  assert.ok(isValidTransformQuad(valid));
  assert.equal(isValidTransformQuad([valid[0], valid[2], valid[1], valid[3]]), false);
  const studio = new Studio(16, 16, testCanvas(16, 16));
  const layer = studio.addBlankRaster("distort");
  studio.fillLayer(layer.id, "#ff0000");
  const original = layer.bitmap;
  assert.equal(studio.distortLayer(layer.id, [valid[0], valid[2], valid[1], valid[3]]), false);
  assert.equal(layer.bitmap, original);
  layer.locked = true; assert.ok(studio.distortionUnavailableReason(layer.id)); layer.locked = false;
  layer.mask = testCanvas(16, 16); assert.equal(studio.distortLayer(layer.id, valid), false); layer.mask = undefined;
  studio.doc.bitDepth = 16; assert.equal(studio.distortLayer(layer.id, valid), false); studio.doc.bitDepth = 8;
  studio.doc.width = 50_000; assert.equal(studio.distortLayer(layer.id, valid), false); studio.doc.width = 16;
  const before = studio.historyState().nodes.length;
  assert.equal(studio.distortLayer(layer.id, valid), true);
  assert.equal(studio.historyState().nodes.length, before + 1);
  assert.equal(pixelAt(layer.bitmap!, 0, 15).a, 0);
  studio.undo(); assert.equal(pixelAt(layer.bitmap!, 0, 15).a, 255);
  studio.redo(); assert.equal(pixelAt(layer.bitmap!, 0, 15).a, 0);
  studio.dispose();
});
