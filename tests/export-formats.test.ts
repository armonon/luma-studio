import assert from "node:assert/strict";
import test from "node:test";
import "./canvas-harness.ts";
import { Studio } from "../app/engine/studio.ts";
import { testCanvas } from "./canvas-harness.ts";

async function bytes(blob: Blob) {
  return new Uint8Array(await blob.arrayBuffer());
}

test("the desktop raster exporter produces PNG, JPEG, and WebP files", async () => {
  const studio = new Studio(12, 8, testCanvas(12, 8));
  const layer = studio.addBlankRaster("Export proof");
  const context = layer.bitmap!.getContext("2d")!;
  context.fillStyle = "#d95f32";
  context.fillRect(0, 0, 12, 8);

  const png = await studio.exportImage("image/png");
  const jpeg = await studio.exportImage("image/jpeg", 0.9);
  const webp = await studio.exportImage("image/webp", 0.9);

  assert.deepEqual([...await bytes(png.slice(0, 8))], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.deepEqual([...await bytes(jpeg.slice(0, 2))], [255, 216]);
  const webpHeader = await bytes(webp.slice(0, 12));
  assert.equal(new TextDecoder().decode(webpHeader.slice(0, 4)), "RIFF");
  assert.equal(new TextDecoder().decode(webpHeader.slice(8, 12)), "WEBP");
  assert.ok(png.size > 0 && jpeg.size > 0 && webp.size > 0);

  studio.dispose();
});
