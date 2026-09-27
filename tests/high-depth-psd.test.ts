import assert from "node:assert/strict";
import test from "node:test";
import "./canvas-harness.ts";
import { createDocument, createRasterLayer } from "../app/engine/document.ts";
import { PrecisionTileSurface } from "../app/engine/tile-store.ts";
import { exportPhotoshopDocument, importPsd } from "../app/engine/psd.ts";
import { readPsd } from "../app/engine/ag-psd-io.ts";
import { inspectPhotoshopHeader } from "../app/engine/psd-metadata.ts";
import { highDepthEligibility } from "../app/engine/high-depth-psd.ts";
import { SparseAlphaSurface } from "../app/engine/alpha-surface.ts";

function fixture(depth: 16 | 32) {
  const doc = createDocument(2, 1); doc.bitDepth = depth;
  const base = createRasterLayer("Base"), top = createRasterLayer("Top");
  for (const layer of [base, top]) layer.surface = new PrecisionTileSurface(2, 1, "rgba32f", "srgb");
  base.surface!.updateFromWorkingFloat32({ width: 2, height: 1, data: new Float32Array([.12345, .2, .3, 1, depth === 32 ? 3.125 : .9, .1, .2, 1]) });
  top.surface!.updateFromWorkingFloat32({ width: 2, height: 1, data: new Float32Array([.7, .4, .2, .5, .1, .3, .9, 0]) });
  top.opacity = .5; doc.layers = [top, base];
  return doc;
}

for (const depth of [16, 32] as const) for (const format of ["psd", "psb"] as const) {
  test(`layered ${depth}-bit ${format} preserves native samples, alpha, opacity, tags and merged pixels`, async () => {
    const doc = fixture(depth);
    const result = exportPhotoshopDocument(doc, { format });
    assert.equal(inspectPhotoshopHeader(result.buffer).bitsPerChannel, depth);
    assert.ok(result.report.issues.some(issue => issue.code === `OUTPUT_${depth}_BIT_NATIVE`));
    assert.ok(new TextDecoder().decode(result.buffer).includes(`8BIMLr${depth}`));
    const decoded = readPsd(result.buffer.slice(0), { useImageData: true });
    assert.deepEqual(decoded.children!.map(layer => layer.name), ["Base", "Top"]);
    const base = decoded.children![0].imageData!.data, top = decoded.children![1].imageData!.data, merged = decoded.imageData!.data;
    assert.ok(depth === 32 ? base instanceof Float32Array : base instanceof Uint16Array);
    const max = depth === 16 ? 65535 : 1;
    assert.ok(Math.abs(top[3] / max - .5) < .0001);
    assert.equal(top[7], 0);
    assert.ok(Math.abs(decoded.children![1].opacity! - 128 / 255) < .00001);
    const alpha = top[3] / max * 128 / 255;
    assert.ok(Math.abs(merged[0] - (top[0] * alpha + base[0] * (1 - alpha))) < (depth === 16 ? 2 : 1e-6));
    assert.equal(merged[4], base[4]);
    if (depth === 32) assert.equal(base[4], 3.125);
    else assert.notEqual(base[0] % 257, 0);
    const reopened = await importPsd(result.buffer.slice(0));
    assert.equal(reopened.bitDepth, depth);
    assert.equal(reopened.layers.length, 2);
    const second = exportPhotoshopDocument(reopened, { format });
    assert.equal(inspectPhotoshopHeader(second.buffer).bitsPerChannel, depth, JSON.stringify({ gate: highDepthEligibility(reopened), layers: reopened.layers.map(({ surface, bitmap, ...layer }) => ({ ...layer, format: surface?.format, source: !!surface?.store.sourceState(), bitmap: !!bitmap })) }));
  });
}

