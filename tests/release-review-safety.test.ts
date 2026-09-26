import test from "node:test";
import assert from "node:assert/strict";
import "./canvas-harness";
import { Studio } from "../app/engine/studio";
import { createDocument, newCanvas } from "../app/engine/document";
import { renderViewport } from "../app/engine/renderer";
import { encodeLumaProject } from "../app/engine/project";

test("document switches and opens roll back unfinished property previews without losing undo", async () => {
  const studio = new Studio(32, 32, newCanvas(32, 32));
  try {
    const layer = studio.addBlankRaster("First");
    const first = studio.activeDocumentState().id;
    studio.markDocumentSaved();
    studio.liveUpdateLayerProp(layer.id, "opacity", 0.2);
    studio.liveUpdateGlobalLight({ angle: 42 });
    await studio.importProject(await encodeLumaProject(createDocument(32, 32), [], "Second"));
    const second = studio.activeDocumentState().id;
    studio.switchDocument(first);
    assert.equal(studio.findLayer(layer.id)!.opacity, 1);
    assert.notEqual(studio.doc.globalLight?.angle, 42);
    assert.equal(studio.activeDocumentState().dirty, false);
    studio.liveUpdateLayerProp(layer.id, "opacity", 0.3);
    studio.switchDocument(second); studio.switchDocument(first);
    assert.equal(studio.findLayer(layer.id)!.opacity, 1);
    studio.setLayerProp(layer.id, "opacity", 0.4);
    studio.undo(); assert.equal(studio.findLayer(layer.id)!.opacity, 1);
    studio.redo(); assert.equal(studio.findLayer(layer.id)!.opacity, 0.4);
  } finally { studio.dispose(); }
});

test("closing an inactive or missing tab does not cancel the active paint gesture", async () => {
  const studio = new Studio(32, 32, newCanvas(32, 32));
  try {
    studio.addBlankRaster("Other");
    const other = studio.activeDocumentState().id;
    await studio.importProject(await encodeLumaProject(createDocument(32, 32), [], "Active"));
    const active = studio.activeDocumentState().id;
    const layer = studio.addBlankRaster("Painting");
    const brush = { mode: "paint" as const, size: 8, hardness: 1, opacity: 1, color: "#ff0000" };
    studio.beginStroke(layer.id, brush, { x: 8, y: 8, p: 1 });
    assert.equal(layer.surface!.readPixel(8, 8)[3], 1);
    studio.closeDocument("missing-document");
    assert.equal(layer.surface!.readPixel(8, 8)[3], 1, "unknown close must be a no-op");
    studio.closeDocument(other);
    assert.equal(studio.activeDocumentState().id, active);
    assert.equal(layer.surface!.readPixel(8, 8)[3], 1, "closing another tab must not erase this stroke");
    studio.endStroke(layer.id, brush);
    studio.undo(); assert.equal(layer.surface!.readPixel(8, 8)[3], 0);
    studio.redo(); assert.equal(layer.surface!.readPixel(8, 8)[3], 1);
  } finally { studio.dispose(); }
});

for (const format of ["svg", "pdf"] as const) test(`${format} export rejects a document change during asynchronous preparation`, async () => {
  const studio = new Studio(32, 32, newCanvas(32, 32));
  try {
    studio.addShapeLayer({ kind: "rect", x: 1, y: 1, w: 16, h: 16, fill: "#ff0000" });
    const pending = studio.exportVectorDocument(format);
    studio.addBlankRaster("New edit");
    await assert.rejects(pending, /changed|cancel|stale/i);
    assert.equal(studio.doc.layers[0].name, "New edit");
    studio.undo();
    const result = await studio.exportVectorDocument(format);
    assert.ok(result.size > 0);
    assert.equal(result.type, format === "pdf" ? "application/pdf" : "image/svg+xml");
  } finally { studio.dispose(); }
});

test("small frames allocate local pixels, preserve placement and undo in large documents", () => {
  const studio = new Studio(8000, 8000, newCanvas(32, 32));
  try {
    const group = studio.addFrame(7000, 7500, 24, 16)!;
    const content = studio.doc.layers.find(layer => layer.parentId === group.id)!;
    assert.equal(content.bitmap!.width, 24); assert.equal(content.bitmap!.height, 16);
    assert.equal(content.surface!.grid.width, 24);
    assert.equal(content.transform.tx, 7000); assert.equal(content.transform.ty, 7500);
    assert.ok(content.surface!.stats().residentBytes < 2 * 1024 * 1024);
    const canvas = newCanvas(32, 24);
    renderViewport(studio.doc, canvas, { x: 6996, y: 7496, width: 32, height: 24, zoom: 1, outputWidth: 32, outputHeight: 24, cssScale: 1, devicePixelRatio: 1 }, { checkerboard: false, selectionOverlay: false, proofing: false });
    assert.equal(canvas.getContext("2d")!.getImageData(12, 12, 1, 1).data[3], 255);
    assert.equal(canvas.getContext("2d")!.getImageData(0, 0, 1, 1).data[3], 0);
    studio.undo(); assert.equal(studio.doc.layers.length, 0);
    studio.redo(); assert.equal(studio.doc.layers.length, 2);
    const node = studio.historyState().currentId;
    assert.throws(() => studio.addFrame(0, 0, NaN, 10), /finite/);
    assert.throws(() => studio.addFrame(0, 0, 6000, 6000), /memory/);
    assert.equal(studio.historyState().currentId, node);
    assert.equal(studio.doc.layers.length, 2);
  } finally { studio.dispose(); }
});

test("frame preparation failure does not publish a group or consume undo", () => {
  const studio = new Studio(256, 256, newCanvas(32, 32));
  try {
    const node = studio.historyState().currentId;
    const internal = studio as unknown as { syncLayerSurface: (...args: unknown[]) => void };
    const original = internal.syncLayerSurface;
    internal.syncLayerSurface = () => { throw new Error("Injected frame surface failure"); };
    assert.throws(() => studio.addFrame(20, 20, 32, 32), /Injected/);
    assert.equal(studio.doc.layers.length, 0); assert.equal(studio.historyState().currentId, node);
    internal.syncLayerSurface = original;
    const group = studio.addFrame(50, 50, -24, -16, true)!;
    const content = studio.doc.layers.find(layer => layer.parentId === group.id)!;
    assert.equal(content.transform.tx, 26); assert.equal(content.transform.ty, 34);
    assert.equal(content.bitmap!.width, 24); assert.equal(content.bitmap!.height, 16);
    assert.equal(group.maskSurface!.sample(38, 42), 255);
  } finally { studio.dispose(); }
});
