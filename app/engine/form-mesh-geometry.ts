import * as THREE from "three";
import { validateFormMesh, MESH_EXCHANGE_LIMITS, type FormMeshAsset, type MeshPart } from "./form-mesh-asset";
export function createFormMesh(asset: FormMeshAsset) {
  validateFormMesh(asset);
  const root = new THREE.Group(); root.name = asset.name;
  try {
    for (const p of asset.parts) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(p.positions, 3));
      geometry.setAttribute("normal", new THREE.Float32BufferAttribute(p.normals, 3)); geometry.setIndex(p.indices);
      const material = new THREE.MeshPhysicalMaterial({ ...p.material, transparent: p.material.opacity < 1, side: p.material.side });
      const mesh = new THREE.Mesh(geometry, material); mesh.name = p.name; root.add(mesh);
    }
    root.rotation.set(...asset.rotation.map(n => THREE.MathUtils.degToRad(n)) as [number, number, number]);
    root.userData.editorId = asset.id; root.userData.formMeshIdentity = { id: asset.id, name: asset.name, fov: asset.fov };
    return root;
  } catch (error) { disposeFormMesh(root); throw error; }
}
export function disposeFormMesh(root: THREE.Object3D) {
  root.traverse(object => { if (object instanceof THREE.Mesh) { object.geometry.dispose(); (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => material.dispose()); } });
}
/** Static, solid PBR geometry only. Unsupported material/animation data is refused, not dropped. */
export function formMeshFromObject(root: THREE.Object3D): FormMeshAsset {
  const parts: MeshPart[] = []; let vertices = 0, indices = 0;
  root.updateWorldMatrix(true, true);
  root.traverse(object => {
    if (!object.visible || !(object instanceof THREE.Mesh)) return;
    if (object instanceof THREE.SkinnedMesh || object instanceof THREE.InstancedMesh || object.morphTargetInfluences?.some(Boolean) || Object.keys(object.geometry.morphAttributes).length || object.animations.length) throw new Error("Bake skinning, instances, morphs and animation before mesh exchange.");
    let ancestor: THREE.Object3D | null = object;
    while (ancestor) { if (!ancestor.visible) return; ancestor = ancestor.parent; }
    const original = object.geometry, pos = original.getAttribute("position"), index = original.index;
    const count = index?.count ?? pos?.count ?? 0;
    if (pos?.count > MESH_EXCHANGE_LIMITS.vertices || count > MESH_EXCHANGE_LIMITS.indices) throw new Error("Mesh source exceeds the exchange allocation budget.");
    if (!pos || pos.itemSize !== 3 || !count || count % 3 || original.drawRange.start !== 0 || (Number.isFinite(original.drawRange.count) && original.drawRange.count !== count)) throw new Error("Only complete triangle meshes can be exchanged.");
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    const groups = Array.isArray(object.material) && original.groups.length ? original.groups : [{ start: 0, count, materialIndex: 0 }];
    let end = 0;
    for (const g of groups) { if (g.start !== end || g.count % 3 || g.count <= 0) throw new Error("Overlapping or incomplete material groups cannot be exchanged."); end += g.count; }
    if (end !== count) throw new Error("Incomplete mesh material groups.");
    // Copy per material, compacting referenced vertices instead of duplicating the full object.
    for (const group of groups) {
      if (parts.length >= MESH_EXCHANGE_LIMITS.meshes || indices + group.count > MESH_EXCHANGE_LIMITS.indices) throw new Error("Mesh exchange geometry budget exceeded.");
      const material = materials[group.materialIndex ?? 0];
      if (!(material instanceof THREE.MeshStandardMaterial) || material.vertexColors || material.alphaTest || material.wireframe || material.clippingPlanes?.length ||
        Object.values(material).some(value => value instanceof THREE.Texture) || material.emissive.getHex() !== 0 ||
        (material instanceof THREE.MeshPhysicalMaterial && (material.transmission || material.iridescence || material.anisotropy || material.dispersion))) throw new Error("Mesh exchange supports solid PBR materials; textures, vertex colors, transmission and advanced materials must be baked or removed.");
      const geometry = original.clone();
      try {
        geometry.applyMatrix4(object.matrixWorld);
        if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
        const positions = geometry.getAttribute("position"), normals = geometry.getAttribute("normal"), remap = new Map<number, number>();
        const part: MeshPart = { name: object.name.slice(0, 256), positions: [], normals: [], indices: [],
          material: { color: "#" + material.color.getHexString(), roughness: material.roughness, metalness: material.metalness, opacity: material.opacity, side: material.side } };
        for (let i = group.start; i < group.start + group.count; i++) {
          const source = index ? index.getX(i) : i; let destination = remap.get(source);
          if (destination === undefined) {
            if (++vertices > MESH_EXCHANGE_LIMITS.vertices) throw new Error("Mesh exchange exceeds 60,000 vertices.");
            destination = remap.size; remap.set(source, destination);
            part.positions.push(positions.getX(source), positions.getY(source), positions.getZ(source));
            part.normals.push(normals.getX(source), normals.getY(source), normals.getZ(source));
          }
          part.indices.push(destination);
        }
        Object.assign(part.material, material instanceof THREE.MeshPhysicalMaterial ? { clearcoat: material.clearcoat, clearcoatRoughness: material.clearcoatRoughness, sheen: material.sheen, sheenColor: "#" + material.sheenColor.getHexString(), sheenRoughness: material.sheenRoughness } : { clearcoat: 0, clearcoatRoughness: 0, sheen: 0, sheenColor: "#000000", sheenRoughness: 1 });
        // Reflection changes winding even though the transformed normal is still valid.
        if (object.matrixWorld.determinant() < 0) for (let i = 0; i < part.indices.length; i += 3) [part.indices[i + 1], part.indices[i + 2]] = [part.indices[i + 2], part.indices[i + 1]];
        indices += part.indices.length; parts.push(part);
      } finally { geometry.dispose(); }
    }
  });
  const asset: FormMeshAsset = { schema: "luma-form/mesh-object@1", id: root.userData.formMeshIdentity?.id ?? root.userData.editorId ?? root.uuid,
    name: (root.name || "Form mesh").slice(0, 256), parts, rotation: [0, 0, 0], fov: root.userData.formMeshIdentity?.fov ?? 35, width: 1600, height: 1200 };
  validateFormMesh(asset); return asset;
}
