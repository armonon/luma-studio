import assert from "node:assert/strict";
import test from "node:test";
import { Studio } from "../app/engine/studio.ts";
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
  source.dispose();
  target.dispose();
});
