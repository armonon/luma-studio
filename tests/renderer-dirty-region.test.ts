import assert from "node:assert/strict";
import test from "node:test";
import { pixelAt, solidCanvas, testCanvas } from "./canvas-harness.ts";
import { createDocument, createRasterLayer } from "../app/engine/document.ts";
import {
  renderViewport,
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
