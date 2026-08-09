import assert from "node:assert/strict";
import test from "node:test";
import { solidCanvas, testCanvas } from "./canvas-harness.ts";
import { createRasterLayer } from "../app/engine/document.ts";
import { Studio } from "../app/engine/studio.ts";

test("layer comps capture, apply, recapture, and remove visible document states", () => {
  const studio = new Studio(32, 32, testCanvas(32, 32));
  const top = createRasterLayer("Top", solidCanvas(32, 32, "#f00"));
  const bottom = createRasterLayer("Bottom", solidCanvas(32, 32, "#00f"));
  top.opacity = 0.65;
  top.transform.tx = 7;
  studio.doc.layers = [top, bottom];

  const comp = studio.captureLayerComp("Hero state");
  top.visible = false;
  top.opacity = 0.1;
  top.transform.tx = 99;
  assert.equal(studio.applyLayerComp(comp.id), true);
  assert.equal(top.visible, true);
  assert.equal(top.opacity, 0.65);
  assert.equal(top.transform.tx, 7);

  top.visible = false;
  assert.equal(studio.recaptureLayerComp(comp.id), true);
  top.visible = true;
  assert.equal(studio.applyLayerComp(comp.id), true);
  assert.equal(top.visible, false);
  assert.equal(studio.removeLayerComp(comp.id), true);
  assert.deepEqual(studio.doc.layerComps, []);
  studio.dispose();
});

test("artboards clamp to document bounds and remain independent named export regions", () => {
  const studio = new Studio(100, 80, testCanvas(100, 80));
  const artboard = studio.createArtboard("Selection crop", { x: -10, y: 12, width: 55, height: 90 });
  assert.deepEqual(artboard, {
    id: artboard.id,
    name: "Selection crop",
    x: 0,
    y: 12,
    width: 45,
    height: 68,
  });
  assert.equal(studio.doc.artboards?.length, 1);
  assert.equal(studio.removeArtboard(artboard.id), true);
  assert.deepEqual(studio.doc.artboards, []);
  studio.dispose();
});
