import assert from "node:assert/strict";
import test from "node:test";
import "./canvas-harness.ts";
import { createDocument, createRasterLayer } from "../app/engine/document.ts";
import { PrecisionTileSurface } from "../app/engine/tile-store.ts";
import { SparseAlphaSurface } from "../app/engine/alpha-surface.ts";
import { exportPhotoshopDocument, importPsd, photoshopCompatibilityReport } from "../app/engine/psd.ts";
import { readPsd } from "../app/engine/ag-psd-io.ts";
import { readPhotoshopAlphaChannels, writePhotoshopAlphaChannels } from "../app/engine/psd-alpha-channels.ts";

function fixture(depth: 8 | 16 | 32) {
  const doc = createDocument(3, 2); doc.bitDepth = depth;
  const base = createRasterLayer("Base");
  base.surface = new PrecisionTileSurface(3, 2, depth === 8 ? "rgba8" : "rgba32f", "srgb");
  const pixels = new Float32Array(24); for (let i = 0; i < 6; i++) pixels.set([.2,.3,.4,1], i * 4);
  base.surface.updateFromWorkingFloat32({ width: 3, height: 2, data: pixels });
  doc.layers = [base];
  const a = new SparseAlphaSurface(3, 2), b = new SparseAlphaSurface(3, 2, { defaultAlpha: 255 });
  a.writeTile("0:0", new Uint8Array([0,32,64,128,192,255]));
  doc.alphaChannels = [{ id: "one", name: "Subject α", surface: a }, { id: "two", name: "All", surface: b }];
  return doc;
}

for (const depth of [8,16,32] as const) for (const format of ["psd","psb"] as const) test(`${depth}-bit ${format}: named alpha survives two exports, edits and source passthrough`, async () => {
  const doc = fixture(depth), result = exportPhotoshopDocument(doc, { format });
  const names = readPsd(result.buffer.slice(0), { skipCompositeImageData: true, skipLayerImageData: true }).imageResources!.alphaChannelNames!;
  assert.deepEqual(names, ["Subject α", "All"]);
  const channels = readPhotoshopAlphaChannels(result.buffer, names);
  assert.equal(channels[0].surface.sample(1, 0), 32); assert.equal(channels[0].surface.sample(2, 1), 255);
  assert.equal(channels[1].surface.sample(0, 0), 255);
  const composite = readPsd(result.buffer.slice(0), { useImageData: true, skipLayerImageData: true });
  const max = depth === 32 ? 1 : depth === 16 ? 65535 : 255;
  assert.equal(composite.imageData!.data[3], max, "saved channel is not composite transparency");
  const reopened = await importPsd(result.buffer.slice(0));
  assert.equal(reopened.alphaChannels?.length, 2);
  assert.equal(reopened.alphaChannels?.[0].surface.sample(1, 1), 192);
  assert.ok(photoshopCompatibilityReport(reopened, { format: "source" }).issues.some(issue => issue.code === "ORIGINAL_SOURCE_PASSTHROUGH"));
  reopened.alphaChannels![0].surface = reopened.alphaChannels![0].surface.inverted();
  const second = await importPsd(exportPhotoshopDocument(reopened, { format }).buffer);
  assert.equal(second.alphaChannels?.[0].surface.sample(1, 1), 63);
  second.alphaChannels = [];
  const removed = await importPsd(exportPhotoshopDocument(second, { format }).buffer);
  assert.equal(removed.alphaChannels?.length ?? 0, 0);
});

test("alpha bounds, malformed payload and name/geometry errors fail before unsafe allocation", () => {
  const doc = fixture(8), result = exportPhotoshopDocument(doc);
  assert.throws(() => readPhotoshopAlphaChannels(result.buffer.slice(0, -2), ["Subject α", "All"]), /Truncated/);
  doc.alphaChannels![0].surface = new SparseAlphaSurface(1, 1);
  assert.throws(() => writePhotoshopAlphaChannels(result.buffer, doc), /geometry/);
  doc.width = 50_000; doc.height = 50_000;
  assert.equal(photoshopCompatibilityReport(doc).canExport, false);
  assert.throws(() => exportPhotoshopDocument(doc), /alpha export/);
});
