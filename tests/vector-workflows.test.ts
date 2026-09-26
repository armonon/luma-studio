import test from "node:test";
import assert from "node:assert/strict";
import { testCanvas } from "./canvas-harness.ts";
import { Studio } from "../app/engine/studio.ts";
import { createDocument, createPathLayer, rasterizeVectorMask, type PathStyle } from "../app/engine/document.ts";
import { renderClean } from "../app/engine/renderer.ts";
import { evaluateBoolean } from "../app/engine/vector-boolean.ts";
import { exportVectorSvg, documentContours } from "../app/engine/vector-delivery.ts";
import { cloneContour, pathContours, validateVectorPath, vectorPathBounds } from "../app/engine/vector-path.ts";
import { deepClonePath, historyEntrySize, vectorPathBytes } from "../app/engine/history-payload.ts";
import { decodeLumaProject } from "../app/engine/project.ts";
import { executeVectorBoolean } from "../app/studio/vector-command-registry.ts";
import { exportVectorPdf } from "../app/engine/vector-pdf.ts";
import { PDFDocument } from "pdf-lib";
import { loadImage } from "@napi-rs/canvas";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function rect(x = 0, y = 0, w = 100, h = 100): PathStyle {
  return { anchors: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(([x, y]) => ({ x, y, hIn: { dx: 0, dy: 0 }, hOut: { dx: 0, dy: 0 } })), closed: true, fill: "#ff0000", stroke: "none", strokeWidth: 0 };
}
const alpha = (canvas: HTMLCanvasElement, x: number, y: number) => canvas.getContext("2d")!.getImageData(x, y, 1, 1).data[3];
function render(path: PathStyle) {
  const doc = createDocument(160, 160); doc.layers = [createPathLayer("Vector", path)];
  const canvas = testCanvas(160, 160); renderClean(doc, canvas); return canvas;
}

test("compound holes match vector-mask fill rule, and islands are retained", () => {
  const outer = rect(5, 5, 90, 90), hole = rect(25, 25, 40, 40), island = rect(110, 10, 25, 25);
  const path = { ...outer, contours: [cloneContour(hole), cloneContour(island)], fillRule: "evenodd" as const };
  for (const canvas of [render(path), rasterizeVectorMask(path, 160, 160)]) {
    assert.equal(alpha(canvas, 10, 10), 255); assert.equal(alpha(canvas, 40, 40), 0); assert.equal(alpha(canvas, 120, 20), 255);
  }
  assert.equal(alpha(render({ ...path, fillRule: "nonzero" }), 40, 40), 255);
});

for (const operation of ["unite", "subtract", "intersect", "exclude"] as const) test(`boolean ${operation} has correct overlap and editable recipe`, () => {
  const a = rect(5, 5, 70, 70), b = rect(45, 5, 70, 70);
  const result = evaluateBoolean({ operation, operands: [pathContours(a), pathContours(b)] }, a);
  const image = render(result);
  assert.equal(alpha(image, 10, 20) > 0, operation !== "intersect");
  assert.equal(alpha(image, 60, 20) > 0, ["unite", "intersect"].includes(operation));
  assert.equal(alpha(image, 100, 20) > 0, ["unite", "exclude"].includes(operation));
  assert.equal(result.booleanSource!.operation, operation);
});

test("subtraction makes a real hole; disjoint intersection is safely empty", () => {
  const a = rect(5, 5, 100, 100), b = rect(30, 30, 20, 20);
  const result = evaluateBoolean({ operation: "subtract", operands: [pathContours(a), pathContours(b)] }, a);
  assert.equal(pathContours(result).length, 2); assert.equal(alpha(render(result), 35, 35), 0);
  const empty = evaluateBoolean({ operation: "intersect", operands: [pathContours(a), pathContours(rect(120, 120, 10, 10))] }, a);
  assert.equal(empty.anchors.length, 0); assert.equal(alpha(render(empty), 30, 30), 0);
});

