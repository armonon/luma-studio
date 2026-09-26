import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { Studio } from "../app/engine/studio.ts";
import { ResidentMemoryBudget } from "../app/engine/resident-memory.ts";
import { SparseTileStore, TileGrid } from "../app/engine/tile-store.ts";
import { assertProjectDecodeAdmission } from "../app/engine/project.ts";
import { exportTiledPng } from "../app/engine/png-stream.ts";
import { pixelAt, testCanvas } from "./canvas-harness.ts";
import { drawLayerContent } from "../app/engine/document.ts";
import { renderViewport } from "../app/engine/renderer.ts";
import { evidenceMatchesSource } from "../build/release-source-id.mjs";

test("inactive document pixels stay charged and remain editable after tab switching", () => {
  const studio = new Studio(16, 16, testCanvas(1, 1));
  const a = studio.addBlankRaster("A");
  studio.fillLayer(a.id, "#ff0000");
  const aId = studio.activeDocumentState().id;
  studio.resetDocument(16, 16, "B");
  const b = studio.addBlankRaster("B");
  studio.fillLayer(b.id, "#00ff00");
  const budget = (studio as unknown as { residentMemoryBudget: ResidentMemoryBudget }).residentMemoryBudget;
  assert.equal(budget.stats().residentBytes, a.surface!.store.stats().residentBytes + b.surface!.store.stats().residentBytes);
  studio.switchDocument(aId);
  assert.doesNotThrow(() => studio.fillLayer(a.id, "#0000ff"));
  assert.equal(pixelAt(a.bitmap!, 0, 0).b, 255);
  studio.undo();
  assert.equal(pixelAt(a.bitmap!, 0, 0).r, 255);
  studio.dispose();
});

test("reconciled accounts can rebind without an obsolete handle releasing the new account", () => {
  const budget = new ResidentMemoryBudget(4096);
  const surface = new SparseTileStore(new TileGrid(16, 16));
  surface.bindMemoryBudget(budget);
  surface.write("0:0", new Uint8Array(1024));
  budget.retainOnly(new Set());
  surface.bindMemoryBudget(budget);
  assert.doesNotThrow(() => surface.write("0:0", new Uint8Array(1024)));
  assert.equal(budget.stats().residentBytes, 1024);
});

test("export cannot substitute a newly selected document after async compositing", async () => {
  const studio = new Studio(8, 8, testCanvas(1, 1));
  studio.fillLayer(studio.addBlankRaster("A").id, "red");
  const a = studio.activeDocumentState().id;
  studio.resetDocument(8, 8, "B");
  studio.fillLayer(studio.addBlankRaster("B").id, "blue");
  const b = studio.activeDocumentState().id;
  studio.switchDocument(a);
  studio.flattenNative = async () => { studio.switchDocument(b); return null; };
  await assert.rejects(studio.exportPNG(), /document changed/);
  studio.dispose();
});

test("recovery refuses edits or close during its first async boundary", async () => {
  const studio = new Studio(8, 8, testCanvas(1, 1));
  const layer = studio.addBlankRaster("A");
  const pending = studio.exportRecoveryDocument();
  studio.fillLayer(layer.id, "red");
  await assert.rejects(pending, /document changed/);
  const closing = studio.exportRecoveryDocument();
  studio.closeDocument(studio.activeDocumentState().id);
  await assert.rejects(closing, /document changed/);
  studio.dispose();
});

test("project admission counts repeated bitmap references before allocating canvases", async () => {
  const zip = new JSZip();
  const canvas = testCanvas(256, 256);
  const data = canvas.toDataURL("image/png").split(",")[1];
  zip.file("assets/repeated.png", data, { base64: true });
  const loaded = await JSZip.loadAsync(await zip.generateAsync({ type: "uint8array" }));
  await assertProjectDecodeAdmission(loaded, { bitmap: "assets/repeated.png" }, 1024 * 1024);
  await assert.rejects(assertProjectDecodeAdmission(loaded, Array(32).fill({ bitmap: "assets/repeated.png" }), 1024 * 1024), /aggregate decoded-memory/);
});

test("streamed exports stop on revision invalidation and compressed-output admission", async () => {
  const studio = new Studio(8, 8, testCanvas(1, 1));
  studio.addBlankRaster("A");
  let checks = 0;
  await assert.rejects(exportTiledPng(studio.doc, { assertCurrent: () => { if (++checks > 1) throw new Error("changed revision"); } }), /changed revision/);
  await assert.rejects(exportTiledPng(studio.doc, { maximumCompressedBytes: 1 }), /compressed-output/);
  studio.dispose();
});

