import test from "node:test";
import assert from "node:assert/strict";
import { testCanvas } from "./canvas-harness.ts";
import { Studio } from "../app/engine/studio.ts";
import { affineForLayerTransform, createPathLayer, transformPoint, type PathStyle } from "../app/engine/document.ts";
import { decodeLumaProject } from "../app/engine/project.ts";
import { validateVectorPath } from "../app/engine/vector-path.ts";
import { vectorPathBytes } from "../app/engine/history-payload.ts";
import { cubicPoint } from "../app/shared/path-editing.ts";
import { addSegmentPoint, bendSegment, changePointMode, cutPathAtPoint, editHandle, editablePointPath, hitPathPoint, imageHandlePolar, imagePolarHandle, movePoints, PathPointTransaction, removePathPoints, segmentControls } from "../app/studio/path-point-editing.ts";

const curve = (): PathStyle => ({ anchors: [
  { id: "first", mode: "smooth", x: 10, y: 30, hIn: { dx: -8, dy: 0 }, hOut: { dx: 35, dy: -20 } },
  { id: "last", mode: "corner", x: 140, y: 90, hIn: { dx: -45, dy: -50 }, hOut: { dx: 6, dy: 4 } },
], closed: false, fill: "none", stroke: "#fff", strokeWidth: 2, fillRule: "evenodd", contours: [{ closed: true, anchors: [
  { id: "c1", x: 160, y: 30, hIn: { dx: 0, dy: 0 }, hOut: { dx: 0, dy: 0 } },
  { id: "c2", x: 190, y: 30, hIn: { dx: 0, dy: 0 }, hOut: { dx: 0, dy: 0 } },
  { id: "c3", x: 190, y: 70, hIn: { dx: 0, dy: 0 }, hOut: { dx: 0, dy: 0 } },
] }] });
const close = (a: { x: number; y: number }, b: { x: number; y: number }) => assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 1e-8, `${JSON.stringify(a)} vs ${JSON.stringify(b)}`);

test("Luma image-space polar fields display positive counterclockwise like Form", () => {
  const handle = imagePolarHandle(25, 90); assert.ok(Math.abs(handle.dx) < 1e-10); assert.equal(handle.dy, -25);
  assert.equal(imageHandlePolar({ dx: 0, dy: -25 }).angle, 90); assert.equal(imageHandlePolar({ dx: 0, dy: 25 }).angle, -90);
});

test("Add Point exactly preserves a cubic across unequal split fractions, IDs, contours and fill rule", () => {
  const source = curve(), original = structuredClone(source);
  for (const t of [.12, .5, .83]) {
    const result = addSegmentPoint(source, { contour: 0, index: 0, t });
    const left = segmentControls(result, { contour: 0, index: 0 }).points, right = segmentControls(result, { contour: 0, index: 1 }).points;
    const controls = segmentControls(source, { contour: 0, index: 0 }).points;
    for (let i = 0; i <= 100; i++) { const u = i / 100; close(cubicPoint(...controls, u), u <= t ? cubicPoint(...left, u / t) : cubicPoint(...right, (u - t) / (1 - t))); }
    assert.equal(result.anchors[0].id, "first"); assert.equal(result.anchors[2].id, "last"); assert.ok(result.anchors[1].id);
    assert.deepEqual(result.contours, source.contours); assert.equal(result.fillRule, "evenodd");
  }
  assert.deepEqual(source, original);
});

test("multiselection translates anchors with their relative handles, modes and contour identities", () => {
  const source = curve(), result = movePoints(source, [{ contour: 0, index: 0 }, { contour: 1, index: 1 }], { x: 3.75, y: -6.5 });
  assert.equal(result.anchors[0].x, 13.75); assert.equal(result.contours![0].anchors[1].y, 23.5);
  assert.deepEqual(result.anchors[0].hOut, source.anchors[0].hOut); assert.equal(result.anchors[0].mode, "smooth"); assert.equal(result.contours![0].anchors[1].id, "c2");
  assert.deepEqual(result.anchors[1], source.anchors[1]);
});

test("smooth handles keep unequal opposite length, symmetric equalizes, Alt breaks to corner", () => {
  const smooth = changePointMode(curve(), [{ contour: 0, index: 0 }], "smooth");
  const moved = editHandle(smooth, { contour: 0, index: 0 }, "out", { x: 10, y: 70 });
  assert.ok(Math.abs(Math.hypot(moved.anchors[0].hIn.dx, moved.anchors[0].hIn.dy) - 8) < 1e-8);
  assert.deepEqual(moved.anchors[0].hIn, { dx: -0, dy: -8 });
  const symmetric = changePointMode(moved, [{ contour: 0, index: 0 }], "symmetric"); assert.equal(Math.hypot(symmetric.anchors[0].hIn.dx, symmetric.anchors[0].hIn.dy), 40);
  const independent = editHandle(symmetric, { contour: 0, index: 0 }, "out", { x: 20, y: 30 }, true);
  assert.equal(independent.anchors[0].mode, "corner"); assert.deepEqual(independent.anchors[0].hIn, symmetric.anchors[0].hIn);
});

