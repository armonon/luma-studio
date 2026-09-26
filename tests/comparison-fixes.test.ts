import assert from "node:assert/strict";
import test from "node:test";
import { Studio } from "../app/engine/studio.ts";
import { testCanvas, solidCanvas, pixelAt } from "./canvas-harness.ts";
import { planAiGeometryCopy } from "../app/engine/ai-work-region.ts";
import { normalizeAiSize } from "../app/engine/ai-edit.ts";
import { decodeLumaProject } from "../app/engine/project.ts";
import { parseCubeLut } from "../app/engine/cube-lut.ts";
import JSZip from "jszip";

test("composite channels create alpha-weighted selection, support undo, and ignore preview mode", () => {
  const studio = new Studio(8, 8, testCanvas(8, 8));
  try {
    const layer = studio.addBlankRaster("Base");
    studio.fillLayer(layer.id, "#ff0000");
    studio.setLayerProp(layer.id, "opacity", .5);
    studio.setChannelView("blue");
    studio.selectCompositeChannel("red");
    const selected = studio.doc.selection!.surface!.readTile("0:0")[0];
    assert.ok(selected >= 127 && selected <= 128);
    studio.undo(); assert.equal(studio.doc.selection, null);
    studio.redo(); assert.equal(studio.doc.selection!.surface!.readTile("0:0")[0], selected);
    studio.selectCompositeChannel("blue"); assert.equal(studio.doc.selection!.surface!.readTile("0:0")[0], 0);
    studio.doc.width = 50_000; studio.doc.height = 50_000;
    const selection = studio.doc.selection, history = studio.historyLabels();
    assert.throws(() => studio.selectCompositeChannel("red"), /16 megapixels/);
    assert.equal(studio.doc.selection, selection); assert.deepEqual(studio.historyLabels(), history);
  } finally { studio.dispose(); }
});

test("AI copy planner enforces dimensions and valid provider request sizes before upload", () => {
  const enlarged = planAiGeometryCopy(1000, 800, { mode: "upscale", factor: 2 });
  assert.equal(enlarged.outputWidth, 2000); assert.equal(enlarged.work.width, 1000);
  const expanded = planAiGeometryCopy(1000, 800, { mode: "expand", factor: 1.5 });
  assert.equal(expanded.outputWidth, 1500); assert.equal(expanded.paddingX, 250); assert.equal(expanded.work.x, -250);
  for (const size of [[8, 8], [1000, 800], [1920, 1080], [1440, 1440]]) assert.doesNotThrow(() => normalizeAiSize(planAiGeometryCopy(size[0], size[1], { mode: "upscale", factor: 2 }).requestSize));
  for (const factor of [0, 1, NaN, Infinity, 5]) assert.throws(() => planAiGeometryCopy(100, 100, { mode: "expand", factor }));
  assert.throws(() => planAiGeometryCopy(50_000, 50_000, { mode: "upscale", factor: 2 }), /3840/);
});

/** NAPI's toBlob returns Buffer; adapt it to the real browser contract. */
function browserBlobs() {
  const create = document.createElement;
  document.createElement = ((tag: string) => {
    const canvas = create.call(document, tag) as HTMLCanvasElement;
    const encode = canvas.toBlob.bind(canvas);
    canvas.toBlob = (callback, type) => encode(bytes => callback(bytes instanceof Blob ? bytes : new Blob([bytes as unknown as BlobPart], { type: "image/png" })), type);
    return canvas;
  }) as typeof document.createElement;
  return () => { document.createElement = create; };
}