test("a precision sync failure restores canvas, surface and undo position", () => {
  const studio = new Studio(16, 16, testCanvas(1, 1));
  const layer = studio.addBlankRaster("transaction");
  studio.fillLayer(layer.id, "red");
  const node = studio.historyState().currentId;
  const pixels = layer.surface!.store.read("0:0");
  const internal = studio as unknown as { syncLayerSurface: (target: typeof layer) => void };
  const original = internal.syncLayerSurface.bind(studio);
  internal.syncLayerSurface = target => { original(target); throw new Error("Injected precision failure"); };
  assert.throws(() => studio.fillLayer(layer.id, "blue"), /Injected precision/);
  assert.equal(pixelAt(layer.bitmap!, 0, 0).r, 255);
  assert.deepEqual(layer.surface!.store.read("0:0"), pixels);
  assert.equal(studio.historyState().currentId, node);
  studio.dispose();
});

test("uniform decorated complex-script text stays a single shaped run", () => {
  const studio = new Studio(160, 80, testCanvas(1, 1));
  const layer = studio.addTextLayer("سلام", { x: 10, y: 50, font: "30px sans-serif", direction: "rtl", defaultStyle: { decoration: "underline" } });
  const canvas = testCanvas(160, 80);
  const ctx = canvas.getContext("2d")!;
  const calls: string[] = [];
  const fill = ctx.fillText.bind(ctx);
  ctx.fillText = (text, x, y) => { calls.push(text); fill(text, x, y); };
  drawLayerContent(ctx, layer);
  assert.deepEqual(calls, ["سلام"]);
  studio.dispose();
});

test("partial rendering cannot retain the previous document outside a dirty region", () => {
  const studio = new Studio(512, 256, testCanvas(1, 1));
  studio.fillLayer(studio.addBlankRaster("A").id, "red");
  const a = studio.doc;
  studio.resetDocument(512, 256, "B");
  studio.fillLayer(studio.addBlankRaster("B").id, "blue");
  const target = testCanvas(512, 256);
  const viewport = { x: 0, y: 0, width: 512, height: 256, outputWidth: 512, outputHeight: 256, zoom: 1, cssScale: 1, devicePixelRatio: 1 };
  renderViewport(a, target, viewport);
  renderViewport(studio.doc, target, viewport, { dirtyRegions: [{ x: 0, y: 0, width: 1, height: 1 }] });
  assert.equal(pixelAt(target, 500, 128).b, 255);
  studio.attachDisplayTarget(target);
  assert.equal(studio.target, target);
  studio.dispose();
});

test("recovery rejects a bitmap/precision hybrid if an edit occurs during PNG encoding", async () => {
  const studio = new Studio(8, 8, testCanvas(1, 1));
  const layer = studio.addBlankRaster("A");
  studio.fillLayer(layer.id, "red");
  const encode = layer.bitmap!.toBlob.bind(layer.bitmap!);
  let edited = false;
  layer.bitmap!.toBlob = (callback, type) => encode(blob => {
    if (!edited) { edited = true; studio.fillLayer(layer.id, "blue"); }
    callback(blob);
  }, type);
  await assert.rejects(studio.exportRecoveryDocument(), /document changed/);
  assert.equal(edited, true);
  assert.equal(pixelAt(layer.bitmap!, 0, 0).b, 255);
  studio.dispose();
});

test("an AI response for a previous tab cannot insert layers into the active tab", async () => {
  const studio = new Studio(8, 8, testCanvas(1, 1));
  const layer = studio.addBlankRaster("A");
  const first = studio.activeDocumentState().id;
  const firstDoc = studio.doc;
  studio.resetDocument(8, 8, "B");
  studio.addBlankRaster("B");
  const second = studio.activeDocumentState().id;
  studio.switchDocument(first);
  const create = document.createElement;
  const fetcher = globalThis.fetch;
  // NAPI's encoder returns Buffer; adapt only this test to the browser contract.
  document.createElement = ((tag: string) => {
    const canvas = create.call(document, tag) as HTMLCanvasElement;
    const encode = canvas.toBlob.bind(canvas);
    canvas.toBlob = (callback, type) => encode(bytes => callback(bytes instanceof Blob ? bytes : new Blob([bytes as unknown as BlobPart], { type: "image/png" })), type);
    return canvas;
  }) as typeof document.createElement;
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    studio.switchDocument(second);
    return new Response(new Uint8Array([1]), { headers: { "content-type": "image/png" } });
  };
  try {
    await assert.rejects(studio.generativeEditVariations(layer.id, "test fill"), /document changed/);
    assert.equal(requests, 1);
    assert.equal(firstDoc.layers.length, 1);
    assert.equal(studio.doc.layers.length, 1);
  } finally { document.createElement = create; globalThis.fetch = fetcher; studio.dispose(); }
});

test("qualification evidence must identify the exact source, not just claim success", () => {
  const source = "a".repeat(64);
  assert.equal(evidenceMatchesSource({ status: "pass" }, source), false);
  assert.equal(evidenceMatchesSource({ sourceSha256: "b".repeat(64) }, source), false);
  assert.equal(evidenceMatchesSource({ sourceSha256: source }, source), true);
});
