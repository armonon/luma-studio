import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, rgb } from "pdf-lib";
import { DOMMatrix, Path2D } from "@napi-rs/canvas";
import { importPdfObjects, pdfObjectOperators } from "../app/engine/pdf-object-import.ts";
import { Studio } from "../app/engine/studio.ts";
import { testCanvas } from "./canvas-harness.ts";
import { decodeLumaProject } from "../app/engine/project.ts";
Object.assign(globalThis, { DOMMatrix, Path2D });
const options = { workerSrc: new URL("../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs", import.meta.url).href, resourceBase: new URL("../node_modules/pdfjs-dist/", import.meta.url).pathname, plan: pdfObjectOperators };
await import(options.workerSrc);
async function fixture() {
  const pdf = await PDFDocument.create(), page = pdf.addPage([300, 200]);
  page.drawRectangle({ x: 5, y: 5, width: 80, height: 60, color: rgb(1, 0, 0) });
  page.drawText("Editable PDF", { x: 20, y: 120, size: 24, color: rgb(0, 0, 1) });
  const canvas = testCanvas(20, 20), context = canvas.getContext("2d")!; context.fillStyle = "#00ff00"; context.fillRect(0, 0, 20, 20);
  page.drawImage(await pdf.embedPng(canvas.toDataURL()), { x: 30, y: 30, width: 40, height: 40 });
  return (await pdf.save()).buffer as ArrayBuffer;
}

test("PDF text/images/paths become separate editable layers in paint order", async () => {
  const result = await importPdfObjects(await fixture(), 1, "Lato", options);
  assert.deepEqual(result.layers.map(layer => layer.kind), ["image", "text", "path"]);
  const text = result.layers[1]; assert.equal(text.kind, "text");
  if (text.kind !== "text") return;
  assert.equal(text.text.text, "Editable PDF"); assert.match(text.text.font, /Lato/);
  assert.equal(text.transform.tx, 20); assert.equal(text.transform.ty, 80); assert.equal(text.transform.sy, 1);
  const image = result.layers[0]; assert.equal(image.kind, "image"); if (image.kind !== "image") return;
  assert.equal(image.transform.tx, 30); assert.equal(image.transform.ty, 130); assert.equal(image.transform.sx, 2);
  assert.deepEqual([...image.canvas!.getContext("2d")!.getImageData(2, 2, 1, 1).data], [0, 255, 0, 255]);
});

test("PDF reconstructed objects edit, undo and save/reopen without flattening", async () => {
  const studio = new Studio(64, 64, testCanvas(64, 64));
  try {
    await studio.importPdfObjects(await fixture(), 1, "Lato", "PDF objects", (b, p, f) => importPdfObjects(b, p, f, options));
    const layer = studio.doc.layers.find(layer => layer.text)!;
    studio.updateText(layer.id, { text: "Edited in Luma" }); assert.equal(layer.text!.text, "Edited in Luma");
    studio.undo(); assert.equal(studio.findLayer(layer.id)!.text!.text, "Editable PDF"); studio.redo();
    const reopened = await decodeLumaProject((await studio.prepareProjectSave()).blob);
    assert.deepEqual(reopened.doc.layers.map(layer => layer.kind), ["raster", "text", "path"]);
    assert.equal(reopened.doc.layers.find(layer => layer.text)!.text!.text, "Edited in Luma");
    const current = studio.doc;
    await assert.rejects(studio.importPdfObjects(new ArrayBuffer(9 * 1024 * 1024), 1, "Lato", "bad", (b, p, f) => importPdfObjects(b, p, f, options)), /8 MiB/);
    assert.equal(studio.doc, current);
  } finally { studio.dispose(); }
});

test("object planner refuses clipping, vertical fonts and missing Unicode rather than losing content", () => {
  const ops = { beginText: 1, setFont: 2, showText: 3, endText: 4, setTextRenderingMode: 5 };
  const list = { fnArray: [1, 2, 3, 4], argsArray: [[], ["font", 20], [[{ unicode: "A", width: 600 }]], []] };
  const viewport = { width: 300, height: 200, transform: [1, 0, 0, -1, 0, 200] };
  assert.throws(() => pdfObjectOperators(list, viewport, ops, "Lato", new Map([["font", { vertical: true }]])), /Vertical/);
  const bad = structuredClone(list); bad.argsArray[2] = [[{ unicode: "", width: 600 }]];
  assert.throws(() => pdfObjectOperators(bad, viewport, ops, "Lato", new Map([["font", {}]])), /Unicode/);
  assert.throws(() => pdfObjectOperators({ fnArray: [5], argsArray: [[7]] }, viewport, ops, "Lato", new Map()), /clipped/);
});
