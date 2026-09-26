import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import "./canvas-harness";
import { newCanvas, createDocument } from "../app/engine/document";
import { readPsd, writePsd } from "../app/engine/ag-psd-io";
import { importPsd, exportPhotoshopDocument } from "../app/engine/psd";
import { encodeLumaProject, decodeLumaProject } from "../app/engine/project";
import { drawLayerContentManaged } from "../app/engine/precision-renderer";
import { isProvablyTransparent } from "../app/engine/png-stream";
import { OperationHistory } from "../app/engine/operation-history";
import { Studio, type HistoryEntry } from "../app/engine/studio";
import { glCanRenderDocument } from "../app/engine/gl-renderer";
import { nativeFlattenRefusal } from "../app/engine/native-flatten";
import { registerPhotoshopTileSource, PhotoshopTileSource } from "../app/engine/photoshop-tile-source";
import { assertSourceBackedExportBudget } from "../app/engine/photoshop-source-export";

function fixture(psb = false) {
  const canvas = newCanvas(514, 260), ctx = canvas.getContext("2d")!;
  const image = ctx.createImageData(canvas.width, canvas.height);
  for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
    const i = (y * canvas.width + x) * 4;
    image.data.set([x % 256, y % 256, (x + y) % 256, 255], i);
  }
  ctx.putImageData(image, 0, 0);
  return writePsd({ width: 514, height: 260, children: [{ name: "Base", canvas }, { name: "Top", canvas }] }, { psb, noBackground: true });
}

test("source-backed render, reads and history clones leave untouched tiles nonresident", async () => {
  const bytes = fixture(), doc = await importPsd(bytes, { sourceBacked: true });
  const layer = doc.layers[0], surface = layer.surface!;
  assert.throws(() => surface.store.write("00:0", new Uint8Array(256 * 256 * 16)), /Invalid tile key/);
  assert.equal(layer.bitmap, undefined);
  assert.equal(surface.stats().residentBytes, 0);
  assert.equal(isProvablyTransparent(doc), false);
  const output = newCanvas(514, 260);
  drawLayerContentManaged(output.getContext("2d")!, layer);
  assert.deepEqual([...output.getContext("2d")!.getImageData(513, 259, 1, 1).data], [1, 3, 4, 255]);
  const clone = surface.clone();
  assert.equal(clone.store.sourceState()!.base, surface.store.sourceState()!.base);
  surface.writePixel(1, 1, [1, 0, 0, 1]);
  assert.equal(surface.stats().residentTiles, 1);
  assert.notDeepEqual(surface.readPixel(1, 1), clone.readPixel(1, 1));
  surface.store.delete("1:0");
  assert.deepEqual(surface.readPixel(256, 0), [0, 0, 0, 0]);
  assert.ok(clone.readPixel(256, 0)[3]);
  assert.throws(() => surface.store.checkpointSnapshot(), /source-aware/);
});

for (const psb of [false, true]) test(`source edits and deletions survive native history and ${psb ? "PSB" : "PSD"} export`, async () => {
  const doc = await importPsd(fixture(!psb), { sourceBacked: true });
  const layer = doc.layers[0], surface = layer.surface!, clone = surface.clone();
  const history = new OperationHistory<HistoryEntry>();
  const before = surface.store.read("0:0");
  surface.writePixel(3, 4, [1, 0, 0, 1]);
  surface.store.delete("1:0");
  history.commit("Paint", { label: "Paint", before: [], after: [], surfacePatches: [{ layerId: layer.id, key: "0:0", before, after: surface.store.read("0:0"), updateBitmap: false }] });
  const archive = await encodeLumaProject(doc, [], "Sparse source", history.snapshot());
  const zip = await JSZip.loadAsync(await archive.arrayBuffer());
  assert.equal(Object.keys(zip.files).filter(name => name.endsWith(".bin") && name.startsWith("assets/photoshop/")).length, 1);
  const restored = await decodeLumaProject(archive);
  const reopened = restored.doc.layers[0].surface!;
  assert.equal(reopened.stats().residentTiles, 1);
  assert.deepEqual(reopened.readPixel(3, 4), [1, 0, 0, 1]);
  assert.deepEqual(reopened.readPixel(257, 2), [0, 0, 0, 0]);
  assert.equal(reopened.store.sourceState()!.base.source.bytes, restored.doc.layers[1].surface!.store.sourceState()!.base.source.bytes);
  const exported = exportPhotoshopDocument(restored.doc, { format: psb ? "psb" : "psd" });
  const decoded = readPsd(exported.buffer, { useImageData: true });
  const pixels = decoded.children![1].imageData!.data;
  assert.deepEqual([...pixels.slice((4 * 514 + 3) * 4, (4 * 514 + 3) * 4 + 4)], [255, 0, 0, 255]);
  assert.equal(pixels[(2 * 514 + 257) * 4 + 3], 0);
  // Same tile patches used by Studio undo, without eagerly cloning the base.
  reopened.store.write("0:0", before!);
  assert.deepEqual(reopened.readPixel(3, 4), clone.readPixel(3, 4));
});

