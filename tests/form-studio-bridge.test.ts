import assert from "node:assert/strict";
import test from "node:test";
import type { Layer } from "../app/engine/document";
import {
  LUMA_FORM_TEXT_SCHEMA,
  formTextAssetFromLayer,
  linkTextLayerToForm,
  parseFormTextAsset,
  serializeFormTextAsset,
} from "../app/engine/form-studio-bridge";
import { DEFAULT_TEXT_SPATIAL, textSpatialAffine, withTextSpatial } from "../app/engine/text-3d";
import { formSpatialAssetFromLayer, parseFormSpatialAsset, serializeFormSpatialAsset } from "../app/engine/form-spatial-bridge";
import { ALL_TOOL_IDS } from "../app/studio/tool-registry";
import { SPATIAL_TOOL_CAPABILITY_MATRIX, spatialOperationIdsForTool } from "../app/studio/spatial-capability-registry";
import { Studio } from "../app/engine/studio";
import { testCanvas } from "./canvas-harness";
import { decodeLumaProject } from "../app/engine/project";

function textLayer(): Layer {
  return {
    id: "type-1",
    name: "Launch title",
    kind: "text",
    visible: true,
    opacity: 1,
    blend: "source-over",
    transform: { tx: 0, ty: 0, sx: 1, sy: 1, rotation: 0 },
    text: {
      schemaVersion: 2,
      text: "Luma × Form",
      font: "700 96px Inter, sans-serif",
      color: "#ffffff",
      align: "left",
      lineHeight: 1.1,
      x: 20,
      y: 120,
      defaultStyle: { fontFamily: "Inter, sans-serif", fontSize: 96, fontWeight: 700, color: "#ffffff" },
      runs: [{ start: 0, end: 4, style: { color: "#75b7ff" } }],
      spatial: withTextSpatial(undefined, { enabled: true, transform: { rotationY: 28 }, extrusion: { depth: 24 } }),
    },
  };
}

test("Luma exports a bounded editable typography asset for Form Studio", () => {
  const layer = textLayer();
  const asset = formTextAssetFromLayer(layer, 1234);
  assert.equal(asset.schema, LUMA_FORM_TEXT_SCHEMA);
  assert.equal(asset.typography.text, "Luma × Form");
  assert.equal(asset.typography.runs?.[0].style.color, "#75b7ff");
  assert.equal(asset.spatial.transform.rotationY, 28);
  assert.deepEqual(parseFormTextAsset(serializeFormTextAsset(asset)), JSON.parse(serializeFormTextAsset(asset)));
  assert.throws(() => parseFormTextAsset("{}"), /Unsupported/);
  assert.throws(() => parseFormTextAsset(JSON.stringify({ ...asset, id: "x".repeat(257) })), /identity/);
  assert.throws(() => parseFormTextAsset(JSON.stringify({ ...asset, typography: { ...asset.typography, font: "invalid" } })), /font format/);
});

test("Form links remain nondestructive metadata on the authoritative text layer", () => {
  const layer = textLayer();
  const asset = formTextAssetFromLayer(layer, 4321);
  const linked = linkTextLayerToForm(layer, asset, { projectId: "form-project-7", revisionId: "rev-4", objectId: "type-object" });
  assert.equal(linked.text, layer.text?.text);
  assert.equal(linked.spatial?.link?.projectId, "form-project-7");
  assert.equal(linked.spatial?.link?.objectId, "type-object");
  assert.equal(linked.spatial?.link?.lastSyncedAt, 4321);
});

test("spatial text projection is finite, anchored and identity-safe", () => {
  assert.equal(textSpatialAffine({ ...DEFAULT_TEXT_SPATIAL, enabled: true }, 50, 70).e, 0);
  const tilted = textSpatialAffine(withTextSpatial(undefined, { enabled: true, transform: { rotationX: 32, rotationY: -41, rotationZ: 12 } }), 50, 70);
  assert.ok(Object.values(tilted).every(Number.isFinite));
  assert.ok(Math.abs(tilted.a * 50 + tilted.c * 70 + tilted.e - 50) < 1e-9);
  assert.ok(Math.abs(tilted.b * 50 + tilted.d * 70 + tilted.f - 70) < 1e-9);
});

test("spatial metadata remains serializable inside an ordinary Luma document", () => {
  const layer = textLayer();
  assert.doesNotThrow(() => JSON.stringify(layer.text?.spatial));
});

test("every registered Luma tool advertises useful spatial operations", () => {
  assert.ok(ALL_TOOL_IDS.length > 50);
  assert.equal(Object.keys(SPATIAL_TOOL_CAPABILITY_MATRIX).length, ALL_TOOL_IDS.length);
  for (const tool of ALL_TOOL_IDS) assert.ok(spatialOperationIdsForTool(tool).length > 0, `${tool} has no spatial operations`);
  assert.ok(spatialOperationIdsForTool("brush").includes("surface-paint"));
  assert.ok(spatialOperationIdsForTool("sel-lasso").includes("volume-mask"));
  assert.ok(spatialOperationIdsForTool("perspective-crop").includes("camera-match"));
});

test("shape layers round-trip through the generalized Form spatial contract", () => {
  const layer: Layer = {
    id: "shape-1", name: "Badge", kind: "shape", visible: true, opacity: 1, blend: "source-over",
    transform: { tx: 0, ty: 0, sx: 1, sy: 1, rotation: 0 },
    shape: { kind: "ellipse", x: 20, y: 20, w: 300, h: 180, fill: "#4488ff", stroke: "#ffffff", strokeWidth: 4, radius: 0 },
  };
  const asset = formSpatialAssetFromLayer(layer, spatialOperationIdsForTool("ellipse"), 5000);
  assert.equal(asset.content.kind, "shape");
  assert.ok(asset.suggestedOperations.includes("extrude"));
  assert.deepEqual(parseFormSpatialAsset(serializeFormSpatialAsset(asset)), JSON.parse(serializeFormSpatialAsset(asset)));
});

test("Form return creates editable text in a separate document and persists it", async () => {
  const studio = new Studio(300, 200, testCanvas(32, 32));
  try {
    studio.addTextLayer("Original work"); const original = studio.doc;
    const asset = formTextAssetFromLayer(textLayer()); asset.spatial.transform.rotationY = 45;
    const result = await studio.importFormText(serializeFormTextAsset(asset));
    assert.notEqual(result, original); assert.equal(original.layers[0].text?.text, "Original work");
    assert.equal(result.layers[0].text?.spatial?.transform.rotationY, 45);
    const reopened = await decodeLumaProject((await studio.prepareProjectSave()).blob);
    assert.equal(reopened.doc.layers[0].text?.text, asset.typography.text);
    assert.equal(reopened.doc.layers[0].text?.spatial?.transform.rotationY, 45);
    assert.equal(formTextAssetFromLayer(reopened.doc.layers[0]).id, asset.id);
    assert.equal(formTextAssetFromLayer(reopened.doc.layers[0]).source.layerId, asset.source.layerId);
    const active = studio.doc;
    await assert.rejects(studio.importFormText(JSON.stringify({ ...asset, typography: { ...asset.typography, runs: [{ start: 0, end: 9999, style: {} }] } })), /range/);
    assert.equal(studio.doc, active);
  } finally { studio.dispose(); }
});