test("AI enlarged copies preserve source ownership, original expansion pixels, dirty state, undo and reopen", async () => {
  const restore = browserBlobs(), fetcher = globalThis.fetch;
  const studio = new Studio(8, 8, testCanvas(8, 8));
  try {
    const source = studio.addBlankRaster("Original"); studio.fillLayer(source.id, "red"); studio.markDocumentSaved();
    const originalId = studio.activeDocumentState().id, originalDoc = studio.doc;
    const blue = await new Promise<Blob>(resolve => solidCanvas(12, 12, "blue").toBlob(blob => resolve(blob!)));
    globalThis.fetch = async (_input, init) => {
      const form = init!.body as FormData;
      assert.ok(form.get("mask"));
      return new Response(blue, { headers: { "content-type": "image/png" } });
    };
    const result = await studio.generativeEditVariations(source.id, "Continue the background", "expand", { geometryCopy: { mode: "expand", factor: 1.5 }, variations: 1 });
    assert.notEqual(studio.activeDocumentState().id, originalId);
    assert.equal(studio.doc.width, 12); assert.equal(studio.doc.height, 12);
    assert.equal(studio.activeDocumentState().dirty, true);
    assert.equal(originalDoc.layers.length, 1); assert.equal(originalDoc.width, 8);
    assert.equal(pixelAt(result[0].bitmap!, 0, 0).b, 255);
    assert.equal(pixelAt(result[0].bitmap!, 4, 4).r, 255);
    const reopened = await decodeLumaProject((await studio.prepareProjectSave("expanded")).blob);
    assert.equal(reopened.doc.width, 12); assert.equal(reopened.doc.layers[0].ai?.parameters?.geometryCopy?.mode, "expand");
    studio.undo(); assert.equal(studio.doc.layers.length, 0);
    studio.redo(); assert.equal(studio.doc.layers.length, 1);
    studio.switchDocument(originalId); assert.equal(studio.activeDocumentState().dirty, false);
    globalThis.fetch = async () => new Response(blue, { headers: { "content-type": "image/png" } });
    await studio.generativeEditVariations(source.id, "Increase fine detail", "upscale", { geometryCopy: { mode: "upscale", factor: 2 } });
    assert.equal(studio.doc.width, 16); assert.equal(studio.doc.layers[0].bitmap!.width, 16);
  } finally { globalThis.fetch = fetcher; restore(); studio.dispose(); }
});

test("LUT, six-color mix and multi-stop gradient survive project save and reopen", async () => {
  const restore = browserBlobs(), studio = new Studio(8, 8, testCanvas(8, 8));
  try {
    const lut = parseCubeLut("LUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1");
    const layer = studio.addProAdjustmentLayer("color-lookup");
    studio.updateProAdjustment(layer.id, { kind: "color-lookup", preset: "film", intensity: .5, lut });
    const bw = studio.addProAdjustmentLayer("black-white");
    studio.updateProAdjustment(bw.id, { kind: "black-white", amount: 1, tint: "#ffffff", tintAmount: 0, colorMix: [10, 20, 30, 40, 50, 60] });
    const gradient = studio.addProAdjustmentLayer("gradient-map");
    studio.updateProAdjustment(gradient.id, { kind: "gradient-map", shadow: "#000000", highlight: "#ffffff", smoothness: 0, reverse: false,
      stops: [{ position: 0, color: "#000000" }, { position: .5, color: "#ff0000" }, { position: 1, color: "#ffffff" }] });
    const saved = await decodeLumaProject((await studio.prepareProjectSave("LUT")).blob);
    const p = saved.doc.layers.find(l => l.id === layer.id)!.proAdjustment;
    assert.equal(p?.kind === "color-lookup" && p.lut?.values.length, 24);
    assert.deepEqual(saved.doc.layers.find(l => l.id === bw.id)!.proAdjustment, bw.proAdjustment);
    assert.deepEqual(saved.doc.layers.find(l => l.id === gradient.id)!.proAdjustment, gradient.proAdjustment);
  } finally { restore(); studio.dispose(); }
});

test("lossy Photoshop export waits for consent and rejects consent for a changed document", async () => {
  const studio = new Studio(8, 8, testCanvas(8, 8));
  try {
    studio.addProAdjustmentLayer("color-lookup");
    let confirmations = 0;
    await assert.rejects(studio.exportPhotoshop({}, async report => {
      assert.ok(report.issues.some(issue => issue.code === "COLOR_LOOKUP_NOT_EXPORTED"));
      confirmations++;
      return false;
    }), /cancelled/);
    assert.equal(confirmations, 1);
    await assert.rejects(studio.exportPhotoshop({}, async () => {
      studio.resetDocument(10, 10, "Other");
      return true;
    }), /document changed/);
  } finally { studio.dispose(); }
});

