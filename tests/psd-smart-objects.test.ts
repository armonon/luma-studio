import assert from "node:assert/strict";
import test from "node:test";
import { pixelAt, testCanvas } from "./canvas-harness.ts";
import { Studio } from "../app/engine/studio.ts";
import { readPsd } from "../app/engine/ag-psd-io.ts";
import { exportPhotoshopDocument, importPsd, photoshopCompatibilityReport } from "../app/engine/psd.ts";
import { decodeLumaProject } from "../app/engine/project.ts";
import { preparePhotoshopSmartObjects } from "../app/engine/psd-smart-objects.ts";
import { smartContentUnavailableReason } from "../app/engine/smart-object-content.ts";
import { getPhotoshopLayerMetadata } from "../app/engine/psd-metadata.ts";

async function setup() {
  const studio = new Studio(8, 8, testCanvas(8, 8));
  const layer = studio.addBlankRaster("Object"); studio.fillLayer(layer.id, "#ff0000");
  studio.convertToSmartObject(layer.id);
  await studio.editSmartContents(layer.id);
  const overlay = studio.addBlankRaster("Editable green"); studio.fillLayer(overlay.id, "#00ff00");
  await studio.applySmartContents();
  return { studio, layer };
}

test("newly converted raster Smart Objects also embed editable source pixels", async () => {
  const studio = new Studio(8, 8, testCanvas(8, 8));
  try {
    const layer = studio.addBlankRaster("Converted"); studio.fillLayer(layer.id, "#ff0000"); studio.convertToSmartObject(layer.id);
    const result = await studio.exportPhotoshop();
    const parent = readPsd(result.buffer, { useImageData: true });
    const file = parent.linkedFiles![0];
    const child = readPsd(file.data!.slice().buffer as ArrayBuffer, { useImageData: true });
    assert.equal(child.children!.length, 1);
    assert.deepEqual(Array.from(child.imageData!.data.slice(0, 4)), [255,0,0,255]);
    assert.equal(pixelAt(layer.bitmap!, 0, 0).r, 255, "export cleanup must not clear the borrowed layer bitmap");
  } finally { studio.dispose(); }
});

test("native contents export as actual layered PSB, with correct merged pixels and independent geometry", async () => {
  const { studio, layer } = await setup();
  try {
    studio.updateTransform(layer.id, { tx: 2, ty: 3, sx: 0.5, sy: 0.5 });
    const result = await studio.exportPhotoshop();
    assert.ok(result.report.issues.some(issue => issue.code === "NATIVE_SMART_OBJECT_EMBEDDED"));
    assert.ok(!result.report.issues.some(issue => issue.code === "SMART_OBJECT_PREVIEW_ONLY"));
    const parent = readPsd(result.buffer, { useImageData: true });
    const placed = parent.children!.find(child => child.placedLayer)!;
    assert.deepEqual(placed.placedLayer!.transform, [2,3,6,3,6,7,2,7]);
    const asset = parent.linkedFiles!.find(file => file.id === placed.placedLayer!.id)!;
    const child = readPsd(asset.data!.slice().buffer as ArrayBuffer, { useImageData: true });
    assert.equal(child.children!.length, 2);
    assert.ok(child.children!.some(entry => entry.name === "Editable green"));
    assert.deepEqual(Array.from(child.imageData!.data.slice(0, 4)), [0,255,0,255]);
    const merged = await importPsd(result.buffer.slice(0), { mode: "flattened" });
    assert.equal(pixelAt(merged.layers[0].bitmap!, 3, 4).g, 255);
    const source = await decodeLumaProject(layer.smartSource!);
    assert.equal(source.doc.layers.length, 2, "export must not mutate embedded native project");
    const imported = await importPsd(result.buffer.slice(0));
    assert.equal(imported.layers.find(entry => entry.kind === "smart-object")?.kind, "smart-object");
  } finally { studio.dispose(); }
});

test("cancel and stale document reject export without changing contents or leaking reservations", async () => {
  const { studio, layer } = await setup();
  try {
    studio.addSmartFilter(layer.id, "blur");
    const before = layer.smartSource;
    await assert.rejects(studio.exportPhotoshop({}, async () => false), /cancelled/);
    await assert.rejects(studio.exportPhotoshop({}, async () => { studio.updateTransform(layer.id, { tx: 1 }); return true; }), /changed/);
    assert.equal(layer.smartSource, before);
    assert.equal((studio as unknown as { reservedOperationBytes: number }).reservedOperationBytes, 0);
  } finally { studio.dispose(); }
});

