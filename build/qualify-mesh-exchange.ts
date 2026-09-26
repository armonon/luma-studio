import { mkdir, writeFile } from "node:fs/promises";
import * as THREE from "three";
import { formMeshFromObject, createFormMesh, disposeFormMesh } from "../app/engine/form-mesh-geometry.ts";
import { parseFormMesh } from "../app/engine/form-mesh-asset.ts";

const root = new THREE.Group(); root.name = "Mesh round-trip QA"; root.userData.editorId = "mesh-roundtrip-qa";
const mesh = new THREE.Mesh(new THREE.TorusKnotGeometry(1, 0.3, 64, 12), new THREE.MeshPhysicalMaterial({ color: "#e7a747", roughness: 0.35, metalness: 0.25, clearcoat: 0.2 }));
root.add(mesh); root.rotation.set(0.3, 0.2, 0);
const asset = formMeshFromObject(root);
const returned = createFormMesh(parseFormMesh(JSON.stringify(asset)));
try {
  const geometry = (returned.children[0] as THREE.Mesh).geometry;
  const positions = geometry.getAttribute("position"); positions.setY(0, positions.getY(0) + 0.2); geometry.computeVertexNormals();
  const edited = formMeshFromObject(returned);
  await mkdir("artifacts/vector-qualification", { recursive: true });
  await writeFile("artifacts/vector-qualification/mesh-roundtrip-source.lumaformmesh", JSON.stringify(asset));
  await writeFile("artifacts/vector-qualification/mesh-roundtrip-edited.lumaformmesh", JSON.stringify(edited));
  console.log(JSON.stringify({ vertices: edited.parts.reduce((n, part) => n + part.positions.length / 3, 0), triangles: edited.parts.reduce((n, part) => n + part.indices.length / 3, 0), bytes: JSON.stringify(edited).length, geometryEditRetained: asset.parts[0].positions[1] !== edited.parts[0].positions[1] }, null, 2));
} finally { disposeFormMesh(root); disposeFormMesh(returned); }
