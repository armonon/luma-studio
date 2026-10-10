import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { assertProjectDecodeAdmission, decodeLumaProject } from "../app/engine/project";
import { Studio } from "../app/engine/studio";
import { testCanvas } from "./canvas-harness";

const asset = "assets/precision/repeated.bin";
const layer = () => ({ surface: { width: 256, height: 256, format: "rgba8", colorSpace: "srgb", tileSize: 256, tiles: [{ key: "0:0", asset }] } });

test("serial precision surfaces retain every tile but share bounded decoder scratch", async () => {
  const size = 256 * 256 * 4;
  const zip = new JSZip(); zip.file(asset, new Uint8Array(size));
  const loaded = await JSZip.loadAsync(await zip.generateAsync({ type: "uint8array" }));
  const manifest = { format: "luma-project", document: { layers: Array.from({ length: 10 }, layer) } };
  const cost = await assertProjectDecodeAdmission(loaded, manifest);
  assert.equal(cost, size * 13, "ten retained tile copies plus three serial scratch buffers");
  await assert.rejects(assertProjectDecodeAdmission(loaded, manifest, cost - 1), /memory ceiling/);
  const disguised = { format: "luma-project", arbitrary: { layers: Array.from({ length: 10 }, layer) } };
  assert.equal(await assertProjectDecodeAdmission(loaded, disguised), size * 40, "unrecognized metadata cannot claim a serial decoder discount");
  const mixed = { ...manifest, opaque: asset };
  assert.equal(await assertProjectDecodeAdmission(loaded, mixed), cost + size * 4, "an opaque reference to the same asset keeps its independent conservative bound");
});

test("2048px layered group/ungroup history saves within unchanged admission and restores independent pixels", async () => {
  const studio = new Studio(2048, 1536, testCanvas(1, 1));
  try {
    const a = studio.addBlankRaster("Source"); studio.fillLayer(a.id, "red");
    const b = studio.addBlankRaster("Overlay"); studio.fillLayer(b.id, "blue");
    const group = studio.groupLayers([a.id, b.id]); studio.ungroupLayers([group.id]);
    const before = studio.historyState();
    const saved = await studio.prepareProjectSave();
    const reopened = await decodeLumaProject(saved.blob);
    assert.equal(reopened.history!.snapshot().nodes.length, before.nodes.length);
    const current = reopened.doc.layers.find(l => l.id === a.id)!;
    const groupHistory = reopened.history!.snapshot().nodes.find(n => n.value?.label === "Layers grouped")!.value!;
    const historical = groupHistory.layersBefore!.find(l => l.id === a.id)!;
    const original = historical.surface!.store.read("0:0")!;
    const changed = current.surface!.store.read("0:0")!; changed[0] = 17;
    current.surface!.store.write("0:0", changed);
    assert.deepEqual(historical.surface!.store.read("0:0"), original, "mutable active tiles must not alias undo history");
    assert.notEqual(current.bitmap, historical.bitmap, "mutable bitmap backing stores remain independent");
  } finally { studio.dispose(); }
});
