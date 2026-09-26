import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { formMeshFromObject, createFormMesh, disposeFormMesh } from "../app/engine/form-mesh-geometry.ts";
import { parseFormMesh, validateFormMesh, meshAssetBytes } from "../app/engine/form-mesh-asset.ts";
import { Studio } from "../app/engine/studio.ts";
import { testCanvas } from "./canvas-harness.ts";
import { decodeLumaProject } from "../app/engine/project.ts";
import { smartContentUnavailableReason } from "../app/engine/smart-object-content.ts";

function fixture() {
  const root = new THREE.Group(); root.name = "Edited mesh"; root.userData.editorId = "mesh-identity";
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 4), new THREE.MeshStandardMaterial({ color: "#4477aa", roughness: 0.4, metalness: 0.1 }));
  root.add(mesh); return root;
}
const render = async () => testCanvas(1600, 1200);

test("Luma and Form share identical bounded mesh contracts and constructors", () => {
  const here = readFileSync(new URL("../app/engine/form-mesh-asset.ts", import.meta.url), "utf8");
  const there = readFileSync(new URL("../../sculptor-studio/app/luma-mesh-asset.ts", import.meta.url), "utf8");
  assert.equal(here, there);
});

test("edited topology, mirrored transforms and materials survive repeated exchange", () => {
  const root = fixture(); root.scale.x = -1; root.position.set(3, 4, 5);
  const source = root.children[0] as THREE.Mesh;
  source.geometry.getAttribute("position").setY(0, 8); source.geometry.computeVertexNormals();
  try {
    const asset = formMeshFromObject(root), restored = createFormMesh(parseFormMesh(JSON.stringify(asset)));
    try {
      const returned = formMeshFromObject(restored);
      assert.equal(returned.id, asset.id); assert.equal(returned.parts.length, asset.parts.length);
      const triangles = (part: typeof asset.parts[number]) => part.indices.flatMap(i => part.positions.slice(i * 3, i * 3 + 3));
      const normals = (part: typeof asset.parts[number]) => part.indices.flatMap(i => part.normals.slice(i * 3, i * 3 + 3));
      for (let i = 0; i < asset.parts.length; i++) {
        assert.deepEqual(triangles(returned.parts[i]), triangles(asset.parts[i]));
        const expected = normals(asset.parts[i]);
        assert.ok(normals(returned.parts[i]).every((n, j) => Math.abs(n - expected[j]) < 1e-6));
        assert.deepEqual(returned.parts[i].material, asset.parts[i].material);
      }
      assert.ok(asset.parts.some(part => part.positions.some(n => n === 12)));
      assert.equal(asset.parts[0].material.color, "#4477aa");
      assert.ok(meshAssetBytes(asset) > JSON.stringify(asset).length * 4);
    } finally { disposeFormMesh(restored); }
  } finally { disposeFormMesh(root); }
});

test("mesh source, view edit, project reopen and undo preserve authoritative geometry", async () => {
  const root = fixture(), asset = formMeshFromObject(root); disposeFormMesh(root);
  const studio = new Studio(64, 64, testCanvas(64, 64));
  try {
    const old = studio.doc;
    await assert.rejects(studio.importFormMesh("{}", render), /Invalid/); assert.equal(studio.doc, old);
    await studio.importFormMesh(JSON.stringify(asset), render);
    const layer = studio.doc.layers[0], updated = structuredClone(asset); updated.rotation[1] = 35;
    assert.match(smartContentUnavailableReason(studio.doc, layer)!, /mesh editor/);
    await studio.updateFormMesh(layer.id, updated, render); assert.equal(layer.mesh3d!.rotation[1], 35);
    studio.undo(); assert.equal(studio.findLayer(layer.id)!.mesh3d!.rotation[1], 0);
    studio.redo(); assert.equal(studio.findLayer(layer.id)!.mesh3d!.rotation[1], 35);
    const reopened = await decodeLumaProject((await studio.prepareProjectSave()).blob);
    assert.deepEqual(reopened.doc.layers[0].mesh3d, updated);
    const active = studio.findLayer(layer.id)!; active.locked = true;
    await assert.rejects(studio.updateFormMesh(layer.id, asset, render), /unlocked/);
  } finally { studio.dispose(); }
});

test("mesh malformed indices, invalid materials and excessive buffers fail before render", () => {
  const root = fixture(), asset = formMeshFromObject(root); disposeFormMesh(root);
  const invalid = structuredClone(asset); invalid.parts[0].indices[0] = 999999;
  assert.throws(() => validateFormMesh(invalid), /indices/);
  invalid.parts[0].indices[0] = 0; invalid.rotation[0] = NaN;
  assert.throws(() => validateFormMesh(invalid), /Invalid/);
  assert.throws(() => parseFormMesh("x".repeat(8 * 1024 * 1024 + 1)), /8 MiB/);
  const textured = fixture(); (textured.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>).material.map = new THREE.Texture();
  assert.throws(() => formMeshFromObject(textured), /textures/); disposeFormMesh(textured);
});

test("stale asynchronous mesh render cannot overwrite a newer document revision", async () => {
  const root = fixture(), asset = formMeshFromObject(root); disposeFormMesh(root);
  const studio = new Studio(64, 64, testCanvas(64, 64));
  try {
    await studio.importFormMesh(JSON.stringify(asset), render);
    const layer = studio.doc.layers[0], updated = structuredClone(asset); updated.rotation[0] = 45;
    let finish!: (canvas: HTMLCanvasElement) => void;
    const pending = studio.updateFormMesh(layer.id, updated, () => new Promise(resolve => { finish = resolve; }));
    studio.addTextLayer("new edit"); finish(await render());
    await assert.rejects(pending, /Document changed/); assert.equal(layer.mesh3d!.rotation[0], 0);
  } finally { studio.dispose(); }
});
