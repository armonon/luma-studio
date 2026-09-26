import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { TextStyle } from "../app/engine/document.ts";
import { shapeTextOutlines } from "../app/engine/text-shaping.ts";
import { outlinedVectorPath, validateOutlineText } from "../app/engine/text-outline-model.ts";
import { pathContours, vectorPathBounds } from "../app/engine/vector-path.ts";
import { BUNDLED_FONTS, bundledFontFace } from "../app/engine/bundled-fonts.ts";
import { createShapedTextMesh, disposeTextMesh } from "../app/engine/text-mesh.ts";
import { DEFAULT_TEXT_SPATIAL } from "../app/engine/text-3d.ts";
import { Studio } from "../app/engine/studio.ts";
import { testCanvas } from "./canvas-harness.ts";
import { executeTextOutlines, textOutlineDisabledReason } from "../app/studio/text-outline-command.ts";
import { decodeLumaProject } from "../app/engine/project.ts";
import { exportVectorSvg } from "../app/engine/vector-delivery.ts";
import { exportVectorPdf } from "../app/engine/vector-pdf.ts";
import { computeTextOutlines } from "../app/engine/text-shaping-client.ts";

const text: TextStyle = { text: "office", font: '400 96px "Lato", sans-serif', color: "#ffffff", align: "left", lineHeight: 1.1, x: 40, y: 150 };
const bytes = (file = "Lato-Regular.ttf") => { const data = readFileSync(new URL(`../public/fonts/${file}`, import.meta.url)); return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength); };
const shape = (source: TextStyle) => shapeTextOutlines(source, bytes());

test("HarfBuzz honors ligature and kerning switches", async () => {
  const ligatures = await shape(text);
  const separate = await shape({ ...text, defaultStyle: { features: { liga: false } } });
  assert.ok(ligatures.glyphs.length < separate.glyphs.length, "ffi is shaped as a ligature");
  assert.notDeepEqual(ligatures.glyphs, separate.glyphs);
  const kerned = await shape({ ...text, text: "AV" });
  const unkerned = await shape({ ...text, text: "AV", defaultStyle: { features: { kern: false } } });
  assert.ok(kerned.lineWidths[0] < unkerned.lineWidths[0]);
});

test("combining marks normalize through shaping, not detached per-character geometry", async () => {
  const composed = await shape({ ...text, text: "é" });
  const combining = await shape({ ...text, text: "e\u0301" });
  assert.deepEqual(composed.glyphs, combining.glyphs);
  assert.deepEqual(composed.paths, combining.paths);
});

test("tracking is applied between shaped clusters with no trailing advance", async () => {
  const normal = await shape({ ...text, text: "AB" });
  const tracked = await shape({ ...text, text: "AB", tracking: 100 });
  assert.ok(Math.abs(tracked.lineWidths[0] - normal.lineWidths[0] - 9.6) < 1e-8);
  const single = await shape({ ...text, text: "e\u0301", tracking: 100 });
  const plain = await shape({ ...text, text: "é" });
  assert.equal(single.lineWidths[0], plain.lineWidths[0]);
});

test("all local families shape into finite mesh geometry", async () => {
  for (const font of BUNDLED_FONTS) {
    const source = { ...text, text: "Office", font: `400 64px "${font.family}"` };
    const outlines = await shapeTextOutlines(source, bytes(bundledFontFace(font.family).file));
    const mesh = createShapedTextMesh(source, DEFAULT_TEXT_SPATIAL, outlines);
    try { assert.ok(mesh.geometry.getAttribute("position").count > 0); assert.ok(Array.from(mesh.geometry.getAttribute("position").array).every(Number.isFinite)); }
    finally { disposeTextMesh(mesh); }
  }
});

test("outlines preserve counters, local baseline and alignment", async () => {
  const source = { ...text, text: "O" };
  const left = outlinedVectorPath(source, await shape(source));
  assert.equal(pathContours(left).length, 2, "O retains its hole");
  assert.ok(pathContours(left).every(c => c.closed));
  const centered = { ...source, align: "center" as const };
  const shaped = await shape(centered);
  const center = outlinedVectorPath(centered, shaped);
  assert.ok(Math.abs(vectorPathBounds(left).x - vectorPathBounds(center).x - shaped.lineWidths[0] / 2) < 1e-8);
  assert.equal(vectorPathBounds(left).y, vectorPathBounds(center).y);
});

