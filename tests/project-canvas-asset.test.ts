import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import "./canvas-harness.ts";
import { createDocument, createRasterLayer } from "../app/engine/document.ts";
import { decodeLumaProject, encodeLumaProject } from "../app/engine/project.ts";
import { solidCanvas } from "./canvas-harness.ts";

test("project save accepts native canvas encoders that return typed PNG bytes", async () => {
  const doc = createDocument(12, 8);
  doc.layers = [createRasterLayer("Native canvas", solidCanvas(12, 8, "#336699"))];
  const project = await encodeLumaProject(doc, [], "Canvas archive");
  const zip = await JSZip.loadAsync(await project.arrayBuffer());
  const asset = zip.file("assets/data/000001.png");
  assert.ok(asset);
  const bytes = await asset.async("uint8array");
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const reopened = await decodeLumaProject(project);
  assert.equal(reopened.doc.layers[0].bitmap?.width, 12);
  assert.equal(reopened.doc.layers[0].bitmap?.height, 8);
});
