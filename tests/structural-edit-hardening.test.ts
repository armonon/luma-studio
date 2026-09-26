import assert from "node:assert/strict";
import test from "node:test";
import { Studio } from "../app/engine/studio";
import { createGroupLayer, createRasterLayer, newCanvas } from "../app/engine/document";
import { solidCanvas, testCanvas } from "./canvas-harness";
import { renderClean, renderTiledClean, tiledCleanRenderBytes } from "../app/engine/renderer";
import { isSafeAction } from "../app/engine/actions";

const operations = {
  group: (s: Studio, ids: string[]) => s.groupLayers(ids),
  delete: (s: Studio, ids: string[]) => s.removeLayers(ids),
  duplicate: (s: Studio, ids: string[]) => s.duplicateLayers(ids),
  merge: (s: Studio, ids: string[]) => s.mergeLayers(ids),
  hide: (s: Studio, ids: string[]) => s.setLayersFlag(ids, "visible", false),
  lock: (s: Studio, ids: string[]) => s.setLayersFlag(ids, "locked", true),
  reorder: (s: Studio, ids: string[]) => s.reorderLayer(ids[0], 1),
};

for (const [name, run] of Object.entries(operations)) for (const boundary of ["commit", "bindDocumentMemory"] as const) {
  test(`${name}: failed ${boundary} restores structural owners, pixels, history and dirty state`, () => {
    const s = new Studio(16, 16, testCanvas(1, 1));
    s.doc.layers = [createRasterLayer("Red", solidCanvas(16, 16, "red")), createRasterLayer("Blue", solidCanvas(16, 16, "blue"))];
    const original = s.doc.layers.slice(), ids = original.map(l => l.id), node = s.historyState().currentId;
    const internal = s as unknown as Record<typeof boundary, (...args: unknown[]) => unknown>;
    const previous = internal[boundary];
    s.actions.start("Failed operation");
    internal[boundary] = () => { throw new Error("Injected publication failure"); };
    try {
      assert.throws(() => run(s, ids), /Injected/);
      assert.deepEqual(s.doc.layers, original);
      for (const [i, l] of s.doc.layers.entries()) {
        assert.equal(l, original[i]); assert.equal(l.parentId, undefined);
        assert.equal(l.visible, true); assert.equal(Boolean(l.locked), false);
        assert.equal(l.bitmap?.width, 16);
      }
      assert.equal(s.historyState().currentId, node);
      assert.equal(s.activeDocumentState().dirty, false);
      assert.deepEqual(s.actions.stop()?.steps, []);
    } finally { internal[boundary] = previous; }
    try { run(s, ids); s.undo(); assert.deepEqual(s.doc.layers.map(l => l.id), ids); s.redo(); }
    finally { s.dispose(); }
  });
}

test("delete and transform share ancestor-lock protection; unsupported group transforms cannot create no-op history", () => {
  const s = new Studio(16, 16, testCanvas(1, 1));
  try {
    const child = s.addBlankRaster("Child"), group = s.groupLayers([child.id]);
    const node = s.historyState().currentId;
    s.updateTransform(group.id, { tx: 8 }); s.liveUpdateTransform(group.id, { tx: 8 });
    assert.equal(group.transform.tx, 0); assert.equal(s.historyState().currentId, node);
    s.setLayersFlag([group.id], "locked", true);
    s.removeLayer(child.id); s.updateTransform(child.id, { tx: 8 }); s.liveUpdateTransform(child.id, { tx: 8 });
    assert.ok(s.findLayer(child.id)); assert.equal(child.transform.tx, 0);
    assert.equal(s.groupLayer(child.id), null);
    s.ungroupLayer(group.id); assert.ok(s.findLayer(group.id));
    const lockedNode = s.historyState().currentId;
    assert.equal(s.liveUpdateLayerProp(child.id, "opacity", .2), false);
    s.setLayerProp(child.id, "opacity", .2); s.reorderLayer(child.id, -1);
    assert.equal(child.opacity, 1); assert.equal(s.historyState().currentId, lockedNode);
  } finally { s.dispose(); }
});

