import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { inspectProjectEntry, generateBoundedProjectZip, readProjectEntryBytes } from "../app/engine/project-zip-stream";
import { assertProjectDecodeAdmission } from "../app/engine/project";
import { encodeLumaProject, decodeLumaProject } from "../app/engine/project";
import { Studio } from "../app/engine/studio";
import { getPhotoshopDocumentMetadata, setPhotoshopDocumentMetadata, inspectPhotoshopHeader } from "../app/engine/psd-metadata";
import { photoshopCompatibilityReport } from "../app/engine/psd";
import { testCanvas } from "./canvas-harness";

test("ZIP admission streams a large asset but retains only its header", async () => {
  const bytes = new Uint8Array(2 * 1024 * 1024).fill(23);
  const zip = new JSZip(); zip.file("assets/source.bin", bytes);
  const loaded = await JSZip.loadAsync(await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }));
  const entry = loaded.file("assets/source.bin")!;
  entry.async = (() => { throw new Error("Whole-entry accumulation forbidden"); }) as typeof entry.async;
  const result = await inspectProjectEntry(entry, bytes.length, bytes.length);
  assert.equal(result.size, bytes.length);
  assert.equal(result.prefix.byteLength, 32);
  assert.deepEqual([...result.prefix], Array(32).fill(23));
  assert.equal(await assertProjectDecodeAdmission(loaded, { source: "assets/source.bin" }), bytes.length * 4);
});
test("ZIP entry ceilings reject oversize and forged size metadata", async () => {
  const zip = new JSZip(); zip.file("assets/a.bin", new Uint8Array(200_000));
  const entry = zip.file("assets/a.bin")!;
  await assert.rejects(inspectProjectEntry(entry, 100), /admitted size/);
  await assert.rejects(inspectProjectEntry(entry, 300_000, 199_999), /admitted size/);
  await assert.rejects(inspectProjectEntry(entry, 300_000, 200_001), /size mismatch/);
});

test("canvas admission retains every backing store but reserves one serial PNG scratch image", async () => {
  const canvas = testCanvas(100, 100);
  const zip = new JSZip();
  zip.file("assets/a.png", canvas.toDataURL("image/png").split(",")[1], { base64: true });
  const loaded = await JSZip.loadAsync(await zip.generateAsync({ type: "uint8array" }));
  const size = (await loaded.file("assets/a.png")!.async("uint8array")).length;
  const cost = await assertProjectDecodeAdmission(loaded, [{ bitmapAsset: "assets/a.png" }, { bitmapAsset: "assets/a.png" }]);
  assert.equal(cost, 3 * 100 * 100 * 4 + size * 3);
  await assert.rejects(assertProjectDecodeAdmission(loaded, [{ bitmapAsset: "assets/a.png" }, { bitmapAsset: "assets/a.png" }], cost - 1), /memory ceiling/);
  // A fake PNG signature in an opaque source is not a canvas and cannot evade
  // accounting for the retained source bytes on every reference.
  const opaque = await assertProjectDecodeAdmission(loaded, [{ asset: "assets/a.png" }, { asset: "assets/a.png" }]);
  assert.equal(opaque, cost + size * 8);
});

test("single-allocation source reads are exact and reject size mismatches", async () => {
  const zip = new JSZip(); zip.file("source.bin", Uint8Array.from({ length: 100_000 }, (_, i) => i % 251));
  const loaded = await JSZip.loadAsync(await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }));
  const entry = loaded.file("source.bin")!;
  const result = await readProjectEntryBytes(entry, 100_000, 100_000);
  assert.equal(result.byteOffset, 0); assert.equal(result.buffer.byteLength, 100_000);
  assert.equal(result[99_999], 99_999 % 251);
  await assert.rejects(readProjectEntryBytes(entry, 99_999, 100_000), /admitted size/);
  await assert.rejects(readProjectEntryBytes(entry, 100_001, 100_001), /size mismatch/);
  await assert.rejects(readProjectEntryBytes(entry, 100_000, 99_999), /allocation/);
});
test("bounded archive output round-trips and refuses output before publication", async () => {
  const zip = new JSZip(); zip.file("manifest.json", "fixture");
  zip.file("assets/a.bin", new Uint8Array(1000).fill(29));
  const blob = await generateBoundedProjectZip(zip, 4096, 1);
  const reopened = await JSZip.loadAsync(await blob.arrayBuffer());
  assert.equal(await reopened.file("manifest.json")!.async("string"), "fixture");
  assert.equal((await reopened.file("assets/a.bin")!.async("uint8array")).length, 1000);
  await assert.rejects(generateBoundedProjectZip(zip, 40, 1), /archive limit/);
});

test("failed Photoshop descriptor restore retains original source across repeated saves and blocks misleading export", async () => {
  const studio = new Studio(16, 16, testCanvas(1, 1));
  try {
    studio.addBlankRaster("Editable artwork");
    // Valid fixed header, deliberately missing the remaining PSD sections.
    const bytes = new Uint8Array(26);
    bytes.set([56, 66, 80, 83]);
    const view = new DataView(bytes.buffer);
    view.setUint16(4, 1); view.setUint16(12, 3);
    view.setUint32(14, 16); view.setUint32(18, 16);
    view.setUint16(22, 8); view.setUint16(24, 3);
    setPhotoshopDocumentMetadata(studio.doc, { header: inspectPhotoshopHeader(bytes.buffer), originalSource: bytes, rawImageResources: [], importedIssues: [] });
    let doc = studio.doc;
    for (let i = 0; i < 2; i++) {
      doc = (await decodeLumaProject(await encodeLumaProject(doc, [], "Preservation failure"))).doc;
      assert.equal(doc.layers.length, 1);
      assert.deepEqual(getPhotoshopDocumentMetadata(doc)?.originalSource, bytes);
      const report = photoshopCompatibilityReport(doc);
      assert.equal(report.canExport, false);
      assert.ok(report.issues.some(issue => issue.code === "PRESERVATION_RESTORE_FAILED"));
    }
  } finally { studio.dispose(); }
});
