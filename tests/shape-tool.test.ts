import test from "node:test";
import assert from "node:assert/strict";
import { testCanvas } from "./canvas-harness.ts";
import { Studio } from "../app/engine/studio.ts";
import { createPathLayer, createShapeLayer } from "../app/engine/document.ts";
import { buildShapeGeometry, captureCustomShape, decodeShapeLibrary, encodeShapeLibrary, DEFAULT_SHAPE_SETTINGS, SHAPE_PRESETS } from "../app/engine/shape-library.ts";
import { commitShapeDrag, shapeDragGeometry, shapePresetForTool } from "../app/studio/shape-tool.ts";
import type { CanvasDragDraft } from "../app/studio/canvas-gesture.ts";
import { pathContours, validateVectorPath, vectorPathData } from "../app/engine/vector-path.ts";
import { layerVectorPath } from "../app/engine/vector-delivery.ts";
import { decodeLumaProject } from "../app/engine/project.ts";
import { TOOL_REGISTRY } from "../app/studio/tool-registry.ts";

const bounds = { x: 20, y: 30, width: 100, height: 80 };
const settings = { ...DEFAULT_SHAPE_SETTINGS, strokeWidth: 3 };
function draft(studio: Studio, preset = "star"): CanvasDragDraft {
  return { kind: "custom-shape", x0: 10, y0: 10, x1: 100, y1: 90, shapeGesture: { documentId: studio.activeDocumentState().id, fill: "#ff0000", settings: { ...settings, preset } } };
}

test("every preset produces editable geometry, finite paths and independent storage", () => {
  for (const { id } of SHAPE_PRESETS) {
    const a = buildShapeGeometry({ ...settings, preset: id }, bounds, "#ff0000");
    const b = buildShapeGeometry({ ...settings, preset: id }, bounds, "#ff0000");
    if (a.kind === "path" && b.kind === "path") {
      validateVectorPath(a.path); assert.ok(vectorPathData(a.path).startsWith("M"));
      assert.notEqual(a.path.anchors, b.path.anchors);
    } else { assert.equal(a.kind, "shape"); }
  }
});

test("polygon count and star inner radius are honored; hostile numeric inputs rejected", () => {
  const star = buildShapeGeometry({ ...settings, preset: "star", sides: 9, innerRatio: .25 }, bounds, "#fff");
  assert.equal(star.kind, "path"); if (star.kind !== "path") return;
  assert.equal(star.path.anchors.length, 18);
  const inner = star.path.anchors[1];
  assert.ok(Math.abs(Math.hypot((inner.x - 70) / 50, (inner.y - 70) / 40) - .25) < 1e-8);
  assert.throws(() => buildShapeGeometry({ ...settings, sides: NaN }, bounds, "#fff"), /Invalid/);
  assert.throws(() => buildShapeGeometry({ ...settings, preset: "unknown" }, bounds, "#fff"), /Unknown/);
});

test("line accepts horizontal, vertical and reverse drags without mirroring", () => {
  const studio = new Studio(160, 160, testCanvas(160, 160));
  try {
    for (const [x0, y0, x1, y1] of [[10, 20, 90, 20], [30, 5, 30, 120], [100, 10, 10, 100]]) {
      const d = { ...draft(studio, "line"), x0, y0, x1, y1 };
      const result = shapeDragGeometry(d); assert.equal(result?.kind, "path");
      if (result?.kind !== "path") continue;
      assert.deepEqual(result.path.anchors.map(a => [a.x, a.y]), [[x0, y0], [x1, y1]]);
      assert.equal(result.path.closed, false);
    }
  } finally { studio.dispose(); }
});

test("Shift proportions, Option center, zero drags and preview/commit geometry agree", () => {
  const studio = new Studio(160, 160, testCanvas(160, 160));
  try {
    const d = { ...draft(studio, "rect"), x0: 80, y0: 80, x1: 60, y1: 70, shiftKey: true, altKey: true };
    const preview = shapeDragGeometry(d); assert.equal(preview?.kind, "shape");
    if (preview?.kind !== "shape") return;
    assert.equal(preview.style.w, 40); assert.equal(preview.style.h, 40);
    assert.equal(preview.style.x, 60); assert.equal(preview.style.y, 60);
    const layer = commitShapeDrag(studio, d)!; assert.deepEqual(layer.shape, preview.style);
    assert.equal(shapeDragGeometry({ ...d, x1: d.x0, y1: d.y0 }), null);
  } finally { studio.dispose(); }
});

