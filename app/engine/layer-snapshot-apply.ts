// Pure per-layer snapshot application. Studio.applySnapshots loops over these
// and also runs a couple of instance side-effects (surface sync + checkpoint);
// keeping the pixel-copy work pure makes it trivial to unit-test the mapping
// from LayerSnapshot -> Layer.

import { Layer, cloneCanvas, cloneCurves } from "./document";
import { bumpBitmapVersion } from "./gl-renderer";
import {
  cloneAiProvenance,
  cloneBlendIf,
  cloneBlendStack,
  cloneEffects,
  cloneFilters,
  cloneRawLayerSource,
  deepClonePath,
} from "./history-payload";
import type { LayerSnapshot } from "./studio";
import { cloneProAdjustment } from "./pro-adjustments";
import { cloneSpatialStyle } from "./text-3d";
import { cloneLetteringAsset } from "./lettering-asset";

// Apply a single snapshot's fields to the given layer, in place. Returns
// whether the layer bitmap or mask changed — the caller can use this to decide
// whether to bump the surface / checkpoint.
export function applyLayerSnapshot(layer: Layer, snap: LayerSnapshot): {
  bitmapReplaced: boolean;
  maskReplaced: boolean;
} {
  let bitmapReplaced = false;
  let maskReplaced = false;
  if (snap.bitmap) {
    layer.bitmap = cloneCanvas(snap.bitmap);
    bumpBitmapVersion(layer.bitmap);
    bitmapReplaced = true;
  }
  if (snap.surface) layer.surface = snap.surface.clone();
  if (snap.maskPresent === false) {
    layer.mask = undefined;
    layer.maskSurface = undefined;
    maskReplaced = true;
  }
  if (snap.maskSurface) {
    layer.maskSurface = snap.maskSurface.clone();
    layer.mask = undefined;
    maskReplaced = true;
  }
  if (snap.mask) {
    layer.mask = cloneCanvas(snap.mask);
    layer.maskSurface = undefined;
    bumpBitmapVersion(layer.mask);
    maskReplaced = true;
  }
  if (snap.tone) layer.tone = { ...snap.tone };
  if (snap.curves) layer.curves = cloneCurves(snap.curves);
  if (snap.levels) layer.levels = { ...snap.levels };
  if (snap.hsl) layer.hsl = { ...snap.hsl };
  if (snap.proAdjustment) layer.proAdjustment = cloneProAdjustment(snap.proAdjustment);
  if (snap.path) layer.path = deepClonePath(snap.path);
  if (snap.parentId !== undefined) layer.parentId = snap.parentId ?? undefined;
  if (snap.locked !== undefined) layer.locked = snap.locked;
  if (snap.clipping !== undefined) layer.clipping = snap.clipping;
  if (snap.filters) layer.filters = cloneFilters(snap.filters);
  if (snap.ai) layer.ai = cloneAiProvenance(snap.ai);
  if (snap.raw) layer.raw = cloneRawLayerSource(snap.raw);
  if (snap.smartSource !== undefined) layer.smartSource = snap.smartSource ?? undefined;
  if (snap.effects) layer.effects = cloneEffects(snap.effects);
  if (snap.opacity !== undefined) layer.opacity = snap.opacity;
  if (snap.fillOpacity !== undefined) layer.fillOpacity = snap.fillOpacity ?? undefined;
  if (snap.knockout !== undefined) layer.knockout = snap.knockout ?? undefined;
  if (snap.maskHidesEffects !== undefined) layer.maskHidesEffects = snap.maskHidesEffects ?? undefined;
  if (snap.vectorMaskHidesEffects !== undefined) layer.vectorMaskHidesEffects = snap.vectorMaskHidesEffects ?? undefined;
  if (snap.transparencyShapesLayer !== undefined) layer.transparencyShapesLayer = snap.transparencyShapesLayer ?? undefined;
  if (snap.blendClippedAsGroup !== undefined) layer.blendClippedAsGroup = snap.blendClippedAsGroup ?? undefined;
  if (snap.blendChannels !== undefined) {
    layer.blendChannels = snap.blendChannels ? { ...snap.blendChannels } : undefined;
  }
  if (snap.blend) layer.blend = snap.blend;
  if (snap.blendStack !== undefined) {
    layer.blendStack = snap.blendStack ? cloneBlendStack(snap.blendStack) : undefined;
  }
  if (snap.blendIf !== undefined) {
    layer.blendIf = snap.blendIf ? cloneBlendIf(snap.blendIf) : undefined;
  }
  if (snap.visible !== undefined) layer.visible = snap.visible;
  if (snap.name) layer.name = snap.name;
  if (snap.transform) layer.transform = { ...snap.transform };
  if (snap.spatial !== undefined) layer.spatial = snap.spatial ? cloneSpatialStyle(snap.spatial) : undefined;
  if (snap.text) layer.text = { ...snap.text };
  if (snap.lettering3d) layer.lettering3d = cloneLetteringAsset(snap.lettering3d);
  if (snap.mesh3d) layer.mesh3d = structuredClone(snap.mesh3d);
  if (snap.shape) layer.shape = { ...snap.shape };
  return { bitmapReplaced, maskReplaced };
}
