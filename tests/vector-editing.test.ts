import test from "node:test";
import assert from "node:assert/strict";
import { testCanvas } from "./canvas-harness.ts";
import { Studio } from "../app/engine/studio.ts";
import { createDocument, createPathLayer, type PathStyle } from "../app/engine/document.ts";
import { renderClean } from "../app/engine/renderer.ts";
import { exportVectorSvg } from "../app/engine/vector-delivery.ts";
import { parseEditableSvg } from "../app/engine/vector-svg-import.ts";
import { materializeImportedVectors } from "../app/engine/vector-import-install.ts";
import { validateVectorPath } from "../app/engine/vector-path.ts";
import { decodeLumaProject } from "../app/engine/project.ts";
import { loadImage } from "@napi-rs/canvas";
import { evaluateOffset } from "../app/engine/vector-offset.ts";
import { pathContours, vectorPathBounds } from "../app/engine/vector-path.ts";
import { executeVectorOffset, executeVectorBoolean } from "../app/studio/vector-command-registry.ts";
import { evaluateBoolean } from "../app/engine/vector-boolean.ts";

const rect = (): PathStyle => ({ anchors: [[10, 10], [90, 10], [90, 90], [10, 90]].map(([x, y]) => ({ x, y, hIn: { dx: 0, dy: 0 }, hOut: { dx: 0, dy: 0 } })), closed: true, fill: "#ff0000", stroke: "none", strokeWidth: 0 });
const svg = (content: string, attrs = "") => `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" ${attrs}>${content}</svg>`;
function documentFromSvg(source: string) {
  const parsed = parseEditableSvg(source), doc = createDocument(parsed.width, parsed.height);
  doc.layers = materializeImportedVectors(parsed);
  return doc;
}

test("appearance paints render in order with independent opacity and export equivalence", async () => {
  const doc = createDocument(100, 100), p = rect();
  p.appearance = [{ kind: "stroke", color: "#0000ff", width: 16, opacity: 1, enabled: true }, { kind: "fill", color: "#ff0000", width: 0, opacity: 0.5, enabled: true }];
  doc.layers = [createPathLayer("Stack", p)];
  const output = testCanvas(100, 100); renderClean(doc, output);
  const independent = testCanvas(100, 100); independent.getContext("2d")!.drawImage(await loadImage(Buffer.from(exportVectorSvg(doc))) as unknown as CanvasImageSource, 0, 0);
  for (const [x, y] of [[5, 40], [12, 40], [40, 40]]) {
    const a = output.getContext("2d")!.getImageData(x, y, 1, 1).data, b = independent.getContext("2d")!.getImageData(x, y, 1, 1).data;
    a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) <= 2, `${x},${y} channel ${i}: ${v} vs ${b[i]}`));
  }
  assert.throws(() => validateVectorPath({ ...p, appearance: Array(17).fill(p.appearance![0]) }), /16/);
  assert.throws(() => validateVectorPath({ ...p, appearance: [{ ...p.appearance![0], opacity: NaN }] }), /Invalid/);
});

test("linked instances update together, preserve transforms, undo atomically, detach and save", async () => {
  const studio = new Studio(100, 100, testCanvas(100, 100));
  try {
    const source = studio.addPathLayer(rect()), sourceId = source.id;
    const instance = studio.createVectorInstance(sourceId), instanceId = instance.id;
    assert.ok(source.path!.symbolId);
    studio.updatePath(instanceId, { ...instance.path!, fill: "#00ff00" });
    assert.equal(studio.findLayer(sourceId)!.path!.fill, "#00ff00");
    assert.equal(studio.findLayer(sourceId)!.transform.tx, 0);
    assert.equal(studio.findLayer(instanceId)!.transform.tx, 20);
    studio.undo(); assert.equal(studio.findLayer(sourceId)!.path!.fill, "#ff0000"); assert.equal(studio.findLayer(instanceId)!.path!.fill, "#ff0000");
    studio.redo(); assert.equal(studio.findLayer(sourceId)!.path!.fill, "#00ff00");
    studio.detachVectorInstance(instanceId);
    studio.updatePath(instanceId, { ...studio.findLayer(instanceId)!.path!, fill: "#0000ff" });
    assert.equal(studio.findLayer(sourceId)!.path!.fill, "#00ff00");
    const reopened = await decodeLumaProject((await studio.prepareProjectSave()).blob);
    assert.deepEqual(reopened.doc.layers.map(l => l.path), studio.doc.layers.map(l => l.path));
  } finally { studio.dispose(); }
});

