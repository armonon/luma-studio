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
  if (snap.mask) {
    layer.mask = cloneCanvas(snap.mask);
    bumpBitmapVersion(layer.mask);
    maskReplaced = true;
  }
  if (snap.tone) layer.tone = { ...snap.tone };
  if (snap.curves) layer.curves = cloneCurves(snap.curves);
  if (snap.levels) layer.levels = { ...snap.levels };
  if (snap.hsl) layer.hsl = { ...snap.hsl };
  if (snap.path) layer.path = deepClonePath(snap.path);
  if (snap.parentId !== undefined) layer.parentId = snap.parentId ?? undefined;
  if (snap.locked !== undefined) layer.locked = snap.locked;
  if (snap.clipping !== undefined) layer.clipping = snap.clipping;
  if (snap.filters) layer.filters = cloneFilters(snap.filters);
  if (snap.ai) layer.ai = cloneAiProvenance(snap.ai);
  if (snap.raw) layer.raw = cloneRawLayerSource(snap.raw);
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
  if (snap.text) layer.text = { ...snap.text };
  if (snap.shape) layer.shape = { ...snap.shape };
  return { bitmapReplaced, maskReplaced };
}
