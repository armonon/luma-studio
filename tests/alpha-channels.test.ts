import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { Studio } from "../app/engine/studio.ts";
import { SparseAlphaSurface } from "../app/engine/alpha-surface.ts";
import { testCanvas } from "./canvas-harness.ts";
import { decodeLumaProject } from "../app/engine/project.ts";
import { photoshopCompatibilityReport, exportPhotoshopDocument, importPsd } from "../app/engine/psd.ts";

test("sparse channel calculations match per-pixel math without visiting extreme empty dimensions", () => {
  const a = new SparseAlphaSurface(300_000, 300_000, { defaultAlpha: 128 });
  const b = new SparseAlphaSurface(300_000, 300_000, { defaultAlpha: 64 });
  a.writeUniform("0:0", 255);
  assert.equal(a.calculated(b, "multiply").sample(290_000, 290_000), 32);
  assert.equal(a.calculated(b, "multiply").sample(0, 0), 64);
  assert.equal(a.calculated(b, "difference", .5).sample(0, 0), 223);
  assert.equal(a.calculated(b, "screen").stats().residentTiles, 1);
  assert.equal(a.calculated(b, "add").sample(0, 0), 255);
  assert.equal(a.calculated(b, "subtract").sample(0, 0), 191);
  assert.throws(() => a.calculated(b, "multiply", NaN), /Invalid/);
});

test("saved alpha is independent, undoable, crop/resize aware and restored with project history", async () => {
  const studio = new Studio(8, 8, testCanvas(8, 8));
  const reopened = new Studio(8, 8, testCanvas(8, 8));
  try {
    studio.selectRect(2, 2, 4, 4);
    const id = studio.editAlphaChannel("save", { name: "Subject" });
    assert.equal(studio.doc.alphaChannels?.[0].surface.sample(3, 3), 255);
    studio.deselect(); studio.loadAlphaChannel(id);
    studio.invertSelectionArea();
    assert.equal(studio.doc.alphaChannels?.[0].surface.sample(3, 3), 255);
    studio.editAlphaChannel("update", { id });
    assert.equal(studio.doc.alphaChannels?.[0].surface.sample(3, 3), 0);
    studio.undo(); assert.equal(studio.doc.alphaChannels?.[0].surface.sample(3, 3), 255);
    studio.redo(); assert.equal(studio.doc.alphaChannels?.[0].surface.sample(3, 3), 0);
    studio.editAlphaChannel("rename", { id, name: "Outside" });
    const result = studio.editAlphaChannel("calculate", { id, otherId: id, mode: "difference" });
    assert.equal(studio.doc.alphaChannels?.find(c => c.id === result)?.surface.sample(0, 0), 0);
    studio.cropRect(1, 1, 6, 6);
    assert.equal(studio.doc.alphaChannels?.[0].surface.width, 6);
    studio.resizeDocument(12, 12);
    assert.equal(studio.doc.alphaChannels?.[0].surface.width, 12);
    const blob = (await studio.prepareProjectSave("Channels")).blob;
    await reopened.importProject(blob);
    assert.equal(reopened.doc.alphaChannels?.[0].name, "Outside");
    reopened.undo(); assert.equal(reopened.doc.alphaChannels?.[0].surface.width, 6);
    reopened.redo(); assert.equal(reopened.doc.alphaChannels?.[0].surface.width, 12);
    assert.ok(photoshopCompatibilityReport(studio.doc).issues.some(i => i.code === "SAVED_ALPHA_CHANNELS_EXPORTED"));
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
    manifest.document.alphaChannels[1].id = manifest.document.alphaChannels[0].id;
    zip.file("manifest.json", JSON.stringify(manifest));
    await assert.rejects(decodeLumaProject(await zip.generateAsync({ type: "uint8array" })), /identity/);
  } finally { studio.dispose(); reopened.dispose(); }
});

test("channel failure preserves original owners/history and document switches cannot target another channel", () => {
  const studio = new Studio(50_000, 50_000, testCanvas(8, 8));
  try {
    studio.selectAll(); const id = studio.editAlphaChannel("save");
    assert.equal(studio.doc.alphaChannels![0].surface.stats().residentBytes, 0);
    const original = studio.doc.alphaChannels, history = studio.historyLabels();
    const engine = studio as unknown as { commit: () => void }, commit = engine.commit;
    engine.commit = () => { throw new Error("Injected commit failure"); };
    try { assert.throws(() => studio.editAlphaChannel("invert", { id }), /Injected/); }
    finally { engine.commit = commit; }
    assert.equal(studio.doc.alphaChannels, original);
    assert.deepEqual(studio.historyLabels(), history);
    studio.resetDocument(4, 4, "Other");
    assert.throws(() => studio.loadAlphaChannel(id), /Select/);
    assert.equal(studio.doc.alphaChannels, undefined);
  } finally { studio.dispose(); }
});

test("saved channel changes invalidate original Photoshop source passthrough", async () => {
  const studio = new Studio(8, 8, testCanvas(8, 8));
  try {
    studio.addBlankRaster("Source");
    const doc = await importPsd(exportPhotoshopDocument(studio.doc).buffer);
    assert.ok(photoshopCompatibilityReport(doc, { format: "source" }).issues.some(issue => issue.code === "ORIGINAL_SOURCE_PASSTHROUGH"));
    doc.alphaChannels = [{ id: "new", name: "New alpha", surface: new SparseAlphaSurface(8, 8) }];
    assert.equal(photoshopCompatibilityReport(doc, { format: "source" }).issues.some(issue => issue.code === "ORIGINAL_SOURCE_PASSTHROUGH"), false);
  } finally { studio.dispose(); }
});
