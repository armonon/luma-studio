import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { Studio } from "../app/engine/studio.ts";
import { solidCanvas, testCanvas, pixelAt } from "./canvas-harness.ts";
import { cloneLetteringAsset, validateLetteringAsset, letteringAssetBytes, type LetteringAsset } from "../app/engine/lettering-asset.ts";
import { DEFAULT_TEXT_SPATIAL } from "../app/engine/text-3d.ts";
import { decodeLumaProject } from "../app/engine/project.ts";
import { snapshotLayer, shallowCloneLayer, historyEntrySize } from "../app/engine/history-payload.ts";
import { smartContentUnavailableReason } from "../app/engine/smart-object-content.ts";
import { panelForLayer } from "../app/studio/contextual-panel-registry.ts";
import { ResidentMemoryBudget } from "../app/engine/resident-memory.ts";

function asset(): LetteringAsset {
  return { version: 1, renderer: "luma-lettering-v1", width: 1600, height: 1200,
    text: { text: "A", font: '400 96px "Lato", sans-serif', color: "#ffffff", align: "left", lineHeight: 1.1, x: 0, y: 100 },
    spatial: { ...structuredClone(DEFAULT_TEXT_SPATIAL), enabled: true },
    outlines: { fontFile: "Lato-Regular.ttf", glyphs: [3], lineWidths: [64], paths: [{ commands: [{ type: "M", x: 0, y: 0 }, { type: "L", x: 32, y: -64 }, { type: "L", x: 64, y: 0 }, { type: "Z" }] }] } };
}
function setup() {
  const studio = new Studio(16, 12, testCanvas(16, 12));
  const source = studio.addTextLayer("A", asset().text);
  return { studio, source };
}

test("3D metadata validates bounds, versions, fonts, geometry and finite settings", () => {
  validateLetteringAsset(asset());
  for (const mutate of [
    (a: LetteringAsset) => { a.width = 50000; },
    (a: LetteringAsset) => { a.renderer = "unknown" as never; },
    (a: LetteringAsset) => { a.spatial.transform.rotationX = NaN; },
    (a: LetteringAsset) => { a.spatial.material.frontColor = "url(external)"; },
    (a: LetteringAsset) => { a.outlines.fontFile = "missing.ttf"; },
    (a: LetteringAsset) => { a.outlines.paths[0].commands = [{ type: "L", x: Infinity, y: 0 }]; },
    (a: LetteringAsset) => { a.outlines.paths[0].commands = Array.from({ length: 12001 }, () => ({ type: "Z" })); },
  ]) { const a = asset(); mutate(a); assert.throws(() => validateLetteringAsset(a)); }
});

test("3D object creation, atomic edits, dirty state, undo, redo and project history round-trip", async () => {
  const { studio, source } = setup();
  const a = asset(); a.text = structuredClone(source.text!);
  const object = studio.addLetteringObject(source.id, solidCanvas(1600, 1200, "red"), a);
  assert.equal(object.kind, "smart-object");
  assert.equal(panelForLayer(object), "vector");
  assert.equal(source.visible, false, "original editable text is retained but hidden to avoid double rendering");
  assert.deepEqual(studio.doc.layers.slice(0, 2).map(l => l.id), [object.id, source.id]);
  assert.match(smartContentUnavailableReason(studio.doc, object)!, /3D lettering editor/);
  assert.equal(studio.updateLayerSpatial(object.id, { enabled: true }), false);
  studio.markDocumentSaved();
  const target = studio.prepareLetteringEdit(object.id);
  const next = cloneLetteringAsset(a); next.text.text = "B"; next.spatial.extrusion.depth = 42;
  studio.updateLetteringObject(target, solidCanvas(1600, 1200, "blue"), next);
  assert.equal(object.lettering3d!.text.text, "B");
  assert.equal(pixelAt(object.bitmap!, 10, 10).b, 255);
  assert.equal(studio.activeDocumentState().dirty, true);
  studio.undo();
  assert.equal(object.lettering3d!.text.text, "A");
  assert.equal(pixelAt(object.bitmap!, 10, 10).r, 255);
  assert.equal(studio.activeDocumentState().dirty, false);
  studio.redo();
  const result = await decodeLumaProject((await studio.prepareProjectSave("3D round trip")).blob);
  const reopened = result.doc.layers.find(l => l.lettering3d)!;
  assert.deepEqual(reopened.lettering3d, JSON.parse(JSON.stringify(next)));
  assert.equal(pixelAt(reopened.bitmap!, 10, 10).b, 255);
  assert.ok(JSON.stringify(result.history!.snapshot()).includes("luma-lettering-v1"));
  const clone = shallowCloneLayer(object); const snap = snapshotLayer(object);
  next.spatial.extrusion.depth = 999;
  object.lettering3d!.outlines.paths[0].commands.length = 0;
  assert.ok(clone.lettering3d!.outlines.paths[0].commands.length > 0);
  assert.ok(snap.lettering3d!.outlines.paths[0].commands.length > 0);
  assert.ok(historyEntrySize({ label: "source", before: [snap], after: [] }) >= letteringAssetBytes(snap.lettering3d));
  studio.dispose();
});