test("compound history clones are isolated and bounds include control handles", () => {
  const p = { ...rect(), contours: [rect(200, 200, 20, 20)] }; p.contours[0].anchors[0].hOut.dx = 100;
  const clone = deepClonePath(p); clone.contours![0].anchors[0].x = 999;
  assert.equal(p.contours[0].anchors[0].x, 200); assert.ok(vectorPathBounds(p).width >= 300);
});

test("history accounts for compound geometry and retained boolean operands", () => {
  const a = rect(), b = rect(25, 25, 30, 30);
  const p = evaluateBoolean({ operation: "subtract", operands: [pathContours(a), pathContours(b)] }, a);
  assert.ok(vectorPathBytes(p) > vectorPathBytes(a) * 2);
  assert.ok(historyEntrySize({ label: "Vector", before: [], after: [{ layerId: "p", path: p }] }) > 2000);
});

test("boolean fill rules preserve non-zero winding instead of imposing even-odd", () => {
  const outer = rect(5, 5, 90, 90), inner = rect(20, 20, 40, 40), disjoint = rect(110, 5, 20, 20);
  const operands = [[...pathContours(outer), ...pathContours(inner)], pathContours(disjoint)];
  const nonzero = evaluateBoolean({ operation: "unite", operands, fillRules: ["nonzero", "nonzero"] }, outer);
  const evenodd = evaluateBoolean({ operation: "unite", operands, fillRules: ["evenodd", "nonzero"] }, outer);
  assert.equal(alpha(render(nonzero), 40, 40), 255); assert.equal(alpha(render(evenodd), 40, 40), 0);
});

test("seeded rectangle corpus agrees with pointwise boolean truth tables", () => {
  let seed = 1729;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let fixture = 0; fixture < 16; fixture++) {
    const a = [5 + Math.floor(random() * 50), 5 + Math.floor(random() * 50), 20 + Math.floor(random() * 50), 20 + Math.floor(random() * 50)];
    const b = [5 + Math.floor(random() * 50), 5 + Math.floor(random() * 50), 20 + Math.floor(random() * 50), 20 + Math.floor(random() * 50)];
    const left = rect(...a as [number, number, number, number]), right = rect(...b as [number, number, number, number]);
    for (const operation of ["unite", "subtract", "intersect", "exclude"] as const) {
      const canvas = render(evaluateBoolean({ operation, operands: [pathContours(left), pathContours(right)] }, left));
      for (let y = 2; y < 130; y += 7) for (let x = 2; x < 130; x += 7) {
        const inside = (r: number[]) => x + 0.5 > r[0] && x + 0.5 < r[0] + r[2] && y + 0.5 > r[1] && y + 0.5 < r[1] + r[3];
        const l = inside(a), r = inside(b);
        const expected = operation === "unite" ? l || r : operation === "subtract" ? l && !r : operation === "intersect" ? l && r : l !== r;
        assert.equal(alpha(canvas, x, y) > 128, expected, `fixture ${fixture}, ${operation} at ${x},${y}`);
      }
    }
  }
});

test("boolean creation is one undo step, retains sources, and roundtrips recipe", async () => {
  const studio = new Studio(160, 160, testCanvas(160, 160));
  try {
    const a = studio.addPathLayer(rect()), b = studio.addPathLayer(rect(20, 20, 40, 40));
    const result = await executeVectorBoolean(studio, a.id, b.id, "subtract", async (...args) => evaluateBoolean(...args));
    assert.equal(studio.findLayer(a.id)!.visible, false); assert.equal(studio.doc.layers.length, 3);
    studio.undo(); assert.equal(studio.doc.layers.length, 2); assert.ok(studio.findLayer(a.id)!.visible);
    studio.redo(); assert.ok(studio.findLayer(result.id)!.path!.booleanSource);
    const reopened = await decodeLumaProject((await studio.prepareProjectSave()).blob);
    assert.deepEqual(reopened.doc.layers[0].path, studio.doc.layers[0].path);
    await executeVectorBoolean(studio, result.id, null, "unite", async (...args) => evaluateBoolean(...args));
    assert.equal(studio.findLayer(result.id)!.path!.booleanSource!.operation, "unite");
    studio.undo(); assert.equal(studio.findLayer(result.id)!.path!.booleanSource!.operation, "subtract");
  } finally { studio.dispose(); }
});

