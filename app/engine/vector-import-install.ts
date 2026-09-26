import { createGroupLayer, createPathLayer, type Layer } from "./document";
import { validateVectorPath } from "./vector-path";
import type { ImportedSvg } from "./vector-svg-import";

/** Validate the complete worker result before touching the active workspace. */
export function materializeImportedVectors(result: ImportedSvg): Layer[] {
  if (!result.layers.length || result.layers.length > 512) throw new Error("Editable vector layer limit exceeded");
  const groups = new Map<string, Layer>();
  const layers = result.layers.map(vector => {
    if (!Number.isFinite(vector.opacity) || vector.opacity < 0 || vector.opacity > 1 || Object.values(vector.transform).some(n => !Number.isFinite(n))) throw new Error("Invalid imported vector state");
    let layer: Layer;
    if (vector.kind === "group") {
      if (!vector.importId || groups.has(vector.importId)) throw new Error("Duplicate or missing imported group identity");
      layer = createGroupLayer(vector.name); groups.set(vector.importId, layer);
    } else {
      validateVectorPath(vector.path);
      layer = createPathLayer(vector.name, structuredClone(vector.path));
    }
    layer.transform = { ...vector.transform }; layer.opacity = vector.opacity;
    return layer;
  });
  for (let i = 0; i < layers.length; i++) {
    const parent = result.layers[i].parentId;
    if (parent) {
      const group = groups.get(parent);
      if (!group) throw new Error("Missing imported vector parent");
      layers[i].parentId = group.id;
    }
  }
  const byId = new Map(layers.map(layer => [layer.id, layer]));
  for (const layer of layers) {
    const seen = new Set([layer.id]); let parent = layer.parentId;
    while (parent) {
      if (seen.has(parent) || seen.size > 32) throw new Error("Cyclic or excessively nested imported groups");
      seen.add(parent); parent = byId.get(parent)!.parentId;
    }
  }
  return layers;
}
