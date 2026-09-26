import assert from "node:assert/strict";
import test from "node:test";
import { Studio } from "../app/engine/studio";
import { selectLayerRange, selectedLayerTree } from "../app/engine/layer-selection";
import { createRasterLayer, newCanvas } from "../app/engine/document";
import { renderClean } from "../app/engine/renderer";
import { solidCanvas, testCanvas } from "./canvas-harness";
import { encodeLumaProject, decodeLumaProject } from "../app/engine/project";
import { commandForShortcut } from "../app/desktop/command-shortcuts";

test("selection supports anchored ranges, command/control toggles and additive ranges", () => {
  const order = ["a", "b", "c", "d"];
  let state = selectLayerRange(order, { ids: [], primary: null, anchor: null }, "b");
  state = selectLayerRange(order, state, "d", { shiftKey: true });
  assert.deepEqual(state.ids, ["b", "c", "d"]);
  state = selectLayerRange(order, state, "c", { shiftKey: true });
  assert.deepEqual(state.ids, ["b", "c"]); assert.equal(state.anchor, "b");
  state = selectLayerRange(order, state, "a", { metaKey: true });
  assert.deepEqual(state.ids, ["a", "b", "c"]);
  state = selectLayerRange(order, state, "b", { ctrlKey: true });
  assert.deepEqual(state.ids, ["a", "c"]);
  state = selectLayerRange(order, state, "d", { metaKey: true, shiftKey: true });
  assert.deepEqual(state.ids, order);
});

function fixture() {
  const studio = new Studio(24, 24, testCanvas(1, 1));
  studio.doc.layers = ["red", "green", "blue"].map(color => createRasterLayer(color, solidCanvas(24, 24, color)));
  return studio;
}
const pixels = (studio: Studio) => { const canvas = newCanvas(24, 24); renderClean(studio.doc, canvas); return canvas.getContext("2d")!.getImageData(0, 0, 24, 24).data; };

test("multiple layers group and ungroup in one undo operation, preserving order and native project structure", async () => {
  const studio = fixture();
  try {
    const ids = studio.doc.layers.map(layer => layer.id);
    const before = pixels(studio);
    const group = studio.groupLayers(ids.slice(0, 2));
    assert.deepEqual(studio.doc.layers.map(layer => layer.id), [group.id, ...ids]);
    assert.deepEqual(pixels(studio), before);
    const restored = (await decodeLumaProject(await encodeLumaProject(studio.doc, [], "Groups"))).doc;
    assert.equal(restored.layers[1].parentId, restored.layers[0].id);
    studio.undo(); assert.deepEqual(studio.doc.layers.map(layer => layer.id), ids);
    studio.redo(); assert.equal(studio.doc.layers[1].parentId, group.id);
    studio.ungroupLayers([group.id]); assert.deepEqual(studio.doc.layers.map(layer => layer.id), ids);
    studio.undo(); assert.equal(studio.doc.layers[0].id, group.id);
  } finally { studio.dispose(); }
});

test("parent plus child selection is normalized; duplicate and delete preserve hierarchy with one undo", () => {
  const studio = fixture();
  try {
    const child = studio.doc.layers[0], group = studio.groupLayers([child.id]);
    assert.equal(selectedLayerTree(studio.doc.layers, [group.id, child.id]).roots.length, 1);
    const original = studio.doc.layers.map(layer => layer.id);
    const copies = studio.duplicateLayers([group.id, child.id, studio.doc.layers.at(-1)!.id]);
    assert.equal(copies.length, 2);
    assert.equal(studio.doc.layers.filter(layer => layer.parentId === copies[0].id).length, 1);
    studio.undo(); assert.deepEqual(studio.doc.layers.map(layer => layer.id), original);
    studio.removeLayers([group.id, child.id]); assert.equal(studio.findLayer(child.id), undefined);
    studio.undo(); assert.equal(studio.findLayer(child.id)?.parentId, group.id);
  } finally { studio.dispose(); }
});