test("unsupported stories/fonts/appearance fail explicitly", async () => {
  assert.throws(() => validateOutlineText({ ...text, text: "x".repeat(161) }), /160/);
  assert.throws(() => validateOutlineText({ ...text, text: "a\u2067b\u2069" }), /Bidi/);
  assert.throws(() => validateOutlineText({ ...text, text: "A\tB" }), /control/);
  assert.throws(() => validateOutlineText({ ...text, layout: "paragraph" }), /frame/);
  assert.throws(() => validateOutlineText({ ...text, font: "20px Missing Font" }), /bundled/);
  await assert.rejects(shapeTextOutlines(text, new ArrayBuffer(20)), /Invalid/);
  await assert.rejects(shape({ ...text, text: "😀" }), /no outline/);
  assert.throws(() => outlinedVectorPath({ ...text, defaultStyle: { decoration: "underline" } }, { paths: [], glyphs: [], lineWidths: [], fontFile: "Lato-Regular.ttf" }), /decorations/);
});

test("outline command preserves stack position, source, transform, undo and project round trip", async () => {
  const studio = new Studio(800, 600, testCanvas(64, 64));
  try {
    const source = studio.addTextLayer("office"); studio.updateText(source.id, text);
    source.transform = { ...source.transform, tx: 15, rotation: 0.2 }; source.opacity = 0.75;
    studio.addTextLayer("Layer above");
    const index = studio.doc.layers.indexOf(source), count = studio.doc.layers.length;
    const result = await executeTextOutlines(studio, source.id, shape);
    assert.equal(studio.doc.layers[index], result); assert.equal(source.visible, false);
    assert.deepEqual(result.transform, source.transform); assert.equal(result.opacity, 0.75);
    studio.undo(); assert.equal(studio.doc.layers.length, count); assert.equal(studio.findLayer(source.id)!.visible, true);
    studio.redo(); assert.equal(studio.doc.layers.length, count + 1);
    const reopened = await decodeLumaProject((await studio.prepareProjectSave()).blob);
    const outlined = reopened.doc.layers.find(l => l.id === result.id)!;
    assert.deepEqual(outlined.path, result.path);
    assert.equal(reopened.doc.layers.find(l => l.id === source.id)!.text!.text, "office");
    assert.match(exportVectorSvg(reopened.doc, [outlined]), /fill-rule="nonzero"/);
    // PDF remains an explicit DeviceRGB vector delivery, not print certification.
    outlined.opacity = 1;
    const pdf = await exportVectorPdf({ ...reopened.doc, layers: [outlined] });
    assert.equal(new TextDecoder().decode(pdf.slice(0, 4)), "%PDF");
  } finally { studio.dispose(); }
});

test("async stale result and locked/masked source cannot mutate document", async () => {
  const studio = new Studio(800, 600, testCanvas(64, 64));
  try {
    const source = studio.addTextLayer("office"); studio.updateText(source.id, text);
    source.locked = true; assert.match(textOutlineDisabledReason(source)!, /Unlock/); source.locked = false;
    const count = studio.doc.layers.length;
    await assert.rejects(executeTextOutlines(studio, source.id, async current => { const value = await shape(current); studio.updateText(source.id, { text: "Changed" }); return value; }), /changed/);
    assert.equal(studio.doc.layers.length, count); assert.equal(source.visible, true);
    source.clipping = true; assert.match(textOutlineDisabledReason(source)!, /clipping/);
  } finally { studio.dispose(); }
});

test("worker concurrency is bounded and cancellation/failure release each worker", async () => {
  const previous = globalThis.Worker;
  const workers: FakeWorker[] = [];
  class FakeWorker {
    onmessage?: (event: { data: unknown }) => void;
    onerror?: () => void;
    terminated = false;
    constructor() { workers.push(this); }
    postMessage() {}
    terminate() { this.terminated = true; }
  }
  globalThis.Worker = FakeWorker as unknown as typeof Worker;
  try {
    const abort = new AbortController();
    const first = computeTextOutlines(text, abort.signal), second = computeTextOutlines(text);
    await assert.rejects(computeTextOutlines(text), /busy/);
    abort.abort(); await assert.rejects(first, /cancelled/);
    workers[1].onerror!(); await assert.rejects(second, /failed/);
    assert.ok(workers.every(worker => worker.terminated));
    const next = computeTextOutlines(text);
    workers[2].onmessage!({ data: { error: "Rejected font" } });
    await assert.rejects(next, /Rejected font/);
    assert.ok(workers[2].terminated);
    await assert.rejects(computeTextOutlines(text, abort.signal), /cancelled/);
    assert.equal(workers.length, 3, "already-aborted requests allocate no worker");
  } finally { globalThis.Worker = previous; }
});

