import assert from "node:assert/strict";
import test from "node:test";
import { Studio } from "../app/engine/studio.ts";
import { solidCanvas, testCanvas, pixelAt } from "./canvas-harness.ts";
import { smartContentUnavailableReason } from "../app/engine/smart-object-content.ts";
import { replaceSmartContentFromFile } from "../app/studio/smart-content-import.ts";
import { decodeLumaProject } from "../app/engine/project.ts";
import { SparseAlphaSurface } from "../app/engine/alpha-surface.ts";
import { ResidentMemoryBudget } from "../app/engine/resident-memory.ts";

function setup() {
  const studio = new Studio(8, 8, testCanvas(8, 8));
  const layer = studio.addBlankRaster("Object");
  studio.fillLayer(layer.id, "#ff0000");
  studio.convertToSmartObject(layer.id);
  return { studio, layer };
}

test("replacement preserves transform, masks and styling, fits bounds, and undo/redo restores pixels", async () => {
  const { studio, layer } = setup();
  studio.updateTransform(layer.id, { tx: 7, rotation: 25 });
  studio.addSmartFilter(layer.id, "blur");
  studio.addDropShadow(layer.id);
  layer.maskSurface = new SparseAlphaSurface(8, 8, { defaultAlpha: 128 });
  const mask = layer.maskSurface;
  studio.markDocumentSaved();
  const styling = JSON.stringify({ transform: layer.transform, filters: layer.filters, effects: layer.effects });
  studio.replaceSmartContent(studio.prepareSmartContentReplacement(layer.id), solidCanvas(4, 2, "#00ff00"));
  assert.deepEqual(pixelAt(layer.bitmap!, 3, 3), { r: 0, g: 255, b: 0, a: 255 });
  assert.equal(pixelAt(layer.bitmap!, 0, 0).a, 0);
  assert.equal(JSON.stringify({ transform: layer.transform, filters: layer.filters, effects: layer.effects }), styling);
  assert.equal(studio.activeDocumentState().dirty, true);
  assert.equal(layer.maskSurface, mask);
  studio.undo();
  assert.equal(pixelAt(layer.bitmap!, 3, 3).r, 255);
  assert.equal(studio.activeDocumentState().dirty, false);
  studio.redo();
  assert.equal(pixelAt(layer.bitmap!, 3, 3).g, 255);
  const saved = await studio.prepareProjectSave("Smart replacement");
  const reopened = await decodeLumaProject(saved.blob);
  assert.equal(reopened.doc.layers[0].kind, "smart-object");
  assert.equal(pixelAt(reopened.doc.layers[0].bitmap!, 3, 3).g, 255);
  assert.deepEqual(reopened.doc.layers[0].transform, layer.transform);
  studio.dispose();
});

test("replacement rejects stale targets, locked/foreign/high-depth objects and huge inputs without mutation", () => {
  const { studio, layer } = setup();
  const target = studio.prepareSmartContentReplacement(layer.id);
  studio.updateTransform(layer.id, { tx: 1 });
  assert.throws(() => studio.replaceSmartContent(target, solidCanvas(1, 1, "blue")), /changed/);
  const fresh = studio.prepareSmartContentReplacement(layer.id);
  assert.throws(() => studio.replaceSmartContent(fresh, { width: 50_000, height: 50_000 } as HTMLCanvasElement), /4 megapixels/);
  assert.equal(pixelAt(layer.bitmap!, 0, 0).r, 255);
  layer.locked = true; assert.match(smartContentUnavailableReason(studio.doc, layer)!, /Unlock/);
  layer.locked = false;
  layer.photoshop = { sourceIndex: 0 }; assert.match(smartContentUnavailableReason(studio.doc, layer)!, /preserved/);
  layer.photoshop = undefined;
  studio.doc.bitDepth = 16; assert.match(smartContentUnavailableReason(studio.doc, layer)!, /8-bit/);
  studio.doc.bitDepth = 8;
  studio.resetDocument(4, 4, "Other");
  assert.throws(() => studio.replaceSmartContent(fresh, solidCanvas(1, 1, "blue")), /changed/);
  studio.dispose();
});