test("merging compatible siblings preserves pixels; undo and redo restore editable originals", () => {
  const studio = fixture();
  try {
    studio.doc.layers[0].opacity = .5;
    const ids = studio.doc.layers.map(layer => layer.id), before = pixels(studio);
    const merged = studio.mergeLayers(ids.slice(0, 2));
    assert.equal(studio.doc.layers.length, 2); assert.equal(merged.kind, "raster");
    assert.deepEqual(pixels(studio), before);
    studio.undo(); assert.deepEqual(studio.doc.layers.map(layer => layer.id), ids); assert.deepEqual(pixels(studio), before);
    studio.redo(); assert.equal(studio.doc.layers[0].id, merged.id);
  } finally { studio.dispose(); }
});

test("unsafe merges and locked group edits fail before touching document or history", () => {
  const studio = fixture();
  try {
    const ids = studio.doc.layers.map(layer => layer.id), node = studio.historyState().currentId;
    assert.throws(() => studio.mergeLayers([ids[0], ids[2]]), /consecutive/);
    studio.doc.layers[0].blend = "multiply";
    assert.throws(() => studio.mergeLayers(ids.slice(0, 2)), /backdrop/);
    studio.doc.layers[0].blend = "source-over"; studio.doc.layers[0].locked = true;
    assert.throws(() => studio.groupLayers(ids.slice(0, 2)), /Unlock/);
    assert.throws(() => studio.removeLayers(ids), /Unlock/);
    assert.deepEqual(studio.doc.layers.map(layer => layer.id), ids); assert.equal(studio.historyState().currentId, node);
    studio.doc.layers[0].locked = false; studio.doc.bitDepth = 16;
    assert.throws(() => studio.mergeLayers(ids.slice(0, 2)), /8-bit/);
  } finally { studio.dispose(); }
});

test("layer selection belongs to its document and bulk flags undo atomically", () => {
  const studio = fixture();
  try {
    const ids = studio.doc.layers.map(layer => layer.id), original = studio.activeDocumentState().id;
    studio.setSelectedLayers(ids);
    studio.selectLayers(ids[2], { shiftKey: true }, ids[0]);
    studio.resetDocument(16, 16); const newLayer = studio.addBlankRaster("Other");
    assert.deepEqual(studio.layerSelection(newLayer.id).ids, [newLayer.id]);
    studio.switchDocument(original);
    assert.equal(studio.rememberedLayerSelectionPrimary(), ids[2]);
    assert.deepEqual(studio.layerSelection(studio.rememberedLayerSelectionPrimary()).ids, ids);
    studio.setLayersFlag(ids, "locked", true); assert.ok(studio.doc.layers.every(layer => layer.locked));
    studio.undo(); assert.ok(studio.doc.layers.every(layer => !layer.locked));
    studio.setLayersFlag(ids, "visible", false); assert.ok(studio.doc.layers.every(layer => !layer.visible));
    studio.undo(); assert.ok(studio.doc.layers.every(layer => layer.visible));
  } finally { studio.dispose(); }
});

test("bulk clone and merge refuse memory pressure without document or history mutation", () => {
  const studio = fixture();
  const internals = studio as unknown as { reservedOperationBytes: number };
  try {
    const ids = studio.doc.layers.map(layer => layer.id), node = studio.historyState().currentId;
    internals.reservedOperationBytes = 1024 * 1024 * 1024;
    assert.throws(() => studio.duplicateLayers(ids), /admission ceiling/);
    assert.throws(() => studio.mergeLayers(ids), /admission ceiling/);
    assert.deepEqual(studio.doc.layers.map(layer => layer.id), ids);
    assert.equal(studio.historyState().currentId, node);
  } finally { internals.reservedOperationBytes = 0; studio.dispose(); }
});

test("native and web shortcuts resolve group, ungroup and merge through shared commands", () => {
  const event = { key: "g", metaKey: true, ctrlKey: false, shiftKey: false, altKey: false };
  assert.equal(commandForShortcut(event), "group-layer");
  assert.equal(commandForShortcut({ ...event, shiftKey: true }), "ungroup-layers");
  assert.equal(commandForShortcut({ ...event, key: "e" }), "merge-layers");
  assert.equal(commandForShortcut({ ...event, key: "e", shiftKey: true }), "export");
  assert.equal(commandForShortcut({ ...event, key: "j" }), "duplicate-layer");
  assert.equal(commandForShortcut({ ...event, key: "j", altKey: true }), "selection-to-layer");
});