test("paragraph outlines wrap with OpenType shaping, align and reject overflow", async () => {
  const source: TextStyle = { ...text, text: "office office office", layout: "paragraph", boxWidth: 550, boxHeight: 400 };
  const left = await shape(source);
  assert.ok(left.lineWidths.length > 1);
  assert.ok(left.lineWidths.every(width => width <= 550));
  const right = await shape({ ...source, align: "right" });
  const leftPoint = left.paths.flatMap(p => p.commands).find(c => c.type === "M")!;
  const rightPoint = right.paths.flatMap(p => p.commands).find(c => c.type === "M")!;
  if (leftPoint.type === "M" && rightPoint.type === "M") assert.ok(Math.abs(rightPoint.x - leftPoint.x + left.lineWidths[0]) < 1e-8, "right alignment preserves the document's baseline anchor");
  const justified = await shape({ ...source, justify: true });
  assert.equal(justified.lineWidths[0], 550);
  await assert.rejects(shape({ ...source, boxHeight: 50 }), /overflows/);
  await assert.rejects(shape({ ...source, boxWidth: 10 }), /word exceeds/);
  assert.doesNotThrow(() => outlinedVectorPath(source, left));
});

test("mixed-style point text shapes font faces, sizes and alignment without losing paint", async () => {
  const fonts = new Map([["Lato-Regular.ttf", bytes()], ["Lato-Bold.ttf", bytes("Lato-Bold.ttf")]]);
  const source: TextStyle = { ...text, text: "Office Bold", runs: [{ start: 7, end: 11, style: { fontWeight: 700, fontSize: 64, baselineShift: 12 } }] };
  const result = await shapeTextOutlines(source, fonts);
  const first = await shape({ ...text, text: "Office " });
  const second = await shapeTextOutlines({ ...text, text: "Bold", defaultStyle: { fontWeight: 700, fontSize: 64, baselineShift: 12 } }, bytes("Lato-Bold.ttf"));
  assert.ok(Math.abs(result.lineWidths[0] - first.lineWidths[0] - second.lineWidths[0]) < 1e-8);
  assert.equal(result.glyphs.length, first.glyphs.length + second.glyphs.length);
  const shifted = result.paths[first.paths.length].commands.find(c => c.type === "M")!;
  const original = second.paths[0].commands.find(c => c.type === "M")!;
  if (shifted.type === "M" && original.type === "M") {
    assert.ok(Math.abs(shifted.x - original.x - first.lineWidths[0]) < 1e-8); assert.equal(shifted.y, original.y);
  }
  const centered = await shapeTextOutlines({ ...source, align: "center" }, fonts);
  const leftBounds = vectorPathBounds(outlinedVectorPath(source, result));
  const centerBounds = vectorPathBounds(outlinedVectorPath({ ...source, align: "center" }, centered));
  assert.ok(Math.abs(leftBounds.x - centerBounds.x - result.lineWidths[0] / 2) < 1e-8);
  const mesh = createShapedTextMesh(source, DEFAULT_TEXT_SPATIAL, result);
  try { assert.ok(mesh.geometry.getAttribute("position").count > 0); } finally { disposeTextMesh(mesh); }
  assert.throws(() => validateOutlineText({ ...source, runs: [{ start: 7, end: 11, style: { color: "#ff0000" } }] }), /Mixed-color/);
  assert.throws(() => validateOutlineText({ ...source, text: "e\u0301", runs: [{ start: 1, end: 2, style: { fontSize: 50 } }] }), /grapheme/);
  assert.throws(() => validateOutlineText({ ...source, layout: "paragraph", boxWidth: 800, boxHeight: 400 }), /Point text/);
  await assert.rejects(shapeTextOutlines(source, bytes()), /resource map/);
});
