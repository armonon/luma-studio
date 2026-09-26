import type { SpatialLayerStyle } from "./document";

export const DEFAULT_TEXT_SPATIAL: SpatialLayerStyle = {
  schemaVersion: 1,
  enabled: false,
  transform: { rotationX: 0, rotationY: 0, rotationZ: 0, perspective: 24 },
  extrusion: { depth: 18, bevel: 2 },
  material: { frontColor: "#ffffff", sideColor: "#25213a", roughness: 0.35, metalness: 0.05 },
};

export const TEXT_SPATIAL_PRESETS: ReadonlyArray<{ id: string; label: string; style: SpatialLayerStyle }> = [
  { id: "raised", label: "Raised", style: withTextSpatial(undefined, { enabled: true, transform: { rotationX: -12, rotationY: -18 }, extrusion: { depth: 14, bevel: 1 } }) },
  { id: "isometric", label: "Isometric", style: withTextSpatial(undefined, { enabled: true, transform: { rotationX: 30, rotationY: -35, rotationZ: -12 }, extrusion: { depth: 30, bevel: 2 } }) },
  { id: "block", label: "Deep block", style: withTextSpatial(undefined, { enabled: true, transform: { rotationX: -10, rotationY: 28 }, extrusion: { depth: 70, bevel: 0 }, material: { frontColor: "#f5ede1", sideColor: "#bc4d37" } }) },
  { id: "gold", label: "Gold", style: withTextSpatial(undefined, { enabled: true, transform: { rotationY: -20 }, extrusion: { depth: 24, bevel: 3 }, material: { frontColor: "#f9db83", sideColor: "#8c591e", metalness: 0.9, roughness: 0.2 } }) },
  { id: "violet", label: "Violet", style: withTextSpatial(undefined, { enabled: true, transform: { rotationX: -15, rotationY: -25 }, extrusion: { depth: 36, bevel: 2 }, material: { frontColor: "#e9bdff", sideColor: "#6334a8" } }) },
];

const finite = (value: number | undefined, fallback: number) => Number.isFinite(value) ? value! : fallback;
const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));

/** Resolves old or partial documents without mutating their stored metadata. */
export function resolvedTextSpatial(value?: Partial<SpatialLayerStyle> | null): SpatialLayerStyle | null {
  if (!value?.enabled) return null;
  const transform = value.transform ?? DEFAULT_TEXT_SPATIAL.transform;
  const extrusion = value.extrusion ?? DEFAULT_TEXT_SPATIAL.extrusion;
  const material = value.material ?? DEFAULT_TEXT_SPATIAL.material;
  return {
    schemaVersion: 1,
    enabled: true,
    transform: {
      rotationX: clamp(finite(transform.rotationX, 0), -180, 180),
      rotationY: clamp(finite(transform.rotationY, 0), -180, 180),
      rotationZ: clamp(finite(transform.rotationZ, 0), -180, 180),
      perspective: clamp(finite(transform.perspective, 24), 0, 100),
    },
    extrusion: {
      depth: clamp(finite(extrusion.depth, 18), 0, 1000),
      bevel: clamp(finite(extrusion.bevel, 2), 0, 100),
    },
    material: {
      frontColor: material.frontColor || "#ffffff",
      sideColor: material.sideColor || "#25213a",
      roughness: clamp(finite(material.roughness, 0.35), 0, 1),
      metalness: clamp(finite(material.metalness, 0.05), 0, 1),
    },
    ...(value.link ? { link: { ...value.link } } : {}),
  };
}

/**
 * Projects Form's XYZ rotation into Canvas' affine plane around the text anchor.
 * Form Studio consumes the same angles for a true perspective mesh; Luma keeps
 * this preview intentionally affine so ordinary text stays fast and lightweight.
 */
export function textSpatialAffine(style: SpatialLayerStyle, originX: number, originY: number) {
  const rx = style.transform.rotationX * Math.PI / 180;
  const ry = style.transform.rotationY * Math.PI / 180;
  const rz = style.transform.rotationZ * Math.PI / 180;
  const sx = Math.sin(rx); const cx = Math.cos(rx);
  const sy = Math.sin(ry); const cy = Math.cos(ry);
  const sz = Math.sin(rz); const cz = Math.cos(rz);
  const perspective = style.transform.perspective / 260;

  // First two columns of Rz * Ry * Rx, followed by a bounded oblique
  // projection of Z. This produces stable interactive tilt without a WebGL
  // dependency or document-sized intermediate texture.
  const xX = cz * cy; const xY = sz * cy; const xZ = -sy;
  const yX = cz * sy * sx - sz * cx;
  const yY = sz * sy * sx + cz * cx;
  const yZ = cy * sx;
  const a = xX + xZ * perspective;
  const b = xY - xZ * perspective * 0.58;
  const c = yX + yZ * perspective;
  const d = yY - yZ * perspective * 0.58;
  return {
    a, b, c, d,
    e: originX - a * originX - c * originY,
    f: originY - b * originX - d * originY,
  };
}

export function withTextSpatial(
  current: SpatialLayerStyle | undefined,
  patch: Partial<Omit<SpatialLayerStyle, "transform" | "extrusion" | "material">> & {
    transform?: Partial<SpatialLayerStyle["transform"]>;
    extrusion?: Partial<SpatialLayerStyle["extrusion"]>;
    material?: Partial<SpatialLayerStyle["material"]>;
  },
): SpatialLayerStyle {
  const base = current ?? DEFAULT_TEXT_SPATIAL;
  return {
    ...base,
    ...patch,
    schemaVersion: 1,
    transform: { ...base.transform, ...patch.transform },
    extrusion: { ...base.extrusion, ...patch.extrusion },
    material: { ...base.material, ...patch.material },
    ...(patch.link === undefined ? { link: base.link } : {}),
  };
}

export function cloneSpatialStyle(style: SpatialLayerStyle | undefined) {
  return style ? {
    ...style,
    transform: { ...style.transform },
    extrusion: { ...style.extrusion },
    material: { ...style.material },
    link: style.link ? { ...style.link } : undefined,
  } : undefined;
}
