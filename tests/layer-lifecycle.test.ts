import assert from "node:assert/strict";
import test from "node:test";
import { Studio } from "../app/engine/studio.ts";
import { testCanvas } from "./canvas-harness.ts";

function backingRecorder() {
  const deleted: string[] = [];
  return {
    deleted,
    checkpoint: async () => undefined,
    deleteSurface: async (id: string) => { deleted.push(id); },
    stats: () => ({ supported: true, writes: 0, bytesWritten: 0, failures: 0 }),
  };
}

test("deleting a group removes descendants and undo restores the hierarchy", () => {
  const studio = new Studio(16, 16, testCanvas(16, 16));
  const backing = backingRecorder();
  (studio as unknown as { tileBacking: typeof backing }).tileBacking = backing;
  const child = studio.addBlankRaster("Child");
  const group = studio.groupLayer(child.id)!;
  const sibling = studio.addBlankRaster("Sibling");
  studio.removeLayer(group.id);
  assert.deepEqual(studio.doc.layers.map((layer) => layer.id), [sibling.id]);
  assert.ok(backing.deleted.some((id) => id.endsWith(`:${child.id}`)));
  assert.ok(backing.deleted.some((id) => id.endsWith(`:${group.id}`)));
  studio.undo();
  assert.equal(studio.findLayer(child.id)?.parentId, group.id);
  assert.equal(studio.findLayer(group.id)?.kind, "group");
  studio.dispose();
});

test("closing a background document deletes its own tile namespace", () => {
  const studio = new Studio(16, 16, testCanvas(16, 16));
  const backing = backingRecorder();
  (studio as unknown as { tileBacking: typeof backing }).tileBacking = backing;
  const firstSession = studio.listDocuments()[0].id;
  const firstLayer = studio.addBlankRaster("First document layer");
  studio.resetDocument(8, 8);
  studio.addBlankRaster("Second document layer");
  studio.closeDocument(firstSession);
  assert.ok(backing.deleted.includes(`${firstSession}:${firstLayer.id}`));
  assert.equal(studio.listDocuments().length, 1);
  studio.dispose();
});
