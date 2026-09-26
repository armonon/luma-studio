import test from "node:test";
import assert from "node:assert/strict";
import { Studio } from "../app/engine/studio";
import { pixelAt, testCanvas } from "./canvas-harness";

const operations = {
  gradient: (s: Studio, id: string) => s.gradientFill(id, { x: 0, y: 0 }, { x: 16, y: 16 }, "blue", "white"),
  pattern: (s: Studio, id: string) => s.patternFill(id, "checker", "blue", "white", 4),
  perspective: (s: Studio, id: string) => s.perspectiveWarpLayer(id, [{ x: 1, y: 1 }, { x: 14, y: 1 }, { x: 15, y: 14 }, { x: 0, y: 15 }]),
  fill: (s: Studio, id: string) => s.fillLayer(id, "blue"),
  clear: (s: Studio, id: string) => s.clearPixels(id),
};

for (const [name, run] of Object.entries(operations)) for (const boundary of ["syncLayerSurface", "commit"] as const) {
  test(`${name}: ${boundary} failure rolls back pixels, transform and history`, () => {
    const studio = new Studio(16, 16, testCanvas(1, 1));
    try {
      const layer = studio.addBlankRaster("Original"); studio.fillLayer(layer.id, "red");
      // Exercise the canvas-only legacy delete path as well as precision-backed fills.
      if (name === "clear") layer.surface = undefined;
      layer.transform = { ...layer.transform, tx: 2 };
      const bitmap = layer.bitmap, surface = layer.surface, transform = layer.transform;
      const originalTiles = surface ? [...surface.store.keys()].map(key => [key, surface.store.read(key)] as const) : [];
      const node = studio.historyState().currentId;
      const internal = studio as unknown as Record<typeof boundary, (...args: unknown[]) => unknown>;
      const original = internal[boundary];
      internal[boundary] = () => { throw new Error("Injected boundary failure"); };
      try {
        assert.throws(() => run(studio, layer.id), /Injected boundary/);
        assert.equal(layer.bitmap, bitmap); assert.equal(layer.surface, surface);
        assert.deepEqual(layer.transform, transform);
        assert.deepEqual(pixelAt(layer.bitmap!, 3, 3), { r: 255, g: 0, b: 0, a: 255 });
        assert.equal(studio.historyState().currentId, node);
        for (const [key, data] of originalTiles) assert.deepEqual(surface!.store.read(key), data);
      } finally { internal[boundary] = original; }
      run(studio, layer.id);
      assert.notEqual(studio.historyState().currentId, node);
      studio.undo(); assert.equal(studio.historyState().currentId, node);
      assert.deepEqual(pixelAt(studio.findLayer(layer.id)!.bitmap!, 3, 3), { r: 255, g: 0, b: 0, a: 255 });
      studio.redo(); assert.notEqual(studio.historyState().currentId, node);
    } finally { studio.dispose(); }
  });
}

test("generated fills and warp reject excessive scratch before touching a small layer", () => {
  const studio = new Studio(16, 16, testCanvas(1, 1));
  try {
    const layer = studio.addBlankRaster("Original"); studio.fillLayer(layer.id, "red");
    studio.doc.width = 8000; studio.doc.height = 8000;
    const node = studio.historyState().currentId, bitmap = layer.bitmap;
    for (const run of [operations.gradient, operations.pattern, operations.perspective]) {
      assert.throws(() => run(studio, layer.id), /memory|budget|ceiling/i);
      assert.equal(layer.bitmap, bitmap); assert.equal(studio.historyState().currentId, node);
    }
  } finally { studio.dispose(); }
});