test("source-backed restore rejects mismatched geometry and import rejects masks", async () => {
  const doc = await importPsd(fixture(), { sourceBacked: true });
  const archive = await encodeLumaProject(doc, [], "Invalid base");
  const zip = await JSZip.loadAsync(await archive.arrayBuffer());
  const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
  manifest.document.layers[0].surface.width++;
  zip.file("manifest.json", JSON.stringify(manifest));
  await assert.rejects(decodeLumaProject(await zip.generateAsync({ type: "uint8array" })), /geometry/);
  const masked = writePsd({ width: 8, height: 8, children: [{ canvas: newCanvas(8, 8), mask: { canvas: newCanvas(8, 8) } }] });
  await assert.rejects(importPsd(masked, { sourceBacked: true }), /masks/);
});

test("Studio paint, cancel, fill, delete and reopened undo use bounded source tiles", async () => {
  const doc = await importPsd(fixture(), { sourceBacked: true });
  const studio = new Studio(514, 260, newCanvas(514, 260));
  const restored = new Studio(514, 260, newCanvas(514, 260));
  try {
    await studio.importProject(await encodeLumaProject(doc, [], "Source"));
    const layer = studio.doc.layers[0], surface = layer.surface!;
    const original = surface.readPixel(40, 40);
    const brush = { mode: "paint" as const, size: 16, hardness: 1, opacity: 1, color: "#ff0000" };
    studio.beginStroke(layer.id, brush, { x: 40, y: 40, p: 1 });
    studio.endStroke(layer.id, brush);
    assert.notDeepEqual(surface.readPixel(40, 40), original);
    studio.undo();
    assert.deepEqual(surface.readPixel(40, 40), original);
    assert.equal(surface.stats().residentBytes, 0, "undo returns to the immutable source, not a decoded snapshot");
    studio.redo();
    const painted = surface.readPixel(40, 40);
    studio.beginStroke(layer.id, { ...brush, color: "#00ff00" }, { x: 40, y: 40, p: 1 });
    studio.cancelStroke();
    assert.deepEqual(surface.readPixel(40, 40), painted);
    studio.selectRect(36, 36, 8, 8);
    studio.fillLayer(layer.id, "#0000ff", .5);
    const filled = surface.readPixel(40, 40);
    assert.ok(filled[2] > .4 && filled[0] > .4);
    studio.undo(); assert.deepEqual(surface.readPixel(40, 40), painted);
    studio.redo(); assert.deepEqual(surface.readPixel(40, 40), filled);
    studio.clearPixels(layer.id);
    assert.equal(surface.readPixel(40, 40)[3], 0);
    await restored.importProject(await studio.exportProject("Undo source"));
    const reopened = restored.doc.layers[0].surface!;
    assert.equal(reopened.readPixel(40, 40)[3], 0);
    restored.undo(); assert.deepEqual(reopened.readPixel(40, 40), filled);
    restored.redo(); assert.equal(reopened.readPixel(40, 40)[3], 0);
    assert.ok(reopened.stats().residentBytes <= 1024 * 1024);
  } finally { studio.dispose(); restored.dispose(); }
});

