import assert from "node:assert/strict";
import test from "node:test";
import { Studio } from "../app/engine/studio.ts";
import { ActionPlaybackError } from "../app/engine/action-playback.ts";
import { testCanvas } from "./canvas-harness.ts";

test("invalid actions are rejected before even a valid first step runs", () => {
  const studio = new Studio(8, 8, testCanvas(8, 8));
  assert.throws(() => studio.replay({ name: "Bad", steps: [{ op: "addRaster", name: "must not exist" }, { op: "bogus" }] } as never, null), /malformed/);
  assert.equal(studio.doc.layers.length, 0);
  studio.dispose();
});

test("playback stops on the actual failed step, preserves prior undoable changes and never runs later steps", () => {
  const studio = new Studio(8, 8, testCanvas(8, 8));
  const report = studio.replayWithReport({ name: "Treatment", steps: [
    { op: "addRaster", name: "Created" }, { op: "updateText", text: { text: "wrong target", font: "16px sans-serif", color: "#ffffff", align: "left", lineHeight: 20, x: 0, y: 0 } }, { op: "addRaster", name: "Never" },
  ] }, null);
  assert.equal(report.completed, false);
  assert.deepEqual(report.steps.map(step => step.status), ["applied", "failed"]);
  assert.match(report.steps[1].message!, /text layer/);
  assert.equal(studio.doc.layers.length, 1);
  studio.undo();
  assert.equal(studio.doc.layers.length, 0);
  studio.redo();
  assert.equal(studio.doc.layers[0].name, "Created");
  studio.dispose();
});

test("missing, locked, smart-object, high-depth and missing-mask targets cannot silently pass", () => {
  const studio = new Studio(8, 8, testCanvas(8, 8));
  const fill = { name: "Fill", steps: [{ op: "fill", color: "#ffffff" }] } as const;
  const action = { ...fill, steps: [...fill.steps] };
  assert.throws(() => studio.replay(action, null), ActionPlaybackError);
  const layer = studio.addBlankRaster("Target");
  layer.locked = true;
  assert.throws(() => studio.replay(action, layer.id), /locked/);
  layer.locked = false;
  studio.doc.bitDepth = 16;
  assert.throws(() => studio.replay(action, layer.id), /high-depth/);
  studio.doc.bitDepth = 8;
  assert.throws(() => studio.replay({ name: "Mask", steps: [{ op: "invertMask" }] }, layer.id), /no pixel mask/);
  studio.convertToSmartObject(layer.id);
  assert.throws(() => studio.replay(action, layer.id), /raster layer/);
  studio.dispose();
});

test("disabled and unchanged steps are reported explicitly and playback is not re-recorded", () => {
  const studio = new Studio(8, 8, testCanvas(8, 8));
  const layer = studio.addBlankRaster("Target");
  studio.startRecording("Outer");
  const report = studio.replayWithReport({ name: "Run", steps: [
    { op: "deleteActive", enabled: false }, { op: "deselect" }, { op: "setOpacity", opacity: 0.5 },
  ] }, layer.id);
  assert.equal(report.completed, true);
  assert.deepEqual(report.steps.map(step => step.status), ["disabled", "unchanged", "applied"]);
  studio.setLayerProp(layer.id, "opacity", 0.8, "Opacity");
  assert.equal(studio.stopRecording()!.steps.length, 1);
  studio.dispose();
});
