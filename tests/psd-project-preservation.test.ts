import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { testCanvas } from "./canvas-harness";
import { writePsd, readPsd } from "../app/engine/ag-psd-io";
import { importPsd, exportPhotoshopDocument } from "../app/engine/psd";
import { decodeLumaProject, encodeLumaProject, assertProjectDecodeAdmission } from "../app/engine/project";
import { captureProjectPhotoshopPreservation, restoreProjectPhotoshopPreservation } from "../app/engine/psd-project-preservation";
import { getPhotoshopLayerMetadata } from "../app/engine/psd-metadata";

function fixture(disabledMask = false) {
  return writePsd({ width: 16, height: 16, canvas: testCanvas(16, 16), children: [{
    name: "Group", opened: true, children: [{
      name: "Pixels", canvas: testCanvas(16, 16),
      mask: { canvas: testCanvas(8, 8), top: 2, left: 3, disabled: disabledMask, userMaskDensity: .75 },
    }],
  }] }, { noBackground: true });
}

test("v9 source fingerprints, group mapping and masks survive save/reopen without duplicate descriptor pixels", async () => {
  const original = fixture(); const doc = await importPsd(original);
  for (const layer of doc.layers) {
    const source = getPhotoshopLayerMetadata(layer)?.source;
    assert.equal(source?.canvas, undefined); assert.equal(source?.imageData, undefined); assert.equal(source?.children, undefined);
  }
  const archive = await encodeLumaProject(doc, [], "Layered");
  const reopened = (await decodeLumaProject(archive)).doc;
  assert.equal(reopened.layers.length, doc.layers.length);
  assert.deepEqual(new Uint8Array(exportPhotoshopDocument(reopened, { format: "source" }).buffer), new Uint8Array(original));
  reopened.layers[0].opacity = .5;
  const edited = exportPhotoshopDocument(reopened);
  assert.ok(!edited.report.issues.some(issue => issue.code === "ORIGINAL_SOURCE_PASSTHROUGH"));
  const read = readPsd(edited.buffer, { useImageData: true });
  assert.equal(read.children?.[0].children?.[0].mask?.userMaskDensity, Math.round(.75 * 255) / 255);
  assert.ok(read.children?.[0].children?.[0].mask?.imageData);
});

test("metadata restoration allocates no image canvas and never mutates the source bytes", async () => {
  const bytes = new Uint8Array(fixture());
  const doc = await importPsd(bytes.buffer);
  const saved = captureProjectPhotoshopPreservation(doc)!;
  const previous = document.createElement;
  const copy = bytes.slice();
  document.createElement = (() => { throw new Error("Unexpected image canvas allocation"); }) as typeof document.createElement;
  try { restoreProjectPhotoshopPreservation(doc, bytes, "layered", saved); }
  finally { document.createElement = previous; }
  assert.deepEqual(bytes, copy);
});

test("disabled masks retain the legacy restoration path and mask pixels", async () => {
  const doc = await importPsd(fixture(true));
  assert.equal(captureProjectPhotoshopPreservation(doc), undefined);
  const reopened = (await decodeLumaProject(await encodeLumaProject(doc, [], "Disabled mask"))).doc;
  const result = readPsd(exportPhotoshopDocument(reopened).buffer, { useImageData: true });
  const mask = result.children?.[0].children?.[0].mask;
  assert.equal(mask?.disabled, true); assert.ok(mask?.imageData);
});

test("legacy v8 archives remain readable without the new preservation record", async () => {
  const doc = await importPsd(fixture());
  const zip = await JSZip.loadAsync(await (await encodeLumaProject(doc, [], "Legacy")).arrayBuffer());
  const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
  manifest.version = 8; delete manifest.document.photoshopPreservation;
  zip.file("manifest.json", JSON.stringify(manifest));
  const reopened = await decodeLumaProject(await zip.generateAsync({ type: "uint8array" }));
  assert.equal(reopened.doc.layers.length, doc.layers.length);
  assert.ok(getPhotoshopLayerMetadata(reopened.doc.layers[0]));
});

test("streamed-source admission applies only to the metadata-only reference, not unrelated mutable references", async () => {
  const zip = new JSZip(); zip.file("assets/photoshop/source.bin", new Uint8Array(1024));
  const loaded = await JSZip.loadAsync(await zip.generateAsync({ type: "uint8array" }));
  const base = { photoshopSourceAsset: "assets/photoshop/source.bin", photoshopImportMode: "flattened", photoshopPreservation: { version: 1 } };
  const cost = await assertProjectDecodeAdmission(loaded, base);
  assert.equal(cost, 4 * 1024 * 1024 + 1024);
  assert.equal(await assertProjectDecodeAdmission(loaded, { ...base, another: "assets/photoshop/source.bin" }), cost + 4096);
  assert.equal(await assertProjectDecodeAdmission(loaded, { source: "assets/photoshop/source.bin" }), 4096);
});