test("stale calculation and worker rejection never insert a result or hide sources", async () => {
  const studio = new Studio(160, 160, testCanvas(160, 160));
  try {
    const a = studio.addPathLayer(rect()), b = studio.addPathLayer(rect(20, 20, 40, 40));
    await assert.rejects(executeVectorBoolean(studio, a.id, b.id, "unite", async () => { throw new Error("Worker failed"); }), /Worker failed/);
    await assert.rejects(executeVectorBoolean(studio, a.id, b.id, "unite", async (...args) => { studio.updatePath(a.id, { ...a.path!, fill: "#00ff00" }); return evaluateBoolean(...args); }), /changed/);
    assert.equal(studio.doc.layers.length, 2); assert.ok(a.visible && b.visible);
  } finally { studio.dispose(); }
});

test("validation rejects malformed contours, nonfinite coordinates and excessive operands", () => {
  assert.throws(() => validateVectorPath({ ...rect(), contours: Array.from({ length: 256 }, () => rect()) }), /limit/);
  const bad = rect(); bad.anchors[0].hIn.dx = Infinity; assert.throws(() => validateVectorPath(bad), /coordinate/);
  assert.throws(() => evaluateBoolean({ operation: "unite", operands: [pathContours({ ...rect(), closed: false }), pathContours(rect())] }, rect()), /closed/);
});

test("SVG keeps curves, transforms, holes and escaped names without embedding pixels", () => {
  const doc = createDocument(50000, 50000); const p = { ...rect(), contours: [rect(20, 20, 20, 20)], fillRule: "evenodd" as const };
  const layer = createPathLayer('A <script> " &', p); layer.transform.tx = 40; doc.layers = [layer];
  const svg = exportVectorSvg(doc);
  assert.match(svg, /fill-rule="evenodd"/); assert.match(svg, /matrix\(1 0 0 1 40 0\)/); assert.match(svg, /&lt;script&gt;/); assert.doesNotMatch(svg, /<image|<script>/);
  assert.ok(svg.length < 4096); assert.equal(documentContours(layer)[0].anchors[0].x, 40);
});

test("SVG refuses unsupported visible content, advanced color, and injected paint", () => {
  const doc = createDocument(160, 160); const layer = createPathLayer("Path", rect()); doc.layers = [layer];
  doc.colorSpace = "display-p3"; assert.throws(() => exportVectorSvg(doc), /sRGB/); doc.colorSpace = "srgb";
  layer.blend = "multiply"; assert.throws(() => exportVectorSvg(doc), /blending/); layer.blend = "source-over";
  layer.path!.fill = 'url("https://example.com/a.svg")'; assert.throws(() => exportVectorSvg(doc), /solid CSS/);
});

test("SVG independently rasterizes compound holes and transformed strokes", async () => {
  const doc = createDocument(160, 160);
  const layer = createPathLayer("Compound", { ...rect(5, 5, 100, 100), fillRule: "evenodd", contours: [rect(25, 25, 30, 30)], stroke: "#0000ff", strokeWidth: 2 });
  layer.transform.tx = 10; doc.layers = [layer];
  const image = await loadImage(Buffer.from(exportVectorSvg(doc)));
  const output = testCanvas(160, 160); output.getContext("2d")!.drawImage(image as unknown as CanvasImageSource, 0, 0);
  assert.equal(alpha(output, 20, 20), 255); assert.equal(alpha(output, 40, 40), 0);
  assert.ok(output.getContext("2d")!.getImageData(15, 40, 1, 1).data[2] > 150);
});