test("custom compound outlines preserve holes, curves and rotation without aliasing source", () => {
  const outer = buildShapeGeometry({ ...settings, preset: "heart" }, bounds, "#fff");
  const hole = buildShapeGeometry({ ...settings, preset: "diamond" }, { x: 50, y: 50, width: 10, height: 10 }, "#fff");
  if (outer.kind !== "path" || hole.kind !== "path") throw new Error("Expected paths");
  outer.path.contours = pathContours(hole.path); outer.path.fillRule = "evenodd";
  const layer = createPathLayer("Heart with hole", outer.path); layer.transform.rotation = .3;
  const preset = captureCustomShape(layer, "custom-test");
  assert.equal(preset.path.fillRule, "evenodd"); assert.equal(pathContours(preset.path).length, 2);
  const restored = decodeShapeLibrary(encodeShapeLibrary([preset]));
  assert.deepEqual(restored, [preset]);
  const placed = buildShapeGeometry({ ...settings, preset: preset.id }, bounds, "#123456", restored[0]);
  if (placed.kind !== "path") throw new Error("Expected custom path");
  assert.equal(placed.path.fillRule, "evenodd"); assert.equal(placed.path.fill, "#123456");
  placed.path.anchors[0].x = -1; assert.notEqual(preset.path.anchors[0].x, -1);
  assert.ok(preset.path.anchors.some(a => a.hIn.dx !== 0));
});

test("rounded rectangles can be saved as curved custom outlines", () => {
  const layer = createShapeLayer("Rounded", { kind: "rect", x: 0, y: 0, w: 100, h: 50, radius: 10, fill: "#fff", stroke: "none", strokeWidth: 0 });
  const path = layerVectorPath(layer); assert.equal(path.anchors.length, 8);
  assert.ok(path.anchors.some(a => a.hIn.dx !== 0));
  assert.equal(captureCustomShape(layer, "custom-rounded").path.anchors.length, 8);
});

test("open paths and invalid/over-budget preset storage fail safely", () => {
  const line = buildShapeGeometry({ ...settings, preset: "line" }, bounds, "#fff");
  if (line.kind !== "path") throw new Error("Expected line");
  assert.throws(() => captureCustomShape(createPathLayer("Line", line.path), "custom-line"), /closed/);
  assert.throws(() => decodeShapeLibrary("{"));
  assert.throws(() => decodeShapeLibrary(JSON.stringify({ version: 2, shapes: [] })), /Invalid/);
  assert.throws(() => decodeShapeLibrary(" ".repeat(1_000_001)), /budget/);
  const path = buildShapeGeometry({ ...settings, preset: "star" }, bounds, "#fff");
  if (path.kind !== "path") throw new Error("Expected star");
  const preset = captureCustomShape(createPathLayer("Star", path.path), "custom-star");
  assert.throws(() => encodeShapeLibrary([preset, preset]), /Invalid/);
  assert.throws(() => encodeShapeLibrary(Array(33).fill(preset)), /32/);
  assert.throws(() => buildShapeGeometry({ ...settings, preset: "custom-missing" }, bounds, "#fff"), /available/);
});

test("drawing is one undo step and project save/reopen preserves exact editable geometry", async () => {
  const studio = new Studio(160, 160, testCanvas(160, 160));
  try {
    const before = studio.doc.layers.length;
    const layer = commitShapeDrag(studio, draft(studio, "heart"))!;
    assert.equal(layer.name, "Heart"); assert.equal(studio.doc.layers.length, before + 1);
    const path = structuredClone(layer.path);
    studio.undo(); assert.equal(studio.doc.layers.length, before);
    studio.redo(); assert.deepEqual(studio.findLayer(layer.id)!.path, path);
    const saved = await studio.prepareProjectSave();
    const restored = await decodeLumaProject(saved.blob);
    assert.deepEqual(restored.doc.layers.find(l => l.id === layer.id)!.path, path);
  } finally { studio.dispose(); }
});

test("stale document gestures cannot add shapes to a different document", () => {
  const studio = new Studio(160, 160, testCanvas(160, 160));
  try {
    const d = draft(studio); d.shapeGesture!.documentId = "other-document";
    const before = studio.doc.layers.length;
    assert.throws(() => commitShapeDrag(studio, d), /Document changed/);
    assert.equal(studio.doc.layers.length, before);
  } finally { studio.dispose(); }
});

test("shape tools use contextual shape options and keep custom preset identity", () => {
  for (const tool of ["rect", "ellipse", "triangle", "polygon", "line", "custom-shape"] as const) assert.equal(TOOL_REGISTRY[tool].options, "shape");
  assert.equal(shapePresetForTool("custom-shape", "custom-test"), "custom-test");
  assert.equal(shapePresetForTool("polygon", "custom-test"), "polygon");
});