test("Bend moves the chosen curve point while both anchors remain fixed", () => {
  const source = curve(), ref = { contour: 0, index: 0, t: .41 }, before = cubicPoint(...segmentControls(source, ref).points, ref.t);
  const result = bendSegment(source, ref, { x: 13, y: -17 }), after = cubicPoint(...segmentControls(result, ref).points, ref.t);
  close(after, { x: before.x + 13, y: before.y - 17 }); close(source.anchors[0], result.anchors[0]); close(source.anchors[1], result.anchors[1]);
  assert.equal(result.anchors[0].id, source.anchors[0].id); assert.deepEqual(result.contours, source.contours);
});

test("Remove reconnects neighbors; Cut opens a closed contour or splits an open one without conflating operations", () => {
  const source = curve(), removed = removePathPoints(source, [{ contour: 1, index: 1 }]);
  assert.equal(removed.contours![0].closed, true); assert.deepEqual(removed.contours![0].anchors.map(a => a.id), ["c1", "c3"]);
  const opened = cutPathAtPoint(source, { contour: 1, index: 1 });
  assert.equal(opened.contours![0].closed, false); assert.equal(opened.contours![0].anchors.length, 4);
  close(opened.contours![0].anchors[0], opened.contours![0].anchors[3]); assert.notEqual(opened.contours![0].anchors[0].id, opened.contours![0].anchors[3].id);
  const split = cutPathAtPoint(addSegmentPoint(source, { contour: 0, index: 0, t: .3 }), { contour: 0, index: 1 });
  assert.equal(split.anchors.length, 2); assert.equal(split.contours!.length, 2); close(split.anchors[1], split.contours![1].anchors[0]); validateVectorPath(split);
  assert.throws(() => cutPathAtPoint(source, { contour: 0, index: 0 }), /already/);
  assert.throws(() => removePathPoints(source, [{ contour: 0, index: 0 }]), /at least two/);
});

test("screen hit tests honor complete affine transforms, zoom and generous touch radius without selecting distant points", () => {
  const source = curve(), layer = createPathLayer("Transformed", source);
  layer.transform = { tx: 30, ty: -10, sx: -1.7, sy: .4, skewX: .6, rotation: .43 };
  const point = transformPoint(affineForLayerTransform(layer.transform), source.anchors[0].x, source.anchors[0].y);
  assert.equal(hitPathPoint(source, layer, { x: point.x + 9, y: point.y }, [], 2, 22)?.kind, "anchor");
  assert.equal(hitPathPoint(source, layer, { x: point.x + 9, y: point.y }, [], 2, 5), null);
  const h = source.anchors[0], handle = transformPoint(affineForLayerTransform(layer.transform), h.x + h.hOut.dx, h.y + h.hOut.dy);
  assert.equal(hitPathPoint(source, layer, handle, [{ contour: 0, index: 0 }], 2, 11)?.kind, "out");
});

test("legacy paths receive stable IDs on edit; malformed modes/IDs are rejected by native vector validation", () => {
  const legacy = curve(); legacy.anchors.forEach(a => { delete a.id; delete a.mode; });
  const edit = editablePointPath(legacy); assert.ok(edit.anchors.every(a => a.id)); assert.deepEqual(editablePointPath(edit), edit);
  assert.ok(vectorPathBytes(edit) > vectorPathBytes(legacy), "history bills editable identities rather than treating metadata as free");
  const duplicate = curve(); duplicate.anchors[1].id = "first"; assert.throws(() => validateVectorPath(duplicate), /Duplicate/);
  const mode = curve(); (mode.anchors[0] as { mode?: string }).mode = "invalid"; assert.throws(() => validateVectorPath(mode), /mode/);
});

test("transient point edits cancel exactly, commit once, undo/redo, and native save/reopen retain editable vectors", async () => {
  const studio = new Studio(240, 160, testCanvas(240, 160));
  try {
    const layer = studio.addPathLayer(curve()), original = structuredClone(layer.path), transform = { tx: 8, ty: 6, sx: 1.2, sy: .8, rotation: .2, skewX: .1 };
    layer.transform = { ...transform }; const before = studio.historyLabels().length;
    const cancelled = new PathPointTransaction(studio, layer); const next = addSegmentPoint(movePoints(layer.path!, [{ contour: 0, index: 0 }], { x: 5, y: 4 }), { contour: 0, index: 0, t: .6 });
    cancelled.preview(next); cancelled.cancel(); assert.deepEqual(layer.path, original); assert.equal(studio.historyLabels().length, before);
    const committed = new PathPointTransaction(studio, layer);
    for (let i = 1; i <= 20; i++) committed.preview(movePoints(layer.path!, [{ contour: 1, index: 1 }], { x: .1, y: 0 }));
    committed.commit(next); assert.equal(studio.historyLabels().length, before + 1); assert.deepEqual(layer.path, next); assert.deepEqual(layer.transform, transform);
    studio.undo(); assert.deepEqual(studio.findLayer(layer.id)!.path, original); studio.redo(); assert.deepEqual(studio.findLayer(layer.id)!.path, next);
    const reopened = await decodeLumaProject((await studio.prepareProjectSave()).blob), saved = reopened.doc.layers.find(l => l.id === layer.id)!;
    assert.deepEqual(saved.path, next); assert.deepEqual(saved.transform, transform); assert.equal(saved.kind, "path");
    const editAgain = movePoints(saved.path!, [{ contour: 0, index: 1 }], { x: .25, y: -.5 }); assert.equal(editAgain.anchors[1].id, saved.path!.anchors[1].id);
  } finally { studio.dispose(); }
});