test("PDF reparses with physical PPI dimensions", async () => {
  const doc = createDocument(160, 160); doc.layers = [createPathLayer("Vector", rect())];
  const parsed = await PDFDocument.load(await exportVectorPdf(doc));
  assert.equal(parsed.getPageCount(), 1); assert.equal(parsed.getPage(0).getWidth(), 160);
  doc.resolution = { x: 144, y: 144, unit: "ppi" };
  assert.equal((await PDFDocument.load(await exportVectorPdf(doc))).getPage(0).getWidth(), 80);
});

const hasPoppler = (() => { try { execFileSync("pdftoppm", ["-v"], { stdio: "ignore", timeout: 10000 }); return true; } catch { return false; } })();
test("Poppler independently renders PDF vector holes", { skip: !hasPoppler && "Install Poppler for independent PDF pixel validation" }, async () => {
  const doc = createDocument(160, 160);
  doc.layers = [createPathLayer("PDF compound", { ...rect(5, 5, 100, 100), fillRule: "evenodd", contours: [rect(25, 25, 30, 30)] })];
  const bytes = await exportVectorPdf(doc), parsed = await PDFDocument.load(bytes);
  assert.equal(parsed.getPageCount(), 1); assert.equal(parsed.getPage(0).getWidth(), 160);
  const directory = await mkdtemp(join(tmpdir(), "luma-vector-pdf-"));
  try {
    const pdfPath = join(directory, "fixture.pdf"); await writeFile(pdfPath, bytes);
    execFileSync("pdftoppm", ["-r", "72", "-singlefile", "-png", pdfPath, join(directory, "render")], { timeout: 10000 });
    const image = await loadImage(join(directory, "render.png"));
    const output = testCanvas(160, 160); output.getContext("2d")!.drawImage(image as unknown as CanvasImageSource, 0, 0);
    assert.deepEqual([...output.getContext("2d")!.getImageData(10, 10, 1, 1).data], [255, 0, 0, 255]);
    assert.deepEqual([...output.getContext("2d")!.getImageData(40, 40, 1, 1).data], [255, 255, 255, 255]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("PDF refuses unsupported color syntax and oversized physical pages", async () => {
  const doc = createDocument(50000, 50000); doc.layers = [createPathLayer("Vector", rect())];
  await assert.rejects(exportVectorPdf(doc), /200-inch/);
  doc.width = 100; doc.height = 100; doc.layers[0].opacity = 0.5;
  assert.ok((await exportVectorPdf(doc)).byteLength > 0);
  doc.layers[0].opacity = 1; doc.layers[0].path!.fill = "#ff000080";
  await assert.rejects(exportVectorPdf(doc), /opaque hex/);
});

test("Poppler verifies isolated layer opacity over overlapping appearance paints", { skip: !hasPoppler && "Install Poppler for independent PDF pixel validation" }, async () => {
  const doc = createDocument(160, 160);
  const path = rect(20, 20, 100, 100);
  path.appearance = [
    { kind: "fill", color: "#ff0000", opacity: 1, width: 0, enabled: true },
    { kind: "fill", color: "#0000ff", opacity: 0.5, width: 0, enabled: true },
  ];
  const layer = createPathLayer("Transparent paints", path); layer.opacity = 0.5; doc.layers = [layer];
  const directory = await mkdtemp(join(tmpdir(), "luma-pdf-opacity-"));
  try {
    const pdfPath = join(directory, "fixture.pdf"); await writeFile(pdfPath, await exportVectorPdf(doc));
    execFileSync("pdftoppm", ["-r", "72", "-singlefile", "-png", pdfPath, join(directory, "render")], { timeout: 10000 });
    const output = testCanvas(160, 160);
    output.getContext("2d")!.drawImage(await loadImage(join(directory, "render.png")) as unknown as CanvasImageSource, 0, 0);
    const pixel = output.getContext("2d")!.getImageData(60, 60, 1, 1).data;
    // Purple paints compose internally, then 50% layer opacity composites on white.
    for (const [i, expected] of [191, 127, 191, 255].entries()) assert.ok(Math.abs(pixel[i] - expected) <= 2, `channel ${i}: ${pixel[i]}`);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
