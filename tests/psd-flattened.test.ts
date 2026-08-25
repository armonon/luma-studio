import assert from "node:assert/strict";
import test from "node:test";
import "./canvas-harness.ts";
import type { Psd } from "ag-psd";
import { writePsd } from "../app/engine/ag-psd-io.ts";
import { exportPhotoshopDocument, importPsd } from "../app/engine/psd.ts";
import { getPhotoshopDocumentMetadata } from "../app/engine/psd-metadata.ts";
import { decodeLumaProject, encodeLumaProject } from "../app/engine/project.ts";
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

test("a demanding layered PSD can open as a bounded composite while preserving untouched source bytes", async () => {
  const composite = solidCanvas(16, 10, "#285078");
  const child = solidCanvas(16, 10, "#ff8800");
  const layered = writePsd({
    width: 16,
    height: 10,
    canvas: composite,
    children: [{ name: "Editable source layer", canvas: child, left: 0, top: 0, right: 16, bottom: 10 }],
  } as Psd, { noBackground: true });

  const doc = await importPsd(layered, { mode: "flattened" });
  assert.equal(doc.layers.length, 1);
  assert.equal(doc.layers[0].name, "Background");
  assert.deepEqual(pixelAt(doc.layers[0].bitmap!, 5, 4), { r: 40, g: 80, b: 120, a: 255 });
  const issues = getPhotoshopDocumentMetadata(doc)?.importedIssues ?? [];
  assert.ok(issues.some((issue) => issue.code === "LAYERED_COMPOSITE_FALLBACK"));
  assert.ok(issues.some((issue) => issue.code === "LAYERED_COMPOSITE_IMPORTED"));

  const passthrough = exportPhotoshopDocument(doc, { format: "source" });
  assert.deepEqual(new Uint8Array(passthrough.buffer), new Uint8Array(layered));
  assert.ok(passthrough.report.issues.some((issue) => issue.code === "ORIGINAL_SOURCE_PASSTHROUGH"));

  const native = await encodeLumaProject(doc, [], "Fallback preservation");
  const reopened = await decodeLumaProject(await native.arrayBuffer());
  const reopenedPassthrough = exportPhotoshopDocument(reopened.doc, { format: "source" });
  assert.deepEqual(new Uint8Array(reopenedPassthrough.buffer), new Uint8Array(layered));
  assert.ok(reopenedPassthrough.report.issues.some((issue) => issue.code === "ORIGINAL_SOURCE_PASSTHROUGH"));
});