test("large LUT history deduplicates losslessly, reopens, and remains independently undoable", async () => {
  const restore = browserBlobs(), studio = new Studio(8, 8, testCanvas(8, 8));
  const reopened = new Studio(8, 8, testCanvas(8, 8));
  try {
    const layer = studio.addProAdjustmentLayer("color-lookup");
    const values = Array.from({ length: 33 ** 3 * 3 }, (_, i) => Math.sin(i) * .5 + .5);
    for (let i = 1; i <= 20; i++) studio.updateProAdjustment(layer.id, {
      kind: "color-lookup", preset: "film", intensity: i / 20,
      lut: { title: "Large cube", size: 33, domainMin: [0, 0, 0], domainMax: [1, 1, 1], values },
    });
    const blob = (await studio.prepareProjectSave("Large LUT history")).blob;
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const manifest = await zip.file("manifest.json")!.async("string");
    assert.ok(manifest.length < 500_000, "history must not repeat the LUT numeric payload in JSON");
    assert.equal(Object.keys(zip.files).filter(p => p.startsWith("assets/precision/") && p.endsWith(".bin")).length, 1);
    await reopened.importProject(blob);
    let params = reopened.doc.layers[0].proAdjustment;
    assert.ok(params?.kind === "color-lookup");
    assert.deepEqual(params.lut!.values, values);
    assert.equal(params.intensity, 1);
    const currentValues = params.lut!.values;
    reopened.undo();
    params = reopened.doc.layers[0].proAdjustment;
    assert.ok(params?.kind === "color-lookup");
    assert.equal(params.intensity, .95);
    assert.notEqual(params.lut!.values, currentValues);
    assert.deepEqual(params.lut!.values, values);
    reopened.redo();
    assert.equal(reopened.doc.layers[0].proAdjustment?.kind === "color-lookup" && reopened.doc.layers[0].proAdjustment.intensity, 1);
    await assert.rejects(decodeLumaProject(blob, { maximumDecodedBytes: 1024 }), /decoded-memory ceiling/);
  } finally { restore(); studio.dispose(); reopened.dispose(); }
});

test("LUT projects reject corrupt binary samples and still open legacy inline values", async () => {
  const studio = new Studio(8, 8, testCanvas(8, 8));
  try {
    const lut = parseCubeLut("LUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1");
    const layer = studio.addProAdjustmentLayer("color-lookup");
    studio.updateProAdjustment(layer.id, { kind: "color-lookup", preset: "film", intensity: 1, lut });
    const blob = (await studio.prepareProjectSave("Corruption fixture")).blob;
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
    const asset = manifest.document.layers[0].proAdjustmentLutAsset;
    const bytes = await zip.file(asset)!.async("uint8array");
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setFloat64(0, NaN, true);
    zip.file(asset, bytes);
    await assert.rejects(decodeLumaProject(await zip.generateAsync({ type: "uint8array" })), /Invalid 3D LUT/);
    zip.file(asset, new Uint8Array(1));
    await assert.rejects(decodeLumaProject(await zip.generateAsync({ type: "uint8array" })), /invalid project LUT samples/);
    manifest.version = 10;
    manifest.history = undefined;
    delete manifest.document.layers[0].proAdjustmentLutAsset;
    manifest.document.layers[0].proAdjustment.lut = lut;
    zip.remove(asset);
    zip.file("manifest.json", JSON.stringify(manifest));
    const legacy = await decodeLumaProject(await zip.generateAsync({ type: "uint8array" }));
    assert.deepEqual(legacy.doc.layers[0].proAdjustment, layer.proAdjustment);
  } finally { studio.dispose(); }
});