test("locked siblings prevent partial symbol mutation and color shortcuts update stacked paints", () => {
  const studio = new Studio(100, 100, testCanvas(100, 100));
  try {
    const source = studio.addPathLayer(rect()), instance = studio.createVectorInstance(source.id);
    source.locked = true;
    assert.throws(() => studio.updatePath(instance.id, { ...instance.path!, fill: "#00ff00" }), /Unlock/);
    assert.equal(instance.path!.fill, "#ff0000");
    source.locked = false;
    studio.updatePath(instance.id, { ...instance.path!, appearance: [{ kind: "fill", enabled: true, color: "#ff0000", width: 0, opacity: 1 }] });
    studio.updatePath(instance.id, { ...instance.path!, fill: "#0000ff" });
    assert.equal(source.path!.appearance![0].color, "#0000ff");
  } finally { studio.dispose(); }
});

test("oversized linked edits fail before copying or mutating geometry", () => {
  const studio = new Studio(100, 100, testCanvas(100, 100));
  try {
    const path = rect(); path.anchors = Array.from({ length: 4096 }, (_, i) => ({ ...path.anchors[i % 4], hIn: { dx: 0, dy: 0 }, hOut: { dx: 0, dy: 0 } })); path.symbolId = "large-symbol";
    studio.doc.layers = Array.from({ length: 32 }, (_, i) => createPathLayer(`Instance ${i}`, path));
    assert.throws(() => studio.updatePath(studio.doc.layers[0].id, { ...path, fill: "#0000ff" }), /16 MiB/);
    assert.equal(studio.doc.layers[0].path, path);
    assert.throws(() => studio.createVectorInstance(studio.doc.layers[0].id), /16 MiB/);
    assert.equal(studio.doc.layers.length, 32);
  } finally { studio.dispose(); }
});

test("SVG imports transformed curves, inherited paint, holes, shapes and paint order", async () => {
  const source = svg('<g transform="translate(4 6) rotate(10)" fill="#ff0000"><path d="M10 10L70 10L70 70L10 70Z M25 25L40 25L40 40L25 40Z" fill-rule="evenodd"/><circle cx="75" cy="75" r="10" fill="#0000ff"/></g>');
  const doc = documentFromSvg(source);
  assert.equal(doc.layers.length, 3); assert.equal(doc.layers[0].kind, "group"); assert.equal(doc.layers[2].path!.contours!.length, 1);
  const output = testCanvas(100, 100); renderClean(doc, output);
  const reference = testCanvas(100, 100); reference.getContext("2d")!.drawImage(await loadImage(Buffer.from(source)) as unknown as CanvasImageSource, 0, 0);
  for (let y = 5; y < 95; y += 10) for (let x = 5; x < 95; x += 10) {
    const a = output.getContext("2d")!.getImageData(x, y, 1, 1).data, b = reference.getContext("2d")!.getImageData(x, y, 1, 1).data;
    // Compare interior samples, not backend-specific edge antialias coverage.
    const edge = a[3] > 0 && a[3] < 255 || b[3] > 0 && b[3] < 255;
    if (!edge) a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) <= 5, `${x},${y} channel ${i}: ${v} vs ${b[i]}`));
  }
});

test("offsets expand, shrink and collapse closed geometry; holes shrink on positive distance", () => {
  const p = rect();
  const positive = evaluateOffset({ contours: pathContours(p), distance: 5, join: "miter", fillRule: "nonzero" }, p);
  assert.equal(vectorPathBounds(positive).x, 1); // 5px bound minus 4px selection padding
  assert.equal(vectorPathBounds(positive).width, 98);
  const negative = evaluateOffset({ contours: pathContours(p), distance: -5, join: "miter", fillRule: "nonzero" }, p);
  assert.equal(vectorPathBounds(negative).x, 11);
  assert.equal(evaluateOffset({ contours: pathContours(p), distance: -50, join: "round", fillRule: "nonzero" }, p).anchors.length, 0);
  const hole = rect(); hole.anchors = hole.anchors.map(a => ({ ...a, x: 30 + a.x / 4, y: 30 + a.y / 4 }));
  const compound = evaluateOffset({ contours: [...pathContours(p), ...pathContours(hole)], distance: 3, join: "round", fillRule: "evenodd" }, p);
  assert.equal(pathContours(compound).length, 2);
  const doc = createDocument(100, 100); doc.layers = [createPathLayer("Hole", compound)];
  const canvas = testCanvas(100, 100); renderClean(doc, canvas);
  assert.equal(canvas.getContext("2d")!.getImageData(34, 40, 1, 1).data[3], 255);
  assert.equal(canvas.getContext("2d")!.getImageData(42, 42, 1, 1).data[3], 0);
  assert.throws(() => evaluateOffset({ contours: [{ ...p, closed: false }], distance: 5, join: "round", fillRule: "nonzero" }, p), /closed/);
  assert.throws(() => evaluateOffset({ contours: pathContours(p), distance: Infinity, join: "round", fillRule: "nonzero" }, p), /parameters/);
});

