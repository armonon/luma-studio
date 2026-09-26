import test from "node:test";
import assert from "node:assert/strict";
import "./canvas-harness.ts";
import { inspectPhotoshopHeader } from "../app/engine/input-limits.ts";
import { createDocument, createRasterLayer, type PathStyle } from "../app/engine/document.ts";
import { PrecisionTileSurface } from "../app/engine/tile-store.ts";
import { photoshopCompatibilityReport } from "../app/engine/psd.ts";
import { readPsd, writePsd } from "../app/engine/ag-psd-io.ts";
import { decodeLumaProject, encodeLumaProject } from "../app/engine/project.ts";
import { importPsd, exportPhotoshopDocument } from "../app/engine/psd.ts";
import { Studio } from "../app/engine/studio.ts";
import { testCanvas } from "./canvas-harness.ts";
import { deliveryStatus } from "../app/studio/delivery-preflight.ts";
import { fidelityMetrics, withinFidelityTolerance } from "../build/fidelity-metrics.ts";

test("a small missing design element cannot hide in a full-page average", () => {
  const before = new Uint8ClampedArray(512 * 512 * 4).fill(255), after = before.slice();
  for (let y = 64; y < 96; y++) for (let x = 64; x < 96; x++) after.fill(0, (y * 512 + x) * 4, (y * 512 + x) * 4 + 3);
  const metrics = fidelityMetrics(before, after, 512, 512);
  assert.ok(metrics.rgbMAE < 3 && metrics.fractionOver8 < .05, "old whole-page tolerances would pass");
  assert.equal(metrics.worstTileRgbMAE, 255);
  assert.equal(withinFidelityTolerance(metrics), false);
});
import { independentPhotoshopCorpusEvidence } from "../build/corpus-evidence.mjs";

// Modern Photoshop emits 8B64 for keys outside the legacy PSB key list,
// including cinf and lnkE. No private corpus content belongs in this fixture.
function taggedPsb(key: string, payloadLength = 5) {
  const length = 8 + 4 + 16 + Math.ceil(payloadLength / 4) * 4 + 12;
  const bytes = new Uint8Array(42 + length), view = new DataView(bytes.buffer);
  const text = (at: number, value: string) => bytes.set(new TextEncoder().encode(value), at);
  text(0, "8BPS"); view.setUint16(4, 2); view.setUint16(12, 3);
  view.setUint32(14, 16); view.setUint32(18, 16); view.setUint16(22, 8); view.setUint16(24, 3);
  view.setBigUint64(34, BigInt(length));
  text(54, "8B64"); text(58, key); view.setBigUint64(62, BigInt(payloadLength));
  const next = 70 + Math.ceil(payloadLength / 4) * 4;
  text(next, "8BIM"); text(next + 4, "Patt");
  return bytes;
}

for (const key of ["cinf", "lnkE", "test"]) test(`PSB admits bounded 8B64 ${key} tags without desynchronizing the next tag`, () => {
  assert.equal(inspectPhotoshopHeader(taggedPsb(key)).layers, 0);
});

test("64-bit tag lengths remain bounded by the enclosing section and safe integers", () => {
  for (const length of [BigInt(1000), BigInt(2) ** BigInt(60)]) {
    const bytes = taggedPsb("cinf"); new DataView(bytes.buffer).setBigUint64(62, length);
    assert.throws(() => inspectPhotoshopHeader(bytes), /length/);
  }
  const truncated = taggedPsb("cinf");
  new DataView(truncated.buffer).setBigUint64(34, BigInt(24));
  assert.throws(() => inspectPhotoshopHeader(truncated), /length|Truncated/);
});

const rectangle: PathStyle = { closed: true, fill: "#ffffff", stroke: "none", strokeWidth: 0,
  anchors: [[0, 0], [1, 0], [1, 2], [0, 2]].map(([x, y]) => ({ x, y, hIn: { dx: 0, dy: 0 }, hOut: { dx: 0, dy: 0 } })) };

test("single-layer high-depth fast path never claims a raw composite preserves vector masks", () => {
  const doc = createDocument(2, 2); doc.bitDepth = 16;
  const layer = createRasterLayer("Masked master");
  layer.surface = new PrecisionTileSurface(2, 2, "rgba32f", "srgb");
  for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) layer.surface.writePixel(x, y, [.25, .5, .75, 1]);
  doc.layers = [layer];
  assert.ok(photoshopCompatibilityReport(doc).issues.some(issue => issue.code === "OUTPUT_16_BIT_NATIVE"));
  layer.vectorMask = rectangle;
  const masked = photoshopCompatibilityReport(doc);
  assert.ok(!masked.issues.some(issue => issue.code === "OUTPUT_16_BIT_NATIVE"), "raw samples are not a masked composite");
  assert.equal(masked.canExport, false);
  assert.throws(() => exportPhotoshopDocument(doc), /vector mask/);
});