test("failed publication rolls back to the immutable base without resident copies", async () => {
  const doc = await importPsd(fixture(), { sourceBacked: true });
  const studio = new Studio(514, 260, newCanvas(514, 260));
  try {
    await studio.importProject(await encodeLumaProject(doc, [], "Failure"));
    const layer = studio.doc.layers[0], surface = layer.surface!;
    assert.equal(glCanRenderDocument(studio.doc), false);
    assert.equal(nativeFlattenRefusal(studio.doc), "source-backed");
    assert.equal(studio.engineState().sourceBackedBytes, surface.store.sourceState()!.base.source.bytes.length);
    studio.selectRect(20, 20, 8, 8);
    const before = surface.readPixel(22, 22), history = studio.historyState().currentId;
    const internal = studio as unknown as { commit: (entry: HistoryEntry) => void };
    internal.commit = () => { throw new Error("Injected publication failure"); };
    assert.throws(() => studio.fillLayer(layer.id, "#ff0000"), /Injected/);
    assert.deepEqual(surface.readPixel(22, 22), before);
    assert.equal(surface.stats().residentBytes, 0);
    assert.equal(studio.historyState().currentId, history);
    assert.throws(() => studio.filter(layer.id, "invert"), /smart filter/);
  } finally { studio.dispose(); }
});

test("malformed offscreen PackBits is rejected before a source is published", () => {
  const bytes = new Uint8Array(fixture());
  registerPhotoshopTileSource(bytes, [{ left: 0, top: 0, right: 3, bottom: 2,
    rawData: { bitsPerChannel: 8, colorMode: 3, large: false, channels: [
      { id: 0, compression: 1, data: new Uint8Array([0, 2, 0, 2, 254, 8, 253, 9]) },
    ] },
  }]);
  assert.throws(() => new PhotoshopTileSource(bytes, 0), /exceeds its width/);
});

test("source bytes owned only by deleted-layer history remain admitted until the tab closes", async () => {
  const imported = await importPsd(fixture(), { sourceBacked: true });
  // A foreign document has no Photoshop document metadata retaining the source.
  const doc = createDocument(514, 260); doc.layers = imported.layers;
  const studio = new Studio(514, 260, newCanvas(514, 260));
  const reopened = new Studio(514, 260, newCanvas(514, 260));
  try {
    await studio.importProject(await encodeLumaProject(doc, [], "Foreign sources"));
    const sourceBytes = studio.doc.layers[0].surface!.store.sourceState()!.base.source.bytes.length;
    studio.removeLayers(studio.doc.layers.map(layer => layer.id));
    studio.addBlankRaster("Scratch");
    assert.ok(studio.engineState().residentMemoryBudget.residentBytes >= sourceBytes + 96 * 1024 * 1024);
    await reopened.importProject(await studio.exportProject("History owns source"));
    assert.ok(reopened.engineState().residentMemoryBudget.residentBytes >= sourceBytes + 96 * 1024 * 1024);
    reopened.undo(); reopened.undo();
    assert.equal(reopened.doc.layers.length, 2);
    assert.equal(reopened.doc.layers[0].surface!.readPixel(1, 1)[3], 1);
    reopened.closeDocument(reopened.activeDocumentState().id);
    assert.equal(reopened.engineState().residentMemoryBudget.residentBytes, 0);
  } finally { studio.dispose(); reopened.dispose(); }
});

test("source reader indexes and writer growth are admitted before allocation", () => {
  const bytes = new Uint8Array(fixture());
  assert.throws(() => registerPhotoshopTileSource(bytes, [{ left: 0, top: 0, right: 1, bottom: 5_000_000,
    rawData: { bitsPerChannel: 8, colorMode: 3, large: false, channels: [{ id: 0, compression: 1, data: new Uint8Array([0]) }] },
  }]), /index\/descriptor budget/);
  assert.throws(() => registerPhotoshopTileSource(bytes, Array.from({ length: 4096 }, () => ({ name: "metadata" }))), /index\/descriptor budget/);
  assert.throws(() => assertSourceBackedExportBudget(30_000, 30_000, 1, 1, 0), /writer.*memory ceiling/);
  assert.throws(() => assertSourceBackedExportBudget(4800, 6000, 512 * 1024 * 1024, 1, 0), /writer.*memory ceiling/);
  assert.ok(assertSourceBackedExportBudget(4800, 6000, 100 * 1024 * 1024, 200 * 1024 * 1024, 100 * 1024 * 1024) < 2 * 1024 * 1024 * 1024);
});

