import { mkdir, writeFile } from "node:fs/promises";
import { PDFDocument, rgb } from "pdf-lib";
import { DOMMatrix, Path2D } from "@napi-rs/canvas";
import { testCanvas } from "../tests/canvas-harness.ts";
import { renderPdfPage } from "../app/engine/pdf-import.ts";
Object.assign(globalThis, { DOMMatrix, Path2D });
const pdf = await PDFDocument.create(), page = pdf.addPage([600, 400]);
page.drawText("LUMA PDF", { x: 40, y: 290, size: 52, color: rgb(0.1, 0.2, 0.3) });
page.drawText("Text + image import", { x: 40, y: 240, size: 24 });
const image = testCanvas(100, 100), context = image.getContext("2d")!;
context.fillStyle = "#2876cc"; context.fillRect(0, 0, 100, 100);
context.fillStyle = "#f4c260"; context.beginPath(); context.arc(50, 50, 30, 0, Math.PI * 2); context.fill();
page.drawImage(await pdf.embedPng(image.toDataURL()), { x: 40, y: 40, width: 150, height: 150 });
const bytes = await pdf.save();
await mkdir("artifacts/vector-qualification", { recursive: true });
await writeFile("artifacts/vector-qualification/text-image-proof.pdf", bytes);
const result = await renderPdfPage(bytes.buffer as ArrayBuffer, 1, 150, {
  workerSrc: new URL("../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs", import.meta.url).href,
  resourceBase: new URL("../node_modules/pdfjs-dist/", import.meta.url).pathname,
});
await writeFile("artifacts/vector-qualification/text-image-proof.png", Buffer.from(result.canvas.toDataURL().split(",")[1], "base64"));
console.log(`Rendered ${result.canvas.width} × ${result.canvas.height} at ${result.ppi} ppi`);
