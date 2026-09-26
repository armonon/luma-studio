import test from "node:test";
import assert from "node:assert/strict";
import "./canvas-harness.ts";
import { readPsd, writePsd } from "../app/engine/ag-psd-io.ts";
import { importPsd, exportPhotoshopDocument } from "../app/engine/psd.ts";
import { encodeLumaProject, decodeLumaProject } from "../app/engine/project.ts";
import { getPhotoshopDocumentMetadata, getPhotoshopLayerMetadata } from "../app/engine/psd-metadata.ts";

for (const psb of [false, true]) test(`unchanged imported text keeps its independent raster preview through native reopen (${psb ? "PSB" : "PSD"})`, async () => {
  const data = new Uint8ClampedArray(8 * 8 * 4);
  for (let i = 0; i < data.length; i += 4) data.set([200, 80, 30, 255], i);
  const source = writePsd({ width: 32, height: 32, children: [{ name: "External text", left: 2, top: 3,
    imageData: { width: 8, height: 8, data }, text: { text: "Original", transform: [1, 0, 0, 1, 2, 11],
      style: { font: { name: "UnavailableFixtureFont" }, fontSize: 8 } } }] }, { psb, noBackground: true });
  const doc = await importPsd(source);
  doc.layers[0].opacity = .97;
  const reopened = (await decodeLumaProject(await encodeLumaProject(doc, [], "Preview retention"))).doc;
  const result = exportPhotoshopDocument(reopened, { format: psb ? "psb" : "psd" });
  const layer = readPsd(result.buffer, { useImageData: true }).children![0];
  assert.deepEqual([layer.left, layer.top, layer.imageData?.width, layer.imageData?.height], [2, 3, 8, 8]);
  assert.deepEqual(layer.imageData?.data, data);
  assert.equal(layer.text?.text, "Original");
  const retained = getPhotoshopLayerMetadata(reopened.layers[0])?.source.rawData;
  assert.ok(retained?.channels.length);
  assert.ok(retained.channels.every(channel => !channel.data || channel.data.buffer === getPhotoshopDocumentMetadata(reopened)?.originalSource?.buffer), "compressed views share the retained source, not duplicate pixels");
  reopened.layers[0].text!.text = "Changed";
  const edited = exportPhotoshopDocument(reopened, { format: psb ? "psb" : "psd" });
  assert.ok(edited.report.issues.some(issue => issue.code === "IMPORTED_TEXT_PREVIEW_REGENERATED"));
  assert.equal(readPsd(edited.buffer).children![0].text?.text, "Changed");
});
