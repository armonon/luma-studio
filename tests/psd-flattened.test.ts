import assert from "node:assert/strict";
import test from "node:test";
import "./canvas-harness.ts";
import type { Psd } from "ag-psd";
import { writePsd } from "../app/engine/ag-psd-io.ts";
import { importPsd } from "../app/engine/psd.ts";
import { getPhotoshopDocumentMetadata } from "../app/engine/psd-metadata.ts";
import { pixelAt, solidCanvas } from "./canvas-harness.ts";

test("a flattened PSD imports its composite instead of opening as an empty document", async () => {
  const canvas = solidCanvas(12, 8, "#336699");
  const layered = writePsd({ width: 12, height: 8, canvas, children: [] } as Psd);
  const view = new DataView(layered);
  let layerOffset = 26;
  for (let section = 0; section < 2; section += 1) {
    const length = view.getUint32(layerOffset, false);
    layerOffset += 4 + length;
  }
  const layerLength = view.getUint32(layerOffset, false);
  const compositeOffset = layerOffset + 4 + layerLength;
  const flattened = new Uint8Array(layered.byteLength - layerLength);
  flattened.set(new Uint8Array(layered, 0, layerOffset), 0);
  flattened.set(new Uint8Array(layered, compositeOffset), layerOffset + 4);
  const doc = await importPsd(flattened.buffer);
  assert.equal(doc.layers.length, 1);
  assert.equal(doc.layers[0].name, "Background");
  assert.deepEqual(pixelAt(doc.layers[0].bitmap!, 4, 3), { r: 51, g: 102, b: 153, a: 255 });
  assert.ok(getPhotoshopDocumentMetadata(doc)?.importedIssues.some((issue) => issue.code === "FLATTENED_COMPOSITE_IMPORTED"));
});
