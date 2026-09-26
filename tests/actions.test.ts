import assert from "node:assert/strict";
import test from "node:test";
import { Studio } from "../app/engine/studio.ts";
import { SparseAlphaSurface } from "../app/engine/alpha-surface.ts";
import { ActionRecorder, isSafeAction } from "../app/engine/actions.ts";
import { testCanvas } from "./canvas-harness.ts";

test("Actions record and replay structural, smart-filter, and transform operations", () => {
  const source = new Studio(20, 20, testCanvas(20, 20));
  source.startRecording("Build treatment");
  const layer = source.addBlankRaster("Treatment");
  source.addSmartFilter(layer.id, "invert");
  source.updateTransform(layer.id, { tx: 7, ty: 4 });
  source.addDropShadow(layer.id);
  const group = source.groupLayer(layer.id)!;
  const action = source.stopRecording()!;
  assert.deepEqual(action.steps.map((step) => step.op), [
    "addRaster", "addSmartFilter", "setTransform", "addDropShadow", "groupActive",
  ]);

  const target = new Studio(20, 20, testCanvas(20, 20));
  const activeId = target.replay(action, null);
  assert.equal(target.findLayer(activeId!)?.kind, "group");
  const replayed = target.doc.layers.find((candidate) => candidate.parentId === activeId)!;
  assert.equal(replayed.name, "Treatment");
  assert.equal(replayed.filters?.[0].kind, "invert");
  assert.equal(replayed.effects?.[0].kind, "drop-shadow");
  assert.deepEqual({ tx: replayed.transform.tx, ty: replayed.transform.ty }, { tx: 7, ty: 4 });
  assert.equal(group.kind, "group");
  const groupCopy = source.duplicateLayer(group.id)!;
  assert.equal(groupCopy.kind, "group");
  assert.ok(source.doc.layers.some((candidate) => candidate.parentId === groupCopy.id && candidate.name === "Treatment"));
  source.dispose();
  target.dispose();
});

test("Actions cover adjustment creation, duplication, blending, and masks", () => {
  const source = new Studio(20, 20, testCanvas(20, 20));
  const base = source.addBlankRaster("Styled");
  base.maskSurface = new SparseAlphaSurface(20, 20, { defaultAlpha: 255 });
  source.startRecording("Layer workflow");
  source.setLayerProp(base.id, "opacity", 0.7, "Opacity");
  source.setLayerProp(base.id, "fillOpacity", 0.45, "Fill opacity");
  source.setLayerProp(base.id, "blend", "multiply", "Blend mode");
  source.invertMask(base.id);
  const duplicate = source.duplicateLayer(base.id)!;
  source.addCurvesLayer();
  source.addLevelsLayer();
  source.addHslLayer();
  const action = source.stopRecording()!;
  assert.deepEqual(action.steps.map((step) => step.op), [
    "setOpacity", "setFillOpacity", "setBlendMode", "invertMask", "duplicateActive",
    "addCurves", "addLevels", "addHsl",
  ]);

  const target = new Studio(20, 20, testCanvas(20, 20));
  const targetBase = target.addBlankRaster("Target");
  targetBase.maskSurface = new SparseAlphaSurface(20, 20, { defaultAlpha: 255 });
  const active = target.replay(action, targetBase.id);
  assert.equal(target.doc.layers.length, 5);
  assert.equal(target.findLayer(targetBase.id)?.opacity, 0.7);
  assert.equal(target.findLayer(targetBase.id)?.fillOpacity, 0.45);
  assert.equal(target.findLayer(targetBase.id)?.blend, "multiply");
  assert.equal(target.findLayer(duplicate.id), undefined);
  assert.equal(target.findLayer(active!)?.kind, "adjustment-hsl");
  source.dispose();
  target.dispose();
});

test("untrusted project and plugin actions reject unknown or malformed steps", () => {
  assert.equal(isSafeAction({ name: "Good", steps: [{ op: "setOpacity", opacity: 0.5 }] }), true);
  assert.equal(isSafeAction({ name: "Unknown", steps: [{ op: "runShell", command: "no" }] }), false);
  assert.equal(isSafeAction({ name: "Bad number", steps: [{ op: "blur", radius: "huge" }] }), false);
  assert.equal(isSafeAction({ name: "Bad blend", steps: [{ op: "setBlendMode", mode: "invented" }] }), false);

  const recorder = new ActionRecorder();
  recorder.fromJSON(JSON.stringify([
    { name: "Safe", steps: [{ op: "selectAll" }] },
    { name: "Unsafe", steps: [{ op: "unknown" }] },
  ]));
  assert.deepEqual(recorder.list().map((action) => action.name), ["Safe"]);
  assert.throws(() => recorder.install({ name: "Plugin", steps: [{ op: "unknown" }] } as never, "bad.plugin"), /malformed/);
});

test("action payloads reject malformed compound arguments, cycles and oversized nested data", () => {
  for (const step of [
    { op: "setTransform", transform: {} },
    { op: "addShape", style: {} },
    { op: "updateText", text: { text: "missing layout" } },
    { op: "addProAdjustment", kind: "color-balance", params: { kind: "color-balance" } },
    { op: "addProAdjustment", kind: "channel-mixer", params: { kind: "channel-mixer", matrix: [1] } },
    { op: "clear", enabled: "yes" },
  ]) assert.equal(isSafeAction({ name: "Unsafe", steps: [step] }), false);
  const cycle: Record<string, unknown> = { op: "clear" }; cycle.self = cycle;
  assert.equal(isSafeAction({ name: "Cycle", steps: [cycle] }), false);
  assert.equal(isSafeAction({ name: "Large", steps: [{ op: "clear", extra: "x".repeat(8_000_001) }] }), false);
});