test("malformed embedded contents fail closed and release memory", async () => {
  const { studio, layer } = await setup();
  try {
    layer.smartSource = new Uint8Array([1,2,3]);
    let reserved = 0;
    await assert.rejects(preparePhotoshopSmartObjects(studio.doc, bytes => { reserved += bytes; return () => { reserved -= bytes; }; }, () => {}));
    assert.equal(reserved, 0);
    await assert.rejects(studio.exportPsd());
    assert.equal((studio as unknown as { reservedOperationBytes: number }).reservedOperationBytes, 0);
  } finally { studio.dispose(); }
});

test("embedded Photoshop edit → apply → undo/redo → native save/reopen → PSD retains edited layered source", async () => {
  const original = await setup();
  const studio = new Studio(8, 8, testCanvas(8, 8));
  try {
    const exported = await original.studio.exportPhotoshop();
    await studio.importPsd(exported.buffer.slice(0));
    const layer = studio.doc.layers.find(entry => entry.kind === "smart-object")!;
    assert.equal(smartContentUnavailableReason(studio.doc, layer, "edit"), null);
    await studio.editSmartContents(layer.id);
    assert.equal(studio.doc.layers.length, 2);
    const top = studio.doc.layers.find(entry => entry.name === "Editable green")!;
    studio.fillLayer(top.id, "#0000ff");
    await studio.applySmartContents();
    assert.equal(pixelAt(layer.bitmap!, 0, 0).b, 255);
    assert.ok(!photoshopCompatibilityReport(studio.doc, { format: "source" }).issues.some(issue => issue.code === "ORIGINAL_SOURCE_PASSTHROUGH"));
    assert.throws(() => exportPhotoshopDocument(studio.doc), /guarded asynchronous/);
    studio.undo(); assert.equal(pixelAt(layer.bitmap!, 0, 0).g, 255);
    studio.redo(); assert.equal(pixelAt(layer.bitmap!, 0, 0).b, 255);
    const saved = await studio.exportProject("Edited placed object");
    const reopened = await decodeLumaProject(saved);
    const native = new Studio(8, 8, testCanvas(8, 8));
    try {
      // Public project import must reattach preservation metadata as well.
      await native.importProject(saved);
      const edited = await native.exportPhotoshop();
      const parent = readPsd(edited.buffer, { useImageData: true });
      const id = parent.children!.find(entry => entry.placedLayer)!.placedLayer!.id;
      const data = parent.linkedFiles!.find(file => file.id === id)!.data!;
      const contents = readPsd(data.slice().buffer as ArrayBuffer, { useImageData: true });
      assert.equal(contents.children!.length, 2);
      assert.equal(contents.imageData!.data[2], 255);
      assert.ok(reopened.doc.layers.find(entry => entry.kind === "smart-object")!.smartSource);
    } finally { native.dispose(); }
  } finally { original.studio.dispose(); studio.dispose(); }
});

test("shared and nonidentity warped Photoshop sources stay protected", async () => {
  const original = await setup();
  const studio = new Studio(8, 8, testCanvas(8, 8));
  try {
    await studio.importPsd((await original.studio.exportPhotoshop()).buffer);
    const layer = studio.doc.layers.find(entry => entry.kind === "smart-object")!;
    studio.doc.layers.push(layer);
    assert.match(smartContentUnavailableReason(studio.doc, layer, "edit")!, /Shared/);
    studio.doc.layers.pop();
    const placed = getPhotoshopLayerMetadata(layer)!.source.placedLayer!;
    const originalWidth = placed.width; placed.width = 123;
    assert.match(smartContentUnavailableReason(studio.doc, layer, "edit")!, /geometry/);
    placed.width = originalWidth;
    placed.warp!.bounds!.right.value += 1;
    assert.match(smartContentUnavailableReason(studio.doc, layer, "edit")!, /custom-warp/);
    placed.warp!.bounds!.right.value -= 1;
    placed.warp!.customEnvelopeWarp!.meshPoints[1].x += 2;
    assert.match(smartContentUnavailableReason(studio.doc, layer, "edit")!, /warped/);
    await assert.rejects(studio.editSmartContents(layer.id), /warped/);
    assert.equal(studio.canApplySmartContents(), false);
  } finally { original.studio.dispose(); studio.dispose(); }
});