test("stale, locked, invalid and out-of-memory 3D edits leave committed work unchanged", () => {
  const { studio, source } = setup();
  const a = asset(); a.text = structuredClone(source.text!);
  const object = studio.addLetteringObject(source.id, solidCanvas(1600, 1200, "red"), a);
  const target = studio.prepareLetteringEdit(object.id);
  studio.updateTransform(object.id, { tx: 1 });
  const image = solidCanvas(1600, 1200, "blue");
  assert.throws(() => studio.updateLetteringObject(target, image, a), /changed/);
  object.locked = true; assert.throws(() => studio.prepareLetteringEdit(object.id), /unlocked/); object.locked = false;
  const fresh = studio.prepareLetteringEdit(object.id);
  assert.throws(() => studio.updateLetteringObject(fresh, { width: 50000, height: 50000 } as HTMLCanvasElement, a), /dimensions/);
  const labels = studio.historyLabels();
  (studio as unknown as { residentMemoryBudget: ResidentMemoryBudget }).residentMemoryBudget = new ResidentMemoryBudget(1);
  assert.throws(() => studio.updateLetteringObject(fresh, image, a), /budget|memory|ceiling/i);
  assert.equal(pixelAt(object.bitmap!, 0, 0).r, 255);
  assert.deepEqual(studio.historyLabels(), labels);
  studio.dispose();
});

test("3D objects resize through transforms and reject destructive painting/warping", async () => {
  const { studio, source } = setup();
  const a = asset(); a.text = structuredClone(source.text!);
  const object = studio.addLetteringObject(source.id, solidCanvas(1600, 1200, "red"), a);
  const original = object.bitmap;
  const transform = { ...object.transform, tx: 2, ty: 3 }; object.transform = transform;
  assert.equal(studio.beginStroke(object.id, { mode: "paint", size: 10, hardness: 1, opacity: 1, color: "blue" }, { x: 5, y: 5, p: 1 }), false);
  assert.equal(studio.radialWarpLayer(object.id, { x: 0, y: 0 }, { x: 10, y: 0 }, 20), false);
  studio.resizeDocument(32, 24);
  assert.equal(object.bitmap, original);
  assert.equal(object.transform.sx, transform.sx * 2);
  assert.equal(object.transform.tx, 4);
  assert.equal(object.transform.ty, 6);
  const reopened = await decodeLumaProject((await studio.prepareProjectSave("3D resize")).blob);
  assert.equal(reopened.doc.layers[0].bitmap!.width, 1600);
  studio.dispose();
});

test("corrupt 3D project metadata and missing renders are refused", async () => {
  const { studio, source } = setup();
  const a = asset(); a.text = structuredClone(source.text!);
  studio.addLetteringObject(source.id, solidCanvas(1600, 1200, "red"), a);
  const saved = await studio.prepareProjectSave("Corrupt fixture");
  const zip = await JSZip.loadAsync(await saved.blob.arrayBuffer());
  const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
  const object = manifest.document.layers.find((l: { lettering3d?: unknown }) => l.lettering3d);
  const originalBitmapAsset = object.bitmapAsset;
  object.lettering3d.outlines.paths[0].commands[0].x = "malformed";
  zip.file("manifest.json", JSON.stringify(manifest));
  await assert.rejects(decodeLumaProject(new Blob([await zip.generateAsync({ type: "arraybuffer" })])), /outline coordinate/);
  object.lettering3d = a; delete object.bitmapAsset;
  zip.file("manifest.json", JSON.stringify(manifest));
  await assert.rejects(decodeLumaProject(new Blob([await zip.generateAsync({ type: "arraybuffer" })])), /committed render/);
  object.bitmapAsset = originalBitmapAsset;
  const png = await zip.file(originalBitmapAsset)!.async("uint8array");
  new DataView(png.buffer, png.byteOffset, png.byteLength).setUint32(16, 50_000);
  zip.file(originalBitmapAsset, png);
  zip.file("manifest.json", JSON.stringify(manifest));
  await assert.rejects(decodeLumaProject(new Blob([await zip.generateAsync({ type: "arraybuffer" })])), /PNG dimensions|render dimensions/);
  studio.dispose();
});
