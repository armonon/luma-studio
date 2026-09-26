import assert from "node:assert/strict";
import test from "node:test";
import {
  cursorRingGeometry,
  cursorSelectionMode,
  dynamicCursorPresentation,
} from "../app/studio/dynamic-cursor.ts";

const brushContext = {
  size: 48,
  hardness: 0.7,
  roundness: 0.8,
  angle: 22,
  color: "#aabbcc",
} as const;

test("selection cursor communicates modifier-driven operations", () => {
  assert.equal(cursorSelectionMode("replace", {}), "replace");
  assert.equal(cursorSelectionMode("replace", { shiftKey: true }), "add");
  assert.equal(cursorSelectionMode("replace", { altKey: true }), "subtract");
  assert.equal(cursorSelectionMode("replace", { shiftKey: true, altKey: true }), "intersect");
  assert.deepEqual(
    dynamicCursorPresentation("sel-rect", { ...brushContext, shiftKey: true, selectionMode: "replace" }),
    { kind: "selection", glyph: "+", readout: "Add", status: "attention", ...brushContext },
  );
});

test("brush cursor exposes live geometry while capture mode becomes a sampler", () => {
  assert.deepEqual(dynamicCursorPresentation("brush", brushContext), {
    kind: "brush", glyph: "", readout: "48 px", status: "ready", ...brushContext,
  });
  assert.equal(dynamicCursorPresentation("capture-brush", {
    ...brushContext,
    captureSampling: true,
    size: 128,
  }).readout, "128 px sample");
});

test("cursor feedback makes unavailable and source-sampling states explicit", () => {
  const unavailable = dynamicCursorPresentation("brush", { ...brushContext, unavailableReason: "Layer locked" });
  assert.deepEqual([unavailable.status, unavailable.glyph, unavailable.readout], ["unavailable", "!", "Layer locked"]);
  const sample = dynamicCursorPresentation("clone", { ...brushContext, needsSourceSample: true });
  assert.deepEqual([sample.status, sample.glyph, sample.readout], ["attention", "⌥", "Alt-click source"]);
});

test("brush screen geometry follows zoom and pen pressure without unbounded overlays", () => {
  assert.deepEqual(cursorRingGeometry({
    documentSize: 100,
    viewportDocumentWidth: 1000,
    canvasCssWidth: 500,
    pressure: 0.5,
    pressureSize: true,
  }), { actualDiameter: 25, displayDiameter: 25, clipped: false });
  const huge = cursorRingGeometry({ documentSize: 1200, viewportDocumentWidth: 100, canvasCssWidth: 1000 });
  assert.equal(huge.actualDiameter, 12_000);
  assert.equal(huge.displayDiameter, 360);
  assert.equal(huge.clipped, true);
});