test("tiled clean render matches full render across tile boundaries and avoids full-size scratch canvases", () => {
  const s = new Studio(600, 530, testCanvas(1, 1));
  try {
    s.doc.layers = [createRasterLayer("Top", solidCanvas(300, 300, "red")), createRasterLayer("Bottom", solidCanvas(600, 530, "blue"))];
    s.doc.layers[0].transform.tx = 200; s.doc.layers[0].opacity = .4;
    const full = newCanvas(600, 530), tiled = newCanvas(600, 530);
    renderClean(s.doc, full);
    const create = document.createElement.bind(document), created: HTMLCanvasElement[] = [];
    document.createElement = ((tag: string) => { const canvas = create(tag); if (tag === "canvas") created.push(canvas as HTMLCanvasElement); return canvas; }) as typeof document.createElement;
    try { renderTiledClean(s.doc, tiled); } finally { document.createElement = create; }
    assert.deepEqual(tiled.getContext("2d")!.getImageData(0, 0, 600, 530).data, full.getContext("2d")!.getImageData(0, 0, 600, 530).data);
    assert.ok(created.every(c => c.width < 600 || c.height < 530));
    assert.ok(tiledCleanRenderBytes(s.doc) >= 600 * 530 * 4 + 64 * 1024 * 1024);
  } finally { s.dispose(); }
});

test("bulk actions record, serialize and replay multi-layer selections with structure checks", () => {
  const source = new Studio(16, 16, testCanvas(1, 1)), target = new Studio(16, 16, testCanvas(1, 1));
  try {
    for (const s of [source, target]) { s.addBlankRaster("A"); s.addBlankRaster("B"); }
    source.startRecording("Organize");
    const group = source.groupLayers(source.doc.layers.map(l => l.id));
    source.setLayersFlag([group.id], "visible", false);
    source.setLayersFlag([group.id], "visible", true);
    const restored = source.ungroupLayers([group.id]);
    source.duplicateLayers(restored);
    const action = JSON.parse(JSON.stringify(source.stopRecording()!));
    assert.ok(isSafeAction(action));
    assert.equal(action.steps.length, 5);
    target.replay(action, target.doc.layers[0].id);
    assert.deepEqual(target.doc.layers.map(l => [l.name, l.kind, l.visible]), source.doc.layers.map(l => [l.name, l.kind, l.visible]));
    target.doc.layers = [];
    const failed = target.replayWithReport(action, null);
    assert.equal(failed.completed, false); assert.match(failed.steps[0].message!, /structure/);
    assert.equal(isSafeAction({ name: "Bad", steps: [{ op: "layerBatch", operation: "delete", targets: [{ index: -1, kind: "raster" }] }] }), false);
  } finally { source.dispose(); target.dispose(); }
});

test("merge preserves nested group masks, opacity and filtered pixels; filtered working sets use full-frame admission", () => {
  const s = new Studio(600, 530, testCanvas(1, 1));
  try {
    const group = createGroupLayer("Masked group"); group.opacity = .6;
    const top = createRasterLayer("Top", solidCanvas(300, 300, "red")); top.parentId = group.id; top.transform.tx = 240;
    group.mask = solidCanvas(600, 530, "white");
    group.mask.getContext("2d")!.clearRect(0, 0, 300, 250);
    const bottom = createRasterLayer("Bottom", solidCanvas(600, 530, "blue"));
    s.doc.layers = [group, top, bottom];
    for (const filtered of [false, true]) {
      if (filtered) top.filters = [{ id: "blur", kind: "blur", enabled: true, opacity: 1, params: { radius: 80 } }];
      const full = newCanvas(600, 530), tiled = newCanvas(600, 530);
      renderClean(s.doc, full); renderTiledClean(s.doc, tiled);
      assert.deepEqual(tiled.getContext("2d")!.getImageData(0, 0, 600, 530).data, full.getContext("2d")!.getImageData(0, 0, 600, 530).data);
      if (filtered) assert.ok(tiledCleanRenderBytes(s.doc) >= 600 * 530 * 68 + 64 * 1024 * 1024);
    }
  } finally { s.dispose(); }
});
