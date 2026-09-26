import test from "node:test";
import assert from "node:assert/strict";
import { testCanvas } from "./canvas-harness.ts";
import { createDocument, createRasterLayer } from "../app/engine/document.ts";
import { PrecisionTileSurface } from "../app/engine/tile-store.ts";
import { drawLayerContentManaged } from "../app/engine/precision-renderer.ts";
import { defaultExportHalo, isProvablyTransparent, exportTiledPng } from "../app/engine/png-stream.ts";
import { loadImage } from "@napi-rs/canvas";

test("viewport traversal never copies master tiles or converts offscreen pixels", () => {
  const surface = new PrecisionTileSurface(50000, 50000);
  const pixel = testCanvas(2, 2).getContext("2d")!.createImageData(2, 2); pixel.data.fill(255);
  surface.updateFromImageData(pixel, 0, 0);
  surface.updateFromImageData(pixel, 40000, 40000);
  const layer = createRasterLayer("Sparse paint"); layer.surface = surface;
  surface.store.entries = () => { throw new Error("Rendering must not clone master pixels"); };
  const convert = surface.tileToRgba8.bind(surface); let converted = 0;
  surface.tileToRgba8 = key => { converted++; return convert(key); };
  const canvas = testCanvas(64, 64);
  drawLayerContentManaged(canvas.getContext("2d")!, layer);
  assert.equal(converted, 1);
  assert.equal(canvas.getContext("2d")!.getImageData(0, 0, 1, 1).data[3], 255);
  layer.transform.tx = -40000; layer.transform.ty = -40000;
  drawLayerContentManaged(canvas.getContext("2d")!, layer);
  assert.equal(converted, 2, "translation brings the second tile into view");
});

test("blank PNG fast path refuses real pixels, bitmap masters and effects", async () => {
  const doc = createDocument(512, 256);
  const layer = createRasterLayer("Blank"); layer.surface = new PrecisionTileSurface(512, 256); doc.layers = [layer];
  assert.equal(isProvablyTransparent(doc), true); assert.equal(defaultExportHalo(doc), 2);
  const png = await exportTiledPng(doc);
  const decoded = await loadImage(Buffer.from(await png.arrayBuffer()));
  const canvas = testCanvas(512, 256); canvas.getContext("2d")!.drawImage(decoded as unknown as CanvasImageSource, 0, 0);
  assert.ok(canvas.getContext("2d")!.getImageData(0, 0, 512, 256).data.every(value => value === 0));
  layer.filters = [{ id: "blur", kind: "blur", enabled: true, opacity: 1, params: { radius: 5 } }];
  assert.equal(isProvablyTransparent(doc), false); assert.equal(defaultExportHalo(doc), 256);
  layer.filters = [];
  layer.bitmap = testCanvas(1, 1); assert.equal(isProvablyTransparent(doc), false); layer.bitmap = undefined;
  const pixel = testCanvas(1, 1).getContext("2d")!.createImageData(1, 1); pixel.data.fill(255);
  layer.surface.updateFromImageData(pixel);
  assert.equal(isProvablyTransparent(doc), false);
});
