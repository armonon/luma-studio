import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, rgb } from "pdf-lib";
import { DOMMatrix, Path2D } from "@napi-rs/canvas";
import { importEditablePdf, renderPdfPage, pdfRasterDimensions } from "../app/engine/pdf-import.ts";
import "../app/engine/pdf-vector-operators.ts"; // Initialize Paper before the browser canvas test shim.
import { pdfVectorOperators } from "../app/engine/pdf-vector-operators.ts";
import { createDocument, createPathLayer } from "../app/engine/document.ts";
import { exportVectorPdf } from "../app/engine/vector-pdf.ts";
import { Studio } from "../app/engine/studio.ts";
import { testCanvas } from "./canvas-harness.ts";
import { vectorPathBounds } from "../app/engine/vector-path.ts";
Object.assign(globalThis, { DOMMatrix, Path2D });
// Parser/fidelity tests use PDF.js's Node fake-worker path. Warm its module outside
// the operation deadline; real cold browser workers are verified separately in UI.
const options = { workerSrc: new URL("../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs", import.meta.url).href, resourceBase: new URL("../node_modules/pdfjs-dist/", import.meta.url).pathname, convert: pdfVectorOperators };
await import(options.workerSrc);
async function fixture(text = false) {
  const pdf = await PDFDocument.create(); const page = pdf.addPage([300, 200]);
  page.drawRectangle({ x: 20, y: 30, width: 80, height: 60, color: rgb(1, 0, 0) });
  if (text) page.drawText("Do not lose this", { x: 10, y: 100, size: 12 });
  return (await pdf.save()).buffer as ArrayBuffer;
}
test("PDF solid paths remain editable with page coordinates", async () => {
  const result = await importEditablePdf(await fixture(), 1, options);
  assert.equal(result.width, 300); assert.equal(result.height, 200);
  assert.equal(result.layers.length, 1);
  assert.equal(result.layers[0].path!.fill, "#ff0000");
});
test("PDF text and invalid pages fail explicitly, releasing the importer", async () => {
  await assert.rejects(importEditablePdf(await fixture(true), 1, options), /not yet supported/);
  await assert.rejects(importEditablePdf(await fixture(), 2, options), /available page/);
  assert.equal((await importEditablePdf(await fixture(), 1, options)).layers.length, 1);
});

test("rendered PDF imports text and embedded images as an explicit pixel layer", async () => {
  const pdf = await PDFDocument.create(); const page = pdf.addPage([300, 200]);
  page.drawText("Visible PDF text", { x: 10, y: 100, size: 30, color: rgb(0, 0, 0) });
  const imageCanvas = testCanvas(20, 20); const context = imageCanvas.getContext("2d")!;
  context.fillStyle = "#00ff00"; context.fillRect(0, 0, 20, 20);
  const image = await pdf.embedPng(imageCanvas.toDataURL());
  page.drawImage(image, { x: 20, y: 20, width: 40, height: 40 });
  const bytes = (await pdf.save()).buffer as ArrayBuffer;
  const studio = new Studio(100, 100, testCanvas(32, 32)); const original = studio.doc;
  try {
    const result = await studio.importRenderedPdf(bytes, 1, 150, "Proof", (b, page, ppi) => renderPdfPage(b, page, ppi, options));
    assert.notEqual(result, original); assert.equal(result.layers[0].kind, "raster");
    assert.equal(result.resolution.x, 150); assert.equal(result.width, 625); assert.equal(result.height, 417);
    const pixels = result.layers[0].bitmap!.getContext("2d")!.getImageData(0, 0, result.width, result.height).data;
    let black = 0, green = 0;
    for (let i = 0; i < pixels.length; i += 4) { if (pixels[i] < 30 && pixels[i + 1] < 30 && pixels[i + 2] < 30) black++; if (pixels[i] < 30 && pixels[i + 1] > 240 && pixels[i + 2] < 30) green++; }
    assert.ok(black > 200, "PDF text is painted, not omitted"); assert.ok(green > 1000, "embedded image is painted");
    await assert.rejects(studio.importRenderedPdf(bytes, 99, 150, "Invalid", (b, page, ppi) => renderPdfPage(b, page, ppi, options)));
    assert.equal(studio.doc, result);
  } finally { studio.dispose(); }
});

