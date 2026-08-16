import assert from "node:assert/strict";
import test from "node:test";
import "./canvas-harness.ts";
import { Studio } from "../app/engine/studio.ts";
import { testCanvas } from "./canvas-harness.ts";

test("the radial deformation records an honest history label", () => {
  const studio = new Studio(12, 10, testCanvas(12, 10));
  const layer = studio.addBlankRaster("Pixels");
  assert.equal(studio.radialWarpLayer(layer.id, { x: 4, y: 5 }, { x: 7, y: 5 }, 4), true);
  assert.equal(studio.historyLabels().at(-1), "Radial warp");
});