test("native high-depth refuses unsupported appearance and excessive allocations before encoding", () => {
  const doc = fixture(32);
  doc.layers[0].transform.rotation = 20;
  assert.equal(highDepthEligibility(doc).eligible, false);
  doc.layers[0].transform.rotation = 0;
  doc.width = 50_000; doc.height = 50_000;
  assert.equal(highDepthEligibility(doc).eligible, false);
});

for (const depth of [16, 32] as const) for (const format of ["psd", "psb"] as const) {
  test(`${depth}-bit ${format} masks remain separate, editable and included in the merged preview`, async () => {
    const doc = fixture(depth);
    const mask = new SparseAlphaSurface(2, 1, { defaultAlpha: 255 });
    mask.writeTile("0:0", new Uint8Array([64, 0]));
    doc.layers[0].maskSurface = mask;
    const result = exportPhotoshopDocument(doc, { format });
    assert.equal(inspectPhotoshopHeader(result.buffer).bitsPerChannel, depth);
    const decoded = readPsd(result.buffer.slice(0), { useImageData: true });
    const top = decoded.children![1], max = depth === 16 ? 65535 : 1;
    assert.ok(top.mask?.imageData);
    assert.ok(Math.abs(top.mask.imageData.data[0] / max - 64 / 255) < .0001);
    assert.ok(Math.abs(top.imageData!.data[3] / max - .5) < .0001, "mask must not bake into layer alpha");
    const alpha = top.imageData!.data[3] / max * 128 / 255 * 64 / 255;
    const base = decoded.children![0].imageData!.data[0];
    assert.ok(Math.abs(decoded.imageData!.data[0] - (top.imageData!.data[0] * alpha + base * (1 - alpha))) < (depth === 16 ? 2 : 1e-6));
    const reopened = await importPsd(result.buffer.slice(0));
    assert.equal(reopened.layers[0].maskSurface?.sample(0, 0), 64);
    assert.equal(reopened.layers[0].maskSurface?.sample(1, 0), 0);
    assert.equal(highDepthEligibility(reopened).eligible, true);
    const second = exportPhotoshopDocument(reopened, { format });
    assert.equal(inspectPhotoshopHeader(second.buffer).bitsPerChannel, depth);
  });
}

test("16-bit export refuses samples it could only record by silently clipping them", () => {
  // The working space is linear light and an rgba32f surface really does keep
  // 1.5, -0.25 and NaN — verified: readPixel returns them unchanged. A 16-bit
  // PSD channel cannot, and the line after this guard clamps with
  // Math.max(0, Math.min(1, value)), so without the refusal an out-of-gamut
  // float would be written as clipped data presented as faithful, and a NaN
  // would be written as black. Nothing exercised it: the fixture only puts an
  // out-of-range sample in the 32-bit case, where it is legal.
  for (const [label, sample] of [["above one", 1.5], ["below zero", -0.25], ["not a number", NaN]] as Array<[string, number]>) {
    const doc = fixture(16);
    const base = doc.layers[doc.layers.length - 1];
    base.surface!.updateFromWorkingFloat32({
      width: 2, height: 1,
      data: new Float32Array([sample, 0.2, 0.3, 1, 0.9, 0.1, 0.2, 1]),
    });
    assert.equal(highDepthEligibility(doc).eligible, true, `${label}: the document is otherwise exportable`);
    assert.throws(
      () => exportPhotoshopDocument(doc, { format: "psd" }),
      /out-of-range samples|non-finite/,
      `a sample ${label} must be refused, not clipped`,
    );
  }

  // The same values at 32 bits are legitimate and must still export.
  const float = fixture(32);
  float.layers[float.layers.length - 1].surface!.updateFromWorkingFloat32({
    width: 2, height: 1, data: new Float32Array([1.5, 0.2, 0.3, 1, 0.9, 0.1, 0.2, 1]),
  });
  assert.equal(inspectPhotoshopHeader(exportPhotoshopDocument(float, { format: "psd" }).buffer).bitsPerChannel, 32);
});
