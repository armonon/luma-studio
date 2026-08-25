import assert from "node:assert/strict";
import test from "node:test";
import "./canvas-harness.ts";
import type { Psd } from "ag-psd";
import { readPsd, writePsd } from "../app/engine/ag-psd-io.ts";
import { exportPsd, importPsd } from "../app/engine/psd.ts";
import { newCanvas } from "../app/engine/document.ts";
import { renderClean } from "../app/engine/renderer.ts";
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
