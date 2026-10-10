import test from "node:test";
import assert from "node:assert/strict";
import "./canvas-harness.ts";
import { testCanvas } from "./canvas-harness.ts";
import { Studio } from "../app/engine/studio.ts";

for (const key of ["opacity", "fillOpacity"] as const) {
  test(`UI subscribers observe every ${key} preview while one final edit remains undoable`, () => {
    const studio = new Studio(4, 4, testCanvas(4, 4));
    try {
      const layer = studio.addBlankRaster("Range");
      const before = layer[key] ?? 1;
      let displayed = before;
      const unsubscribe = studio.subscribe(() => { displayed = studio.findLayer(layer.id)![key] ?? 1; });
      const nodeCount = studio.historyState().nodes.length;
      for (const value of [.5, .6, .63]) {
        studio.liveUpdateLayerProp(layer.id, key, value);
        assert.equal(displayed, value, "controlled UI must receive the new live value");
        assert.equal(studio.historyState().nodes.length, nodeCount, "preview must not add history entries");
      }
      studio.setLayerProp(layer.id, key, .63);
      studio.undo(); assert.equal(studio.findLayer(layer.id)![key] ?? 1, before);
      studio.redo(); assert.equal(studio.findLayer(layer.id)![key], .63);
      unsubscribe();
    } finally { studio.dispose(); }
  });
}