test("six source-backed edit/save/reopen cycles preserve undo, untouched pixels and one shared base", async () => {
  const imported = await importPsd(fixture(), { sourceBacked: true });
  let archive = await encodeLumaProject(imported, [], "Repeated job");
  const expected = new Map<string, number[]>();
  const locations = [[255, 255], [256, 255], [255, 256], [256, 256], [513, 259], [0, 0]];
  for (let cycle = 0; cycle < locations.length; cycle++) {
    const studio = new Studio(514, 260, newCanvas(514, 260));
    try {
      await studio.importProject(archive);
      const layer = studio.doc.layers[0], surface = layer.surface!;
      for (const [key, value] of expected) {
        const [x, y] = key.split(":").map(Number);
        assert.deepEqual(surface.readPixel(x, y), value, `previous edit ${key} survives cycle ${cycle}`);
      }
      if (cycle > 0) {
        const [px, py] = locations[cycle - 1], previous = surface.readPixel(px, py);
        studio.undo(); assert.notDeepEqual(surface.readPixel(px, py), previous, "saved history remains usable after reopen");
        studio.redo(); assert.deepEqual(surface.readPixel(px, py), previous);
      }
      const [x, y] = locations[cycle], before = surface.readPixel(x, y);
      const residentBefore = surface.stats().residentBytes;
      studio.selectRect(x, y, 1, 1);
      studio.fillLayer(layer.id, cycle % 2 ? "#00ff00" : "#ff0000");
      const after = surface.readPixel(x, y);
      assert.notDeepEqual(after, before);
      studio.undo();
      assert.deepEqual(surface.readPixel(x, y), before);
      assert.equal(surface.stats().residentBytes, residentBefore);
      studio.redo();
      assert.deepEqual(surface.readPixel(x, y), after);
      expected.set(`${x}:${y}`, after);
      const untouched = surface.readPixel(400, 100);
      const recovery = await studio.exportRecoveryDocument();
      archive = await studio.exportProject("Repeated job");
      const restored = await decodeLumaProject(archive);
      assert.deepEqual(restored.doc.layers[0].surface!.readPixel(400, 100), untouched);
      assert.equal(restored.doc.layers[0].surface!.store.sourceState()!.base.source.bytes,
        restored.doc.layers[1].surface!.store.sourceState()!.base.source.bytes);
      const recovered = await decodeLumaProject(recovery.blob);
      assert.deepEqual(recovered.doc.layers[0].surface!.readPixel(x, y), after, "crash checkpoint retains this edit");
      const zip = await JSZip.loadAsync(await archive.arrayBuffer());
      assert.equal(Object.keys(zip.files).filter(name => name.startsWith("assets/photoshop/") && name.endsWith(".bin")).length, 1);
      // Alternate PSD and PSB delivery after every native round trip.
      const output = exportPhotoshopDocument(restored.doc, { format: cycle % 2 ? "psb" : "psd" });
      const delivery = await importPsd(output.buffer, { sourceBacked: true });
      for (const [key, value] of expected) {
        const [px, py] = key.split(":").map(Number);
        assert.deepEqual(delivery.layers[0].surface!.readPixel(px, py), value);
      }
    } finally { studio.dispose(); }
  }
});

test("failed source-backed project open and unsupported export leave active artwork/history intact", async () => {
  const studio = new Studio(514, 260, newCanvas(514, 260));
  try {
    const doc = await importPsd(fixture(), { sourceBacked: true });
    await studio.importProject(await encodeLumaProject(doc, [], "Protected"));
    const layer = studio.doc.layers[0], active = studio.activeDocumentState().id;
    studio.selectRect(255, 255, 3, 3);
    studio.fillLayer(layer.id, "#ff0000");
    const before = layer.surface!.readPixel(256, 256), cursor = studio.historyState().currentId;
    await assert.rejects(studio.importProject(new Blob(["not a project"])));
    assert.equal(studio.activeDocumentState().id, active);
    assert.deepEqual(layer.surface!.readPixel(256, 256), before);
    assert.equal(studio.historyState().currentId, cursor);
    const oldRotation = layer.transform.rotation;
    layer.transform.rotation = Math.PI / 12;
    assert.throws(() => exportPhotoshopDocument(studio.doc, { format: "psd" }), /transform|rotation|source-backed/i);
    assert.deepEqual(layer.surface!.readPixel(256, 256), before);
    assert.equal(studio.historyState().currentId, cursor);
    layer.transform.rotation = oldRotation;
    studio.undo();
    assert.notDeepEqual(layer.surface!.readPixel(256, 256), before);
  } finally { studio.dispose(); }
});
