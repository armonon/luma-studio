import assert from "node:assert/strict";
import test from "node:test";
import { setLayerMaskFromCanvas } from "../app/engine/layer-mask.ts";
import { pixelAt, solidCanvas, testCanvas } from "./canvas-harness.ts";
import { createAdjustmentLayer, createDocument, createRasterLayer, newCanvas, NEUTRAL_TONE } from "../app/engine/document.ts";
import {
  renderViewport,
  rendererLayerPlanningStats,
  viewportRenderCacheStats,
  viewportRenderPerformanceStats,
  viewportLayerPlan,
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

test("content edits with a selection repaint only dirty and outline tiles", () => {
  const doc = createDocument(512, 512);
  const bitmap = solidCanvas(512, 512, "#ff0000");
  doc.layers = [createRasterLayer("Paint", bitmap)];
  const selectionMask = testCanvas(512, 512);
  selectionMask.getContext("2d")!.fillStyle = "#ffffff";
  selectionMask.getContext("2d")!.fillRect(10, 10, 40, 40);
  doc.selection = {
    mask: selectionMask,
    bounds: { x: 10, y: 10, w: 40, h: 40 },
  };
  const target = testCanvas(512, 512);
  renderViewport(doc, target, viewport, { checkerboard: false, cacheRevision: 300 });

  bitmap.getContext("2d")!.fillStyle = "#0000ff";
  bitmap.getContext("2d")!.fillRect(300, 300, 20, 20);
  renderViewport(doc, target, viewport, {
    checkerboard: false,
    cacheRevision: 301,
    dirtyRegions: [{ x: 300, y: 300, width: 20, height: 20 }],
  });

  const stats = viewportRenderPerformanceStats();
  assert.equal(stats.latestPartial, true);
  assert.equal(stats.latestRenderedTiles, 2);
  assert.equal(stats.latestTotalTiles, 4);
  assert.equal(pixelAt(target, 310, 310).b, 255);
  assert.equal(pixelAt(target, 400, 100).r, 255, "clean non-selection tile was preserved");
});

test("neutral tone layers are exact no-ops while non-neutral tone still renders", () => {
  const bitmap = testCanvas(512, 512);
  const bitmapContext = bitmap.getContext("2d")!;
  bitmapContext.fillStyle = "rgba(180, 60, 20, 0.45)";
  bitmapContext.fillRect(0, 0, 512, 512);
  const base = createRasterLayer("Translucent", bitmap);

  const plain = createDocument(512, 512);
  plain.layers = [base];
  const expected = testCanvas(512, 512);
  renderViewport(plain, expected, viewport, { checkerboard: false });

  const reset = createDocument(512, 512);
  reset.layers = [createAdjustmentLayer("Reset", { ...NEUTRAL_TONE }), base];
  const actual = testCanvas(512, 512);
  renderViewport(reset, actual, viewport, { checkerboard: false });
  assert.deepEqual(pixelAt(actual, 20, 20), pixelAt(expected, 20, 20));

  reset.layers[0].tone = { ...NEUTRAL_TONE, contrast: 30 };
  renderViewport(reset, actual, viewport, { checkerboard: false });
  assert.notDeepEqual(pixelAt(actual, 20, 20), pixelAt(expected, 20, 20));
});

test("renderer scratch and viewport caches expose strict memory ceilings", () => {
  const stats = viewportRenderCacheStats();
  assert.equal(stats.maxBytesPerDocument, 32 * 1024 * 1024);
  assert.ok(stats.scratchCacheEntries <= 6);
  assert.ok(stats.scratchCacheBytes <= stats.maxScratchCacheBytes);
});

test("large layer stacks use one render-planning pass for effects and backdrop", () => {
  const pixel = testCanvas(1, 1);
  const layers = Array.from({ length: 20_000 }, (_, index) => createRasterLayer(`Layer ${index}`, pixel));
  layers[19_998].filters = [{ id: "blur", kind: "blur", enabled: true, opacity: 1, params: { radius: 10 } }];
  layers[19_999].effects = [{
    id: "reflection",
    kind: "reflection",
    enabled: true,
    opacity: 0.5,
    color: "#ffffff",
    blur: 0,
    offsetX: 0,
    offsetY: 0,
  }];
  // Exact three-box Gaussian support is 58px here; the old 3×radius estimate
  // over-rendered two pixels on every tile edge.
  assert.deepEqual(viewportLayerPlan(layers, 2), { fullBackdrop: true, overscan: 58 });
});

test("content frames reuse the prepared hierarchy until structure changes", () => {
  const doc = createDocument(512, 512);
  doc.layers = [createRasterLayer("Paint", solidCanvas(512, 512, "#333333"))];
  const target = testCanvas(512, 512);
  const before = rendererLayerPlanningStats();
  renderViewport(doc, target, viewport, { checkerboard: false, cacheRevision: 700, hierarchyRevision: 9 });
  renderViewport(doc, target, viewport, { checkerboard: false, cacheRevision: 701, hierarchyRevision: 9 });
  const after = rendererLayerPlanningStats();
  assert.equal(after.misses - before.misses, 1);
  assert.equal(after.hits - before.hits, 1);
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

test("a layer mask lands on the same pixels as the layer it masks", () => {
  // drawLayerMaskProjected read the mask through readRegion, which floors the
  // origin and ceils the extent, then stretched that whole-pixel bitmap across
  // the output as though it covered the exact fractional frame. The per-tile
  // frame is `viewport.x + expandedLeft / scaleX`, fractional for nearly every
  // tile and differently so per tile, so the mask drifted a pixel or two from
  // its own layer and seamed at tile boundaries — while export, which renders
  // one untiled integral frame, stayed correct. Preview disagreed with the file.
  const DOC = 512;
  const OUT = 512;

  const transparentColumns = (mode: "content" | "mask", viewportX: number, zoom: number, gapX: number) => {
    const doc = createDocument(DOC, DOC);
    const bitmap = newCanvas(DOC, DOC);
    const paint = bitmap.getContext("2d")!;
    paint.fillStyle = "#ffffff";
    paint.fillRect(0, 0, DOC, DOC);
    if (mode === "content") paint.clearRect(gapX, 0, 8, DOC);

    const layer = createRasterLayer("masked", bitmap);
    if (mode === "mask") {
      const mask = newCanvas(DOC, DOC);
      const maskPaint = mask.getContext("2d")!;
      maskPaint.fillStyle = "#ffffff";
      maskPaint.fillRect(0, 0, DOC, DOC);
      maskPaint.clearRect(gapX, 0, 8, DOC);
      setLayerMaskFromCanvas(layer, mask, DOC, DOC);
    }
    doc.layers = [layer];

    const out = testCanvas(OUT, OUT);
    renderViewport(doc, out, {
      x: viewportX, y: 0, width: OUT / zoom, height: OUT / zoom,
      zoom, outputWidth: OUT, outputHeight: OUT, cssScale: 1, devicePixelRatio: 1,
    }, { checkerboard: false, selectionOverlay: false, proofing: false });

    const columns: number[] = [];
    for (let x = 0; x < OUT; x += 1) if (pixelAt(out, x, 60).a < 128) columns.push(x);
    return columns.join(",");
  };

  // Each case puts the gap across the output-256 tile seam, where the per-tile
  // fractional origin differs between neighbouring tiles.
  for (const [viewportX, zoom] of [[84, 3], [84.4, 3], [37.3, 2]] as Array<[number, number]>) {
    const gapX = Math.round(viewportX + 256 / zoom) - 4;
    assert.equal(
      transparentColumns("mask", viewportX, zoom, gapX),
      transparentColumns("content", viewportX, zoom, gapX),
      `mask and content must coincide at viewportX=${viewportX} zoom=${zoom}`,
    );
  }
});
