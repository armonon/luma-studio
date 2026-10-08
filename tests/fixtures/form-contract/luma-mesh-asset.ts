export const MESH_EXCHANGE_LIMITS = { bytes: 8 * 1024 * 1024, meshes: 64, vertices: 60000, indices: 180000 } as const;
export type MeshPart = { name: string; positions: number[]; normals: number[]; indices: number[];
  material: { color: string; roughness: number; metalness: number; opacity: number; side: 0 | 1 | 2;
    clearcoat?: number; clearcoatRoughness?: number; sheen?: number; sheenColor?: string; sheenRoughness?: number } };
export type FormMeshAsset = { schema: "luma-form/mesh-object@1"; id: string; name: string;
  parts: MeshPart[]; rotation: [number, number, number]; fov: number; width: 1600; height: 1200 };
const bounded = (n: unknown, low: number, high: number): n is number => typeof n === "number" && Number.isFinite(n) && n >= low && n <= high;
export function validateFormMesh(value: unknown): asserts value is FormMeshAsset {
  const a = value as FormMeshAsset;
  if (!a || a.schema !== "luma-form/mesh-object@1" || typeof a.id !== "string" || !a.id || a.id.length > 256 ||
    typeof a.name !== "string" || !a.name || a.name.length > 256 || a.width !== 1600 || a.height !== 1200 ||
    !Array.isArray(a.rotation) || a.rotation.length !== 3 || !a.rotation.every(n => bounded(n, -180, 180)) || !bounded(a.fov, 20, 70) ||
    !Array.isArray(a.parts) || !a.parts.length || a.parts.length > MESH_EXCHANGE_LIMITS.meshes) throw new Error("Invalid or oversized Form mesh asset.");
  let vertices = 0, indices = 0;
  for (const p of a.parts) {
    if (!p || typeof p.name !== "string" || p.name.length > 256 || !Array.isArray(p.positions) || !Array.isArray(p.normals) ||
      !Array.isArray(p.indices) || !p.positions.length || p.positions.length % 3 || p.normals.length !== p.positions.length ||
      !p.indices.length || p.indices.length % 3) throw new Error("Invalid triangle mesh buffers.");
    vertices += p.positions.length / 3; indices += p.indices.length;
    if (vertices > MESH_EXCHANGE_LIMITS.vertices || indices > MESH_EXCHANGE_LIMITS.indices) throw new Error("Mesh exceeds 60,000 vertices / 180,000 indices.");
    if (!p.positions.every(n => bounded(n, -1000000, 1000000)) || !p.normals.every(n => bounded(n, -1.001, 1.001)) ||
      !p.indices.every(n => Number.isInteger(n) && n >= 0 && n < p.positions.length / 3)) throw new Error("Invalid mesh coordinates or triangle indices.");
    const m = p.material;
    if (!m || !/^#[0-9a-f]{6}$/i.test(m.color) || !bounded(m.roughness, 0, 1) || !bounded(m.metalness, 0, 1) ||
      !bounded(m.opacity, 0, 1) || ![0, 1, 2].includes(m.side) ||
      [m.clearcoat, m.clearcoatRoughness, m.sheen, m.sheenRoughness].some(n => n !== undefined && !bounded(n, 0, 1)) ||
      m.sheenColor !== undefined && !/^#[0-9a-f]{6}$/i.test(m.sheenColor)) throw new Error("Invalid mesh material.");
  }
  if (new TextEncoder().encode(JSON.stringify(a)).byteLength > MESH_EXCHANGE_LIMITS.bytes) throw new Error("Mesh exchange exceeds 8 MiB.");
}
export function parseFormMesh(source: string): FormMeshAsset {
  if (source.length > MESH_EXCHANGE_LIMITS.bytes || new TextEncoder().encode(source).byteLength > MESH_EXCHANGE_LIMITS.bytes) throw new Error("Mesh exchange exceeds 8 MiB.");
  const value: unknown = JSON.parse(source); validateFormMesh(value); return value;
}
export function meshAssetBytes(asset: FormMeshAsset | undefined) {
  return asset ? JSON.stringify(asset).length * 4 + asset.parts.reduce((n, p) => n + (p.positions.length + p.normals.length + p.indices.length) * 16, 0) : 0;
}
