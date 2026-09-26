import assert from "node:assert/strict";
import test from "node:test";
import "./canvas-harness.ts";
import { Studio } from "../app/engine/studio.ts";
import { testCanvas } from "./canvas-harness.ts";
import { radialWarp } from "../app/engine/advanced-tools.ts";

test("the radial deformation records an honest history label", () => {
  const studio = new Studio(12, 10, testCanvas(12, 10));
  const layer = studio.addBlankRaster("Pixels");
  assert.equal(studio.radialWarpLayer(layer.id, { x: 4, y: 5 }, { x: 7, y: 5 }, 4), true);
  assert.equal(studio.historyLabels().at(-1), "Radial warp");
  studio.dispose();
});

test("regional warp matches whole-layer sampling, including edges and long reverse samples", async () => {
  for (const [from, to] of [[{ x: 30, y: 30 }, { x: 36, y: 33 }], [{ x: 40, y: 10 }, { x: 2, y: 2 }], [{ x: 2, y: 2 }, { x: 61, y: 59 }]]) {
    const studio = new Studio(64, 64, testCanvas(1, 1));
    const reopened = new Studio(8, 8, testCanvas(1, 1));
    try {
      const layer = studio.addBlankRaster("Pixels"), ctx = layer.bitmap!.getContext("2d")!;
      const original = ctx.createImageData(64, 64);
      for (let i = 0; i < original.data.length; i += 4) original.data.set([(i / 4) % 251, (i / 16) % 251, (i / 64) % 251, 255], i);
      ctx.putImageData(original, 0, 0);
      const expected = radialWarp(original, from, to, 8);
      assert.equal(studio.radialWarpLayer(layer.id, from, to, 8), true);
      assert.deepEqual(ctx.getImageData(0, 0, 64, 64).data, expected.data);
      const saved = await studio.exportProject("Warp history");
      await reopened.importProject(saved);
      const restored = reopened.doc.layers[0].bitmap!.getContext("2d")!;
      assert.deepEqual(restored.getImageData(0, 0, 64, 64).data, expected.data);
      reopened.undo(); assert.deepEqual(restored.getImageData(0, 0, 64, 64).data, original.data);
      reopened.redo(); assert.deepEqual(restored.getImageData(0, 0, 64, 64).data, expected.data);
    } finally { studio.dispose(); reopened.dispose(); }
  }
});

test("warp clicks/outside gestures do not add history; local edits retain only regional history", () => {
  const studio = new Studio(1024, 1024, testCanvas(1, 1));
  try {
    const layer = studio.addBlankRaster("Pixels"), before = studio.historyState();
    assert.equal(studio.radialWarpLayer(layer.id, { x: 30, y: 30 }, { x: 30, y: 30 }, 30), false);
    assert.equal(studio.radialWarpLayer(layer.id, { x: -100, y: -100 }, { x: -80, y: -80 }, 10), false);
    assert.throws(() => studio.radialWarpLayer(layer.id, { x: NaN, y: 0 }, { x: 1, y: 1 }, 10), /finite/);
    assert.throws(() => studio.radialWarpLayer(layer.id, { x: -1e308, y: 0 }, { x: 1e308, y: 1 }, 10), /finite displacement/);
    assert.equal(studio.historyState().currentId, before.currentId);
    studio.radialWarpLayer(layer.id, { x: 500, y: 500 }, { x: 510, y: 510 }, 30);
    assert.ok(studio.historyState().bytes - before.bytes < 40_000, "61px region, not a 1024px layer snapshot");
  } finally { studio.dispose(); }
});

test("regional warp undo restores the exact high-depth master, including after native reopen", async () => {
  const studio = new Studio(32, 32, testCanvas(1, 1));
  const reopened = new Studio(8, 8, testCanvas(1, 1));
  try {
    studio.setDocumentPrecision(32, "srgb");
    const layer = studio.addBlankRaster("Float pixels");
    layer.surface!.writePixel(12, 12, [0.123456, 0.654321, 1.2, 1]);
    const key = layer.surface!.grid.address(0, 0).key;
    const original = layer.surface!.store.read(key);
    studio.radialWarpLayer(layer.id, {x:12,y:12}, {x:14,y:14}, 5);
    const warped = layer.surface!.store.read(key);
    assert.notDeepEqual(warped, original);
    studio.undo(); assert.deepEqual(layer.surface!.store.read(key), original);
    studio.redo(); assert.deepEqual(layer.surface!.store.read(key), warped);
    await reopened.importProject(await studio.exportProject("Float warp history"));
    reopened.undo(); assert.deepEqual(reopened.doc.layers[0].surface!.store.read(key), original);
    reopened.redo(); assert.deepEqual(reopened.doc.layers[0].surface!.store.read(key), warped);
  } finally { studio.dispose(); reopened.dispose(); }
});
