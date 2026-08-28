import assert from "node:assert/strict";
import test from "node:test";
import "./canvas-harness.ts";
import type { Psd } from "ag-psd";
import { readPsd, writePsd } from "../app/engine/ag-psd-io.ts";
import { exportPsd, importPsd } from "../app/engine/psd.ts";
import { newCanvas } from "../app/engine/document.ts";
import { renderClean } from "../app/engine/renderer.ts";
import { layerMaskSurface, setLayerMaskFromCanvas } from "../app/engine/layer-mask.ts";
import { Studio } from "../app/engine/studio.ts";
import { pixelAt, solidCanvas } from "./canvas-harness.ts";

test("PSD layers retain local bounds instead of allocating one document canvas per layer", async () => {
  const source = writePsd({
    width: 80,
    height: 60,
    children: [{ name: "Local", canvas: solidCanvas(7, 5, "#cc3311"), left: 31, top: 22 }],
  } as Psd, { noBackground: true });
  const doc = await importPsd(source);
  const layer = doc.layers[0];
  assert.equal(layer.bitmap?.width, 7);
  assert.equal(layer.bitmap?.height, 5);
  assert.equal(layer.transform.tx, 31);
  assert.equal(layer.transform.ty, 22);

  const rendered = newCanvas(80, 60);
  renderClean(doc, rendered);
  assert.deepEqual(pixelAt(rendered, 33, 24), { r: 204, g: 51, b: 17, a: 255 });
  assert.deepEqual(pixelAt(rendered, 5, 5), { r: 0, g: 0, b: 0, a: 0 });

  layer.name = "Local edited";
  const encoded = exportPsd(doc);
  const encodedLayer = readPsd(encoded).children?.[0];
  assert.equal(encodedLayer?.left, 31);
  assert.equal(encodedLayer?.top, 22);
  assert.equal(encodedLayer?.canvas?.width, 7);
  assert.equal(encodedLayer?.canvas?.height, 5);

  const reopened = await importPsd(encoded);
  const rerendered = newCanvas(80, 60);
  renderClean(reopened, rerendered);
  assert.deepEqual(pixelAt(rerendered, 33, 24), { r: 204, g: 51, b: 17, a: 255 });
});

test("a soft layer mask survives a PSD round trip, applied exactly once", async () => {
  // ag-psd writes the mask from channel 0 (red), but Luma's alpha surfaces put
  // coverage in the ALPHA channel with white RGB — so every exported mask used
  // to read back as reveal-all. The composite still looked right because the
  // mask was also baked into the layer's pixels, which both hid the loss and
  // would have made a corrected mask apply twice (50% reopening at 25%).
  const studio = new Studio(64, 48, newCanvas(8, 8));
  const layer = studio.addBlankRaster("masked");
  const paint = layer.bitmap!.getContext("2d")!;
  paint.fillStyle = "#ff0000";
  paint.fillRect(0, 0, 64, 48);

  const mask = newCanvas(64, 48);
  const maskContext = mask.getContext("2d")!;
  maskContext.fillStyle = "rgba(255,255,255,0.5)";
  maskContext.fillRect(0, 0, 64, 48);
  setLayerMaskFromCanvas(layer, mask, 64, 48);

  const before = layerMaskSurface(layer, 64, 48)!.sample(35, 25);
  assert.ok(Math.abs(before - 127) <= 2, `precondition: mask is ~50%, got ${before}`);

  const reopened = await importPsd(exportPsd(studio.doc));
  const restored = reopened.layers.find((entry) => entry.maskSurface || entry.mask);
  assert.ok(restored, "the masked layer should come back carrying a mask");

  const after = layerMaskSurface(restored, reopened.width, reopened.height)!.sample(35, 25);
  assert.ok(
    Math.abs(after - before) <= 2,
    `mask coverage must survive the round trip: ${before} -> ${after}`,
  );
});
