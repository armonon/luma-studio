import type { Layer, PathStyle, ShapeStyle, SpatialLayerStyle } from "./document";
import { formTextAssetFromLayer, type LumaFormTextAsset } from "./form-studio-bridge";
import { withTextSpatial } from "./text-3d";

export const LUMA_FORM_SPATIAL_SCHEMA = "luma-form/spatial-object@1" as const;
export const LUMA_FORM_SPATIAL_LIMITS = { bytes: 16 * 1024 * 1024, previewBytes: 12 * 1024 * 1024, anchors: 250_000 } as const;

export type LumaFormSpatialContent =
  | { kind: "typography"; asset: LumaFormTextAsset }
  | { kind: "shape"; shape: ShapeStyle }
  | { kind: "path"; path: PathStyle }
  | { kind: "image-plane"; width: number; height: number; pngDataUrl?: string }
  | { kind: "adjustment-pass"; adjustment: Layer["kind"]; parameters: Record<string, unknown> }
  | { kind: "scene-group"; childLayerIds: string[] };

export type LumaFormSpatialAsset = {
  schema: typeof LUMA_FORM_SPATIAL_SCHEMA;
  id: string;
  name: string;
  source: { application: "luma-studio"; layerId: string; layerKind: Layer["kind"] };
  content: LumaFormSpatialContent;
  spatial: SpatialLayerStyle;
  suggestedOperations: string[];
  warnings: string[];
  updatedAt: number;
};

const adjustmentParameters = (layer: Layer): Record<string, unknown> => ({
  ...(layer.tone ? { tone: { ...layer.tone } } : {}),
  ...(layer.curves ? { curves: structuredClone(layer.curves) } : {}),
  ...(layer.levels ? { levels: { ...layer.levels } } : {}),
  ...(layer.hsl ? { hsl: { ...layer.hsl } } : {}),
  ...(layer.proAdjustment ? { proAdjustment: structuredClone(layer.proAdjustment) } : {}),
});

export function formSpatialAssetFromLayer(layer: Layer, suggestedOperations: readonly string[] = [], now = Date.now()): LumaFormSpatialAsset {
  if (layer.path?.contours?.length || layer.path?.appearance || layer.path?.symbolId) throw new Error("Form spatial interchange does not yet support compound contours, appearance stacks, or linked instances. Keep this object in Luma or export SVG.");
  const warnings: string[] = [];
  let content: LumaFormSpatialContent;
  if (layer.kind === "text" && layer.text) content = { kind: "typography", asset: formTextAssetFromLayer(layer, now) };
  else if (layer.kind === "shape" && layer.shape) content = { kind: "shape", shape: { ...layer.shape } };
  else if (layer.kind === "path" && layer.path) content = { kind: "path", path: structuredClone(layer.path) };
  else if ((layer.kind === "raster" || layer.kind === "smart-object") && layer.bitmap) {
    let pngDataUrl: string | undefined;
    try {
      const candidate = layer.bitmap.toDataURL("image/png");
      if (candidate.length * 0.75 <= LUMA_FORM_SPATIAL_LIMITS.previewBytes) pngDataUrl = candidate;
      else warnings.push("The embedded image preview exceeded 12 MB; Form will create a linked placeholder.");
    } catch {
      warnings.push("The image preview could not be embedded; Form will create a linked placeholder.");
    }
    content = { kind: "image-plane", width: layer.bitmap.width, height: layer.bitmap.height, pngDataUrl };
  } else if (layer.kind === "group") {
    content = { kind: "scene-group", childLayerIds: [] };
    warnings.push("Group membership is resolved by the receiving project link.");
  } else content = { kind: "adjustment-pass", adjustment: layer.kind, parameters: adjustmentParameters(layer) };
  return {
    schema: LUMA_FORM_SPATIAL_SCHEMA,
    id: `luma-spatial-${layer.id}`,
    name: layer.name,
    source: { application: "luma-studio", layerId: layer.id, layerKind: layer.kind },
    content,
    spatial: withTextSpatial(layer.spatial ?? layer.text?.spatial, { enabled: true }),
    suggestedOperations: [...new Set(suggestedOperations)].slice(0, 32),
    warnings,
    updatedAt: now,
  };
}

export function serializeFormSpatialAsset(asset: LumaFormSpatialAsset) {
  const source = `${JSON.stringify(asset, null, 2)}\n`;
  if (new TextEncoder().encode(source).byteLength > LUMA_FORM_SPATIAL_LIMITS.bytes) throw new Error("Spatial asset exceeds the 16 MB interchange limit");
  return source;
}

export function parseFormSpatialAsset(source: string): LumaFormSpatialAsset {
  if (new TextEncoder().encode(source).byteLength > LUMA_FORM_SPATIAL_LIMITS.bytes) throw new Error("Spatial asset exceeds the 16 MB interchange limit");
  const value = JSON.parse(source) as Partial<LumaFormSpatialAsset>;
  if (value.schema !== LUMA_FORM_SPATIAL_SCHEMA || typeof value.id !== "string" || typeof value.name !== "string" || !value.content || !value.spatial) throw new Error("Unsupported Luma spatial asset");
  if (value.content.kind === "path" && value.content.path.anchors.length > LUMA_FORM_SPATIAL_LIMITS.anchors) throw new Error("Spatial path has too many anchors");
  return value as LumaFormSpatialAsset;
}
