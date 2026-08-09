import assert from "node:assert/strict";
import test from "node:test";
import "./canvas-harness.ts";
import { Studio } from "../app/engine/studio.ts";
import { testCanvas } from "./canvas-harness.ts";

test("smart filters can be edited, disabled, reordered, and undone", () => {
  const studio = new Studio(16, 16, testCanvas(16, 16));
  const layer = studio.addBlankRaster();
  const blur = studio.addSmartFilter(layer.id, "blur", { radius: 4 })!;
  const hue = studio.addSmartFilter(layer.id, "hue", { degrees: 20 })!;

  studio.updateSmartFilter(layer.id, blur.id, { opacity: 2, params: { radius: 12 } });
  assert.equal(blur.opacity, 1);
  assert.equal(blur.params.radius, 12);
  studio.updateSmartFilter(layer.id, blur.id, { enabled: false });
  assert.equal(blur.enabled, false);

  assert.equal(studio.moveSmartFilter(layer.id, hue.id, -1), true);
  assert.deepEqual(layer.filters!.map((filter) => filter.id), [hue.id, blur.id]);
  studio.undo();
  assert.deepEqual(layer.filters!.map((filter) => filter.id), [blur.id, hue.id]);
  studio.dispose();
});

test("live smart-filter edits collapse to one committed history change", () => {
  const studio = new Studio(16, 16, testCanvas(16, 16));
  const layer = studio.addBlankRaster();
  const filter = studio.addSmartFilter(layer.id, "sharpen", { amount: 0.5 })!;
  studio.liveUpdateSmartFilter(layer.id, filter.id, { params: { amount: 0.75 } });
  studio.liveUpdateSmartFilter(layer.id, filter.id, { params: { amount: 1.25 } });
  studio.updateSmartFilter(layer.id, filter.id, { params: { amount: 1.5 } });
  assert.equal(filter.params.amount, 1.5);
  studio.undo();
  assert.equal(layer.filters![0].params.amount, 0.5);
  studio.dispose();
});