test("file replacement rejects unrecognized and oversized headers before decoding", async () => {
  const { studio, layer } = setup();
  const target = studio.prepareSmartContentReplacement(layer.id);
  await assert.rejects(replaceSmartContentFromFile(studio, target, new File(["bad"], "fake.png")), /supported|header|image/i);
  const png = new Uint8Array(33);
  png.set([137, 80, 78, 71, 13, 10, 26, 10]);
  png.set([73, 72, 68, 82], 12);
  new DataView(png.buffer).setUint32(16, 50_000);
  new DataView(png.buffer).setUint32(20, 50_000);
  await assert.rejects(replaceSmartContentFromFile(studio, target, new File([png], "huge.png")), /large|canvas|header/i);
  assert.equal(pixelAt(layer.bitmap!, 0, 0).r, 255);
  studio.dispose();
});

test("memory admission failure leaves old contents and history untouched", () => {
  const { studio, layer } = setup();
  const historyBefore = studio.historyLabels();
  (studio as unknown as { residentMemoryBudget: ResidentMemoryBudget }).residentMemoryBudget = new ResidentMemoryBudget(1);
  const target = studio.prepareSmartContentReplacement(layer.id);
  assert.throws(() => studio.replaceSmartContent(target, solidCanvas(8, 8, "blue")), /memory|ceiling|budget/i);
  assert.equal(pixelAt(layer.bitmap!, 0, 0).r, 255);
  assert.deepEqual(studio.historyLabels(), historyBefore);
  studio.dispose();
});

test("failure after replacement preparation rolls back the same layer and surface owners", () => {
  const { studio, layer } = setup();
  const bitmap = layer.bitmap, surface = layer.surface, history = studio.historyLabels();
  const target = studio.prepareSmartContentReplacement(layer.id);
  const engine = studio as unknown as { commit: () => void };
  const commit = engine.commit;
  engine.commit = () => { throw new Error("Injected history admission failure"); };
  try {
    assert.throws(() => studio.replaceSmartContent(target, solidCanvas(8, 8, "blue")), /Injected/);
    assert.equal(layer.bitmap, bitmap); assert.equal(layer.surface, surface);
    assert.equal(pixelAt(layer.bitmap!, 0, 0).r, 255);
    assert.deepEqual(studio.historyLabels(), history);
  } finally { engine.commit = commit; studio.dispose(); }
});

test("native contents open in an independent tab, apply transactionally and reopen as editable layers", async () => {
  const { studio, layer } = setup();
  const parent = studio.activeDocumentState().id;
  try {
    const child = await studio.editSmartContents(layer.id);
    assert.notEqual(child, parent); assert.equal(studio.canApplySmartContents(), true);
    const contentLayer = studio.doc.layers[0];
    studio.fillLayer(contentLayer.id, "#00ff00");
    assert.equal(pixelAt(layer.bitmap!, 0, 0).r, 255);
    const extra = studio.addBlankRaster("Editable extra");
    studio.setLayerProp(extra.id, "visible", false);
    await studio.applySmartContents();
    assert.equal(studio.activeDocumentState().id, parent);
    assert.equal(pixelAt(layer.bitmap!, 0, 0).g, 255);
    assert.ok(layer.smartSource?.byteLength);
    studio.undo(); assert.equal(pixelAt(layer.bitmap!, 0, 0).r, 255); assert.equal(layer.smartSource, undefined);
    studio.redo(); assert.equal(pixelAt(layer.bitmap!, 0, 0).g, 255); assert.ok(layer.smartSource);
    const saved = (await studio.prepareProjectSave("Native smart source")).blob;
    const reopened = new Studio(8, 8, testCanvas(8, 8));
    try {
      await reopened.importProject(saved);
      await reopened.editSmartContents(reopened.doc.layers[0].id);
      assert.equal(reopened.doc.layers.length, 2);
      assert.ok(reopened.doc.layers.some(l => l.name === "Editable extra"));
      assert.equal(pixelAt(reopened.doc.layers.find(l => l.name === "Contents")!.bitmap!, 0, 0).g, 255);
    } finally { reopened.dispose(); }
  } finally { studio.dispose(); }
});

test("contents apply rejects a changed parent and retains both documents", async () => {
  const { studio, layer } = setup();
  const parent = studio.activeDocumentState().id;
  try {
    const child = await studio.editSmartContents(layer.id);
    studio.fillLayer(studio.doc.layers[0].id, "blue");
    studio.switchDocument(parent); studio.updateTransform(layer.id, { tx: 2 }); studio.switchDocument(child);
    await assert.rejects(studio.applySmartContents(), /parent document changed/);
    assert.equal(studio.activeDocumentState().id, child);
    assert.equal(layer.smartSource, undefined); assert.equal(pixelAt(layer.bitmap!, 0, 0).r, 255);
  } finally { studio.dispose(); }
});
