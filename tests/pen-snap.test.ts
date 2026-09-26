import test from "node:test";
import assert from "node:assert/strict";
import { testCanvas } from "./canvas-harness.ts";
import { DEFAULT_PEN_SNAP, createPenPath, normalizePenSnap, penMeasurementLabel, resolvePenSnap } from "../app/studio/pen-snap.ts";
import { Studio } from "../app/engine/studio.ts";
import { decodeLumaProject } from "../app/engine/project.ts";
import { TOOL_REGISTRY } from "../app/studio/tool-registry.ts";

const base = { point: { x: 302, y: 247 }, width: 1000, height: 800, zoom: 1, anchors: [{ x: 100, y: 100 }, { x: 200, y: 250 }], guides: [], settings: DEFAULT_PEN_SNAP };
test("aligns to earlier draft anchors and reports document-pixel measurements", () => {
  const result = resolvePenSnap(base);
  assert.deepEqual(result.point, { x: 302, y: 250 });
  assert.equal(result.distance, 102); assert.equal(result.angle, 0);
  assert.equal(result.label, "Anchor alignment");
  assert.match(penMeasurementLabel(result), /Chord 102.0 px/);
});
test("snaps canvas edges, centers and custom document guides independently", () => {
  const center = resolvePenSnap({ ...base, point: { x: 497, y: 401 } });
  assert.deepEqual(center.point, { x: 500, y: 400 });
  const guides = resolvePenSnap({ ...base, point: { x: 301, y: 4 }, guides: [{ orientation: "vertical" as const, position: 300 }] });
  assert.deepEqual(guides.point, { x: 300, y: 0 }); assert.equal(guides.guides.length, 2);
});
test("snap tolerance stays eight screen pixels at every zoom", () => {
  for (const zoom of [.1, 1, 4, 16]) {
    const input = { ...base, zoom, anchors: [], guides: [{ orientation: "vertical" as const, position: 300 }] };
    assert.equal(resolvePenSnap({ ...input, point: { x: 300 + 7 / zoom, y: 330 } }).point.x, 300);
    const outside = 300 + 9 / zoom;
    assert.equal(resolvePenSnap({ ...input, point: { x: outside, y: 330 } }).point.x, outside);
  }
});
test("Option and disabled snap preserve exact pointer coordinates", () => {
  assert.deepEqual(resolvePenSnap({ ...base, altKey: true }).point, base.point);
  assert.deepEqual(resolvePenSnap({ ...base, settings: { ...DEFAULT_PEN_SNAP, snap: false } }).point, base.point);
});
test("Shift snaps angles without changing radial length or being pulled onto guides", () => {
  const result = resolvePenSnap({ ...base, point: { x: 290, y: 330 }, shiftKey: true, guides: [{ orientation: "vertical", position: 292 }] });
  assert.ok(Math.abs(result.angle - 45) < 1e-8);
  assert.ok(Math.abs(result.distance - Math.hypot(90, 80)) < 1e-8);
  assert.equal(result.guides.length, 0);
  assert.equal(resolvePenSnap({ ...base, point: { x: 290, y: 260 }, shiftKey: true, altKey: true }).angle, 0);
});
test("grid spacing and selected angle increments are honored", () => {
  const result = resolvePenSnap({ ...base, point: { x: 323, y: 283 }, settings: { ...DEFAULT_PEN_SNAP, grid: true, gridSize: 20 } });
  assert.deepEqual(result.point, { x: 320, y: 280 });
  assert.equal(result.label, "Grid");
  const angled = resolvePenSnap({ ...base, point: { x: 290, y: 300 }, shiftKey: true, settings: { ...DEFAULT_PEN_SNAP, angleStep: 30 } });
  assert.ok(Math.abs(angled.angle - 30) < 1e-8);
});
test("closing threshold is screen based and never active during handle dragging", () => {
  assert.equal(resolvePenSnap({ ...base, point: { x: 105, y: 100 } }).closes, true);
  assert.equal(resolvePenSnap({ ...base, point: { x: 105, y: 100 }, zoom: 4 }).closes, false);
  assert.equal(resolvePenSnap({ ...base, point: { x: 105, y: 100 }, handleOrigin: { x: 105, y: 100 } }).closes, false);
});
test("handle measurements and empty draft coordinates are explicitly labeled", () => {
  const handle = resolvePenSnap({ ...base, point: { x: 260, y: 300 }, altKey: true, handleOrigin: { x: 200, y: 250 } });
  assert.match(penMeasurementLabel(handle), /^Handle/);
  const empty = resolvePenSnap({ ...base, anchors: [], altKey: true });
  assert.match(penMeasurementLabel(empty), /^X 302.0 · Y 247.0 px/);
});
test("negative and zero-length angles are finite and stable", () => {
  assert.equal(resolvePenSnap({ ...base, point: { x: 200, y: 100 }, altKey: true }).angle, 270);
  const zero = resolvePenSnap({ ...base, point: { x: 200, y: 250 }, altKey: true });
  assert.equal(zero.angle, 0); assert.equal(zero.distance, 0);
});
test("malformed settings recover safe defaults and invalid geometry is refused", () => {
  assert.deepEqual(normalizePenSnap(null), DEFAULT_PEN_SNAP);
  const normalized = normalizePenSnap({ gridSize: -100, angleStep: 999 });
  assert.equal(normalized.gridSize, 1); assert.equal(normalized.angleStep, 45);
  assert.equal(normalizePenSnap({ gridSize: Infinity }).gridSize, 10);
  assert.throws(() => resolvePenSnap({ ...base, zoom: 0 }), /Invalid/);
  assert.throws(() => resolvePenSnap({ ...base, point: { x: NaN, y: 0 } }), /Invalid/);
});
test("Pen registry owns precision controls; open paths stay visible and undo/save round-trip", async () => {
  assert.equal(TOOL_REGISTRY.pen.options, "pen");
  const studio = new Studio(160, 160, testCanvas(160, 160));
  try {
    const anchors = [{ x: 10, y: 20 }, { x: 90, y: 20 }].map(p => ({ ...p, hIn: { dx: 0, dy: 0 }, hOut: { dx: 0, dy: 0 } }));
    const path = createPenPath(anchors, false, "#ff0000");
    assert.equal(path.strokeWidth, 2); assert.equal(path.fill, "none");
    const before = studio.doc.layers.length, layer = studio.addPathLayer(path);
    anchors[0].x = -100; assert.equal(layer.path!.anchors[0].x, 10);
    studio.undo(); assert.equal(studio.doc.layers.length, before);
    studio.redo(); assert.deepEqual(studio.findLayer(layer.id)!.path, path);
    const restored = await decodeLumaProject((await studio.prepareProjectSave()).blob);
    assert.deepEqual(restored.doc.layers.find(l => l.id === layer.id)!.path, path);
    assert.equal(createPenPath(anchors, true, "#ff0000").strokeWidth, 0);
  } finally { studio.dispose(); }
});