test("offset recalculation uses original contours, has one undo step and survives save", async () => {
  const studio = new Studio(100, 100, testCanvas(100, 100));
  const compute = async (...args: Parameters<typeof evaluateOffset>) => evaluateOffset(...args);
  try {
    const source = studio.addPathLayer(rect());
    const result = await executeVectorOffset(studio, source.id, 5, "miter", compute);
    assert.equal(source.visible, false);
    studio.undo(); assert.equal(studio.doc.layers.length, 1); assert.ok(studio.findLayer(source.id)!.visible);
    studio.redo();
    await executeVectorOffset(studio, result.id, 10, "miter", compute);
    assert.equal(vectorPathBounds(studio.findLayer(result.id)!.path!).x, -4); // original x10 -10 -4
    const reopened = await decodeLumaProject((await studio.prepareProjectSave()).blob);
    assert.deepEqual(reopened.doc.layers[0].path, studio.doc.layers[0].path);
    await assert.rejects(executeVectorOffset(studio, result.id, 7, "round", async (...args) => { studio.findLayer(result.id)!.locked = true; return evaluateOffset(...args); }), /changed/);
    assert.equal(studio.findLayer(result.id)!.path!.offsetSource!.distance, 10);
  } finally { studio.dispose(); }
});

test("Luma SVG appearance export reimports to matching editable pixels", async () => {
  const doc = createDocument(100, 100), p = rect();
  p.appearance = [{ kind: "fill", color: "#ff0000", opacity: 0.5, width: 0, enabled: true }, { kind: "stroke", color: "#0000ff", opacity: 1, width: 6, enabled: true }];
  doc.layers = [createPathLayer("Stack", p)];
  const imported = documentFromSvg(exportVectorSvg(doc));
  const a = testCanvas(100, 100), b = testCanvas(100, 100); renderClean(doc, a); renderClean(imported, b);
  assert.deepEqual(a.getContext("2d")!.getImageData(40, 40, 1, 1).data, b.getContext("2d")!.getImageData(40, 40, 1, 1).data);
});

test("unsafe, malformed or unsupported SVG is refused rather than partly imported", () => {
  for (const content of ['<script>alert(1)</script>', '<image href="https://example.com/a.png"/>', '<path d="M0 0 L10"/>', '<path d="M0 0 L10 10" onclick="evil()"/>', '<path d="M0 0Z" fill="url(#gradient)"/>', '<text>Hello</text>', '<g opacity="1.5"><rect width="20" height="20"/></g>', '<rect width="10" height="10" style="filter:blur(2px)"/>', '<path d="M0 0 A 5 5 0 2 0 20 20"/>']) assert.throws(() => parseEditableSvg(svg(content)), Error, content);
  assert.throws(() => parseEditableSvg('<!DOCTYPE svg [<!ENTITY x "boom">]>' + svg('<path/>')), /entities/);
  assert.throws(() => parseEditableSvg(svg('<g>'.repeat(34) + '<rect width="1" height="1"/>' + '</g>'.repeat(34))), /budget/);
  assert.throws(() => parseEditableSvg(svg('<path/>').repeat(40000)), /2 MiB/);
  assert.throws(() => parseEditableSvg(svg('<rect>')), /Malformed/);
});

test("SVG import installs only after complete validation and preserves an existing dirty document", async () => {
  const studio = new Studio(100, 100, testCanvas(100, 100));
  try {
    studio.addPathLayer(rect()); const original = studio.doc;
    await assert.rejects(studio.importSvg(svg('<script/>'), "Unsafe", async s => parseEditableSvg(s)), /Unsupported/);
    assert.equal(studio.doc, original);
    const next = await studio.importSvg(svg('<rect width="10" height="10"/>'), "Imported", async s => parseEditableSvg(s));
    assert.notEqual(next, original); assert.equal(original.layers.length, 1);
    assert.equal(studio.activeDocumentState().dirty, true);
  } finally { studio.dispose(); }
});

test("simple imported appearance can enter boolean construction without losing its paint", async () => {
  const studio = new Studio(100, 100, testCanvas(100, 100));
  try {
    const doc = await studio.importSvg(svg('<rect id="red" width="60" height="60" fill="#ff0000"/><rect id="blue" x="30" y="30" width="60" height="60" fill="#0000ff"/>'), "Shapes", async s => parseEditableSvg(s));
    const result = await executeVectorBoolean(studio, doc.layers[0].id, doc.layers[1].id, "unite", async (...args) => evaluateBoolean(...args));
    assert.equal(result.path!.fill, "#0000ff"); assert.equal(result.path!.appearance, undefined);
  } finally { studio.dispose(); }
});
