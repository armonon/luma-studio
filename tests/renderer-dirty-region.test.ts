import assert from "node:assert/strict";
import test from "node:test";
import { pixelAt, solidCanvas, testCanvas } from "./canvas-harness.ts";
import { createDocument, createRasterLayer } from "../app/engine/document.ts";
import {
  renderViewport,
  viewportRenderCacheStats,
  viewportRenderPerformanceStats,
  viewportTileKeysForDirtyRegions,
} from "../app/engine/renderer.ts";
import type { DisplayViewport } from "../app/engine/viewport.ts";

const viewport: DisplayViewport = {
  x: 0,
  y: 0,
  width: 512,
  height: 512,
  zoom: 1,
  outputWidth: 512,
  outputHeight: 512,
  cssScale: 1,
  devicePixelRatio: 1,
};

test("dirty document rectangles map to the minimum intersecting screen tiles", () => {
  assert.deepEqual(
    [...viewportTileKeysForDirtyRegions(viewport, [{ x: 10, y: 10, width: 20, height: 20 }])],
    ["0:0"],
  );
  assert.deepEqual(
    [...viewportTileKeysForDirtyRegions(viewport, [{ x: 250, y: 250, width: 20, height: 20 }])].sort(),
    ["0:0", "0:1", "1:0", "1:1"],
  );
  assert.equal(
    viewportTileKeysForDirtyRegions(viewport, [{ x: 900, y: 900, width: 10, height: 10 }]).size,
    0,
  );
});

test("incremental viewport rendering preserves clean tiles", () => {
  const doc = createDocument(512, 512);
  const bitmap = solidCanvas(512, 512, "#ff0000");
  doc.layers = [createRasterLayer("Paint", bitmap)];
  const target = testCanvas(512, 512);

  renderViewport(doc, target, viewport, { checkerboard: false, cacheRevision: 1 });
  assert.equal(pixelAt(target, 400, 400).r, 255);

  bitmap.getContext("2d")!.fillStyle = "#0000ff";
  bitmap.getContext("2d")!.fillRect(0, 0, 512, 512);
  renderViewport(doc, target, viewport, {
    checkerboard: false,
    cacheRevision: 2,
    dirtyRegions: [{ x: 10, y: 10, width: 20, height: 20 }],
  });

  assert.equal(pixelAt(target, 20, 20).b, 255, "dirty tile was recomposited");
  assert.equal(pixelAt(target, 400, 400).r, 255, "clean tile was preserved");
  const stats = viewportRenderPerformanceStats();
  assert.equal(stats.latestPartial, true);
  assert.equal(stats.latestRenderedTiles, 1);
  assert.equal(stats.latestTotalTiles, 4);
});

test("channel inspection renders grayscale channels without altering document pixels", () => {
  const doc = createDocument(512, 512);
  doc.layers = [createRasterLayer("Color", solidCanvas(512, 512, "#804020"))];
  const target = testCanvas(512, 512);
  renderViewport(doc, target, viewport, { checkerboard: false, channelView: "red" });
  const inspected = pixelAt(target, 10, 10);
  assert.deepEqual([inspected.r, inspected.g, inspected.b], [128, 128, 128]);
  const source = pixelAt(doc.layers[0].bitmap!, 10, 10);
  assert.deepEqual([source.r, source.g, source.b], [128, 64, 32]);
});

test("selection-only repaints reuse composite tiles when the content revision is stable", () => {
  const doc = createDocument(512, 512);
  doc.layers = [createRasterLayer("Color", solidCanvas(512, 512, "#804020"))];
  const selectionMask = solidCanvas(512, 512, "rgba(255, 255, 255, 1)");
  doc.selection = { mask: selectionMask, bounds: { x: 10, y: 10, w: 40, h: 40 } };
  const target = testCanvas(512, 512);

  renderViewport(doc, target, viewport, { checkerboard: false, cacheRevision: 99 });
  const before = viewportRenderCacheStats();
  renderViewport(doc, target, viewport, { checkerboard: false, cacheRevision: 99 });
  const after = viewportRenderCacheStats();

  assert.equal(after.misses, before.misses);
  assert.equal(after.hits - before.hits, 4);
});

test("renderer scratch and viewport caches expose strict memory ceilings", () => {
  const stats = viewportRenderCacheStats();
  assert.equal(stats.maxBytesPerDocument, 32 * 1024 * 1024);
  assert.ok(stats.scratchCacheEntries <= 6);
  assert.ok(stats.scratchCacheBytes <= stats.maxScratchCacheBytes);
});

test("Focus Off isolates one layer while Full preserves the project composite", () => {
  const doc = createDocument(512, 512);
  const blue = createRasterLayer("Blue", solidCanvas(512, 512, "#0000ff"));
  const red = createRasterLayer("Red", solidCanvas(512, 512, "#ff0000"));
  doc.layers = [blue, red];
  const target = testCanvas(512, 512);

  renderViewport(doc, target, viewport, { checkerboard: false, cacheRevision: 200, focus: { layerId: red.id, target: "pixels", context: "off" } });
  assert.deepEqual(pixelAt(target, 10, 10), { r: 255, g: 0, b: 0, a: 255 });
  renderViewport(doc, target, viewport, { checkerboard: false, cacheRevision: 200, focus: { layerId: red.id, target: "pixels", context: "full" } });
  assert.deepEqual(pixelAt(target, 10, 10), { r: 0, g: 0, b: 255, a: 255 });
});

test("Focus Ghost keeps muted project context underneath the active layer", () => {
  const doc = createDocument(512, 512);
  const focusedBitmap = testCanvas(512, 512);
  focusedBitmap.getContext("2d")!.fillStyle = "#ff0000";
  focusedBitmap.getContext("2d")!.fillRect(0, 0, 256, 512);
  const focused = createRasterLayer("Focused", focusedBitmap);
  const context = createRasterLayer("Context", solidCanvas(512, 512, "#0000ff"));
  doc.layers = [focused, context];
  const target = testCanvas(512, 512);

  renderViewport(doc, target, viewport, { checkerboard: false, cacheRevision: 201, focus: { layerId: focused.id, target: "pixels", context: "ghost" } });
  assert.deepEqual(pixelAt(target, 20, 20), { r: 255, g: 0, b: 0, a: 255 });
  const ghost = pixelAt(target, 400, 20);
  assert.ok(ghost.a > 70 && ghost.a < 120, `expected muted context alpha, received ${ghost.a}`);
  assert.ok(ghost.b > ghost.r);
});

test("focused masks render as an unambiguous grayscale editing target", () => {
  const doc = createDocument(512, 512);
  const layer = createRasterLayer("Masked", solidCanvas(512, 512, "#ff0000"));
  layer.mask = testCanvas(512, 512);
  layer.mask.getContext("2d")!.fillStyle = "rgba(0,0,0,1)";
  layer.mask.getContext("2d")!.fillRect(0, 0, 256, 512);
  doc.layers = [layer];
  const target = testCanvas(512, 512);

  renderViewport(doc, target, viewport, { checkerboard: false, cacheRevision: 202, focus: { layerId: layer.id, target: "mask", context: "off" } });
  const inside = pixelAt(target, 20, 20);
  const outside = pixelAt(target, 400, 20);
  assert.ok(inside.r > 240 && inside.g > 240 && inside.b > 240);
  assert.ok(outside.r < 50 && outside.g < 50 && outside.b < 50);
});