test("PDF raster budget refuses extreme dimensions before allocating a canvas", () => {
  assert.deepEqual(pdfRasterDimensions(300, 200, 72), { width: 300, height: 200 });
  assert.throws(() => pdfRasterDimensions(50000, 50000, 72), /budget/);
  assert.throws(() => pdfRasterDimensions(4001, 4001, 72), /budget/);
  assert.throws(() => pdfRasterDimensions(NaN, 200, 72), /budget/);
  assert.throws(() => pdfRasterDimensions(300, 200, 1200), /resolution|Choose/);
});
test("malformed and oversized PDF inputs refuse before installation", async () => {
  await assert.rejects(importEditablePdf(new ArrayBuffer(9 * 1024 * 1024), 1, options), /8 MiB/);
  await assert.rejects(importEditablePdf(new TextEncoder().encode("not a valid PDF at all").buffer, 1, options));
});
test("Luma vector PDF export reimports its form path without a transform shift", async () => {
  const doc = createDocument(300, 200);
  doc.layers = [createPathLayer("Triangle", { anchors: [[30, 40], [120, 40], [80, 100]].map(([x, y]) => ({ x, y, hIn: { dx: 0, dy: 0 }, hOut: { dx: 0, dy: 0 } })), closed: true, fill: "#ff0000", stroke: "none", strokeWidth: 0 })];
  const original = vectorPathBounds(doc.layers[0].path!);
  const pdf = await exportVectorPdf(doc);
  const imported = await importEditablePdf(pdf.buffer as ArrayBuffer, 1, options);
  assert.deepEqual(vectorPathBounds(imported.layers[0].path!), original);
});
test("failed PDF import preserves active document, layers and history", async () => {
  const studio = new Studio(300, 200, testCanvas(32, 32));
  try {
    studio.addTextLayer("Keep me"); const doc = studio.doc, layers = doc.layers.slice(), history = studio.historyState();
    await assert.rejects(studio.importPdf(await fixture(true), 1, "Rejected", (bytes, page) => importEditablePdf(bytes, page, options)));
    assert.equal(studio.doc, doc); assert.deepEqual(studio.doc.layers, layers); assert.deepEqual(studio.historyState(), history);
    const next = await studio.importPdf(await fixture(), 1, "Vector PDF", (bytes, page) => importEditablePdf(bytes, page, options));
    assert.notEqual(next, doc); assert.equal(next.layers[0].kind, "path");
  } finally { studio.dispose(); }
});

test("PDF conversion rejects unsupported paint and enforces operation/clip budgets", () => {
  const ops = { constructPath: 1, fill: 2, beginGroup: 3, endGroup: 4, paintFormXObjectBegin: 5, paintFormXObjectEnd: 6, clip: 7 };
  const viewport = { width: 100, height: 100, transform: [1, 0, 0, 1, 0, 0] };
  const draw = [2, [new Float32Array([0, 1, 1, 1, 5, 1, 1, 5, 5, 4])]];
  assert.throws(() => pdfVectorOperators({ fnArray: [7], argsArray: [[]] }, viewport, ops), /not yet supported/);
  assert.throws(() => pdfVectorOperators({ fnArray: Array(50001).fill(1), argsArray: [] }, viewport, ops), /budget/);
  assert.throws(() => pdfVectorOperators({ fnArray: [5, 1, 6], argsArray: [[null, [0, 0, 2, 2]], draw, []] }, viewport, ops), /crosses a form clip/);
  const matrix = [1, 0, 0, 1, 20, 30];
  const result = pdfVectorOperators({ fnArray: [3, 5, 1, 6, 4], argsArray: [[{ matrix, bbox: [0, 0, 10, 10] }], [matrix, [0, 0, 10, 10]], draw, [], []] }, viewport, ops);
  const layer = result.layers[0], first = layer.path!.anchors[0];
  assert.equal(first.x + layer.transform.tx, 21); assert.equal(first.y + layer.transform.ty, 31); // Matrix is applied once, not once per group + form.
});

test("PDF deadline rejects stalled conversion and releases admission without mutating documents", async t => {
  const bytes = await fixture();
  const studio = new Studio(300, 200, testCanvas(32, 32));
  const original = studio.doc;
  let started!: () => void;
  const converting = new Promise<void>(resolve => { started = resolve; });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const operation = studio.importPdf(bytes, 1, "Timed out", (data, page) => importEditablePdf(data, page, { ...options, convert: () => { started(); return new Promise(() => {}); } }));
    const rejected = assert.rejects(operation, /12-second deadline/);
    await converting;
    await assert.rejects(importEditablePdf(bytes, 1, options), /Another PDF import/);
    t.mock.timers.tick(12001);
    await rejected;
    assert.equal(studio.doc, original);
    t.mock.timers.reset();
    assert.equal((await importEditablePdf(bytes, 1, options)).layers.length, 1);
  } finally { t.mock.timers.reset(); studio.dispose(); }
});