for (const text of ["Poster\n", "Poster\n\n", "\n\n", "Line one\nLine two\n"]) test(`intentional trailing paragraphs survive native and Photoshop reopen (${JSON.stringify(text)})`, async () => {
  const input = writePsd({ width: 80, height: 80, children: [{ name: "Type", text: {
    text, transform: [1, 0, 0, 1, 0, 20], style: { font: { name: "ArialMT" }, fontSize: 12 },
    paragraphStyle: { justification: "left" },
  } }] });
  assert.equal(readPsd(input).children![0].text!.text, text);
  const doc = await importPsd(input);
  const reopened = (await decodeLumaProject(await encodeLumaProject(doc, [], "Terminal paragraphs"))).doc;
  assert.equal(reopened.layers[0].text?.text, text);
  reopened.layers[0].opacity = .97;
  const issue = photoshopCompatibilityReport(reopened).issues.find(issue => issue.code === "IMPORTED_TEXT_PREVIEW_REGENERATED");
  assert.equal(issue?.severity, "warning");
  assert.equal(issue?.layerId, reopened.layers[0].id);
  assert.equal(readPsd(exportPhotoshopDocument(reopened).buffer).children![0].text!.text, text);
});

test("blank paragraph overrides are retained, not extended from the last visible paragraph", () => {
  const text = "A\n\n";
  const input = writePsd({ width: 80, height: 80, children: [{ name: "Type", text: {
    text, transform: [1, 0, 0, 1, 0, 20], style: { font: { name: "ArialMT" }, fontSize: 12 },
    paragraphStyleRuns: [{ length: 2, style: { justification: "left" } }, { length: 1, style: { justification: "right", spaceBefore: 7 } }],
  } }] });
  const result = readPsd(input).children![0].text!;
  assert.equal(result.text, text);
  assert.equal(result.paragraphStyleRuns?.at(-1)?.style.justification, "right");
  assert.equal(result.paragraphStyleRuns?.at(-1)?.style.spaceBefore, 7);
  assert.equal(result.paragraphStyleRuns?.reduce((sum, run) => sum + run.length, 0), text.length);
});

test("lossy engine exports cannot bypass approval, and blocked exports cannot be approved", async () => {
  const studio = new Studio(8, 8, testCanvas(8, 8));
  try {
    studio.addProAdjustmentLayer("color-lookup");
    await assert.rejects(studio.exportPhotoshop(), /compatibility approval/);
    studio.doc.layers[0].vectorMask = rectangle;
    const history = studio.historyLabels(), document = studio.doc;
    let requests = 0;
    await assert.rejects(studio.exportPhotoshop({}, async report => {
      requests++; assert.equal(deliveryStatus(report), "Export blocked"); return true;
    }), /vector mask/);
    assert.equal(requests, 1); assert.equal(studio.doc, document); assert.deepEqual(studio.historyLabels(), history);
  } finally { studio.dispose(); }
});

test("fidelity metrics distinguish transparent RGB from lost black-text alpha edges", () => {
  const a = new Uint8ClampedArray([0, 0, 0, 0, 0, 0, 0, 255]);
  const invisibleRgb = new Uint8ClampedArray([255, 99, 20, 0, 0, 0, 0, 255]);
  assert.equal(fidelityMetrics(a, invisibleRgb, 2, 1).maxDelta, 0);
  const removed = fidelityMetrics(a, new Uint8ClampedArray(8), 2, 1);
  assert.equal(removed.rgbMAE, 0); assert.equal(removed.alphaEdgeMAE, 255); assert.equal(withinFidelityTolerance(removed), false);
  assert.throws(() => fidelityMetrics(a, invisibleRgb, 3, 1), /dimensions/);
});

test("independent preview pilots, self-reopens and mismatched sources cannot qualify production interchange", () => {
  const internal = { sourceSha256: "a".repeat(64), results: [{ id: "real", kind: "psd", metrics: { inputSha256: "b".repeat(64) } }] };
  assert.equal(independentPhotoshopCorpusEvidence(null, internal), false);
  assert.equal(independentPhotoshopCorpusEvidence({ qualificationLevel: "preview-baseline", completed: true, passed: 50, total: 50 }, internal), false);
  assert.equal(independentPhotoshopCorpusEvidence({ qualificationLevel: "full-resolution-independent", completed: true, unchanged: true, manifestUnchanged: true,
    sourceSha256: "c".repeat(64), results: [], total: 0, executed: 0 }, internal), false);
});
