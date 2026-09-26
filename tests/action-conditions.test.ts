import assert from "node:assert/strict";
import test from "node:test";
import { Studio } from "../app/engine/studio.ts";
import { ActionRecorder, isSafeAction, type Action } from "../app/engine/actions.ts";
import { decodeLumaProject } from "../app/engine/project.ts";
import { testCanvas } from "./canvas-harness.ts";

test("conditional steps match the current document and re-evaluate after target changes", () => {
  const action: Action = { name: "Orientation", steps: [
    { op: "addRaster", name: "Portrait", conditions: [{ kind: "orientation", value: "portrait" }] },
    { op: "addRaster", name: "Other", conditions: [{ kind: "orientation", value: "portrait", not: true }] },
    { op: "setOpacity", opacity: 0.5, conditions: [{ kind: "layer-kind", value: "raster" }, { kind: "locked", value: false }] },
    { op: "invertMask", conditions: [{ kind: "mask", value: true }] },
    { op: "selectAll", conditions: [{ kind: "selection", value: false }] },
    { op: "deselect", conditions: [{ kind: "selection", value: true }] },
  ] };
  for (const [w, h, name] of [[8, 16, "Portrait"], [16, 8, "Other"], [8, 8, "Other"]] as const) {
    const studio = new Studio(w, h, testCanvas(w, h));
    const report = studio.replayWithReport(action, null);
    assert.equal(report.completed, true);
    assert.equal(report.steps.filter(step => step.status === "skipped").length, 2);
    assert.equal(studio.doc.layers[0].name, name);
    assert.equal(studio.doc.layers[0].opacity, 0.5);
    assert.equal(studio.doc.selection, null);
    studio.dispose();
  }
});

test("malformed and excessive conditions fail before playback", () => {
  for (const conditions of [[{ kind: "unknown", value: true }], [{ kind: "bit-depth", value: 12 }], [{ kind: "locked", value: "false" }], Array.from({ length: 9 }, () => ({ kind: "selection", value: true }))]) {
    assert.equal(isSafeAction({ name: "bad", steps: [{ op: "clear", conditions }] }), false);
  }
});

test("action edit undo/redo is isolated, bounds snapshots and rejects plugin edits", () => {
  const recorder = new ActionRecorder();
  recorder.fromJSON(JSON.stringify([{ name: "Original", steps: [{ op: "selectAll" }] }]));
  const changed: Action = { name: "Changed", steps: [{ op: "selectAll", enabled: false, conditions: [{ kind: "bit-depth", value: 8 }] }] };
  recorder.replace(0, changed);
  changed.name = "External mutation";
  assert.equal(recorder.get(0).name, "Changed");
  assert.equal(recorder.undoEdit(), true); assert.equal(recorder.get(0).name, "Original");
  assert.equal(recorder.redoEdit(), true); assert.equal(recorder.get(0).steps[0].enabled, false);
  recorder.install({ name: "Plugin", steps: [] }, "plugin.test");
  assert.equal(recorder.canUndoEdit(), false);
  assert.throws(() => recorder.replace(1, { name: "Override", steps: [] }), /read-only/);
  assert.throws(() => recorder.replace(0, { name: "Too large", steps: [{ op: "clear", payload: "x".repeat(4_000_001) }] } as unknown as Action), /undo budget/);
});

test("metadata edits do not redraw pixels, survive canvas Undo and invalidate in-flight saves", async () => {
  const studio = new Studio(8, 8, testCanvas(8, 8));
  const layer = studio.addBlankRaster("Target");
  studio.actions.fromJSON(JSON.stringify([{ name: "Original", steps: [{ op: "selectAll" }] }]));
  studio.markDocumentSaved();
  let redraws = 0;
  const render = studio.requestRender.bind(studio);
  studio.requestRender = (...args) => { redraws++; render(...args); };
  studio.editAction(0, { name: "Edited", steps: [{ op: "selectAll", conditions: [{ kind: "orientation", value: "square" }] }] });
  assert.equal(redraws, 0);
  assert.equal(studio.activeDocumentState().dirty, true);
  studio.updateTransform(layer.id, { tx: 2 }); studio.undo();
  assert.equal(studio.activeDocumentState().dirty, true);
  const pending = studio.prepareProjectSave();
  studio.editAction(0, { name: "Newer", steps: [] });
  await assert.rejects(pending, /changed while saving/);
  const saved = await studio.prepareProjectSave();
  assert.equal((await decodeLumaProject(saved.blob)).actions[0].name, "Newer");
  studio.undoActionEdit();
  assert.equal(studio.completeProjectSave(saved), false);
  const current = await studio.prepareProjectSave();
  assert.equal(studio.completeProjectSave(current), true);
  assert.equal(studio.activeDocumentState().dirty, false);
  assert.deepEqual((await decodeLumaProject(current.blob)).actions[0].steps[0].conditions, [{ kind: "orientation", value: "square" }]);
  studio.dispose();
});

test("opening a project cannot silently replace an unsaved action library", async () => {
  const studio = new Studio(8, 8, testCanvas(8, 8));
  const project = await studio.exportProject();
  studio.startRecording("Keep me"); studio.stopRecording();
  await assert.rejects(studio.importProject(project), /action-library edits/);
  assert.equal(studio.actions.get(0).name, "Keep me");
  studio.markDocumentSaved();
  await studio.importProject(project);
  studio.dispose();
});
