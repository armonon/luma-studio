// Pure helpers for history payloads. Extracted from studio.ts so they can be
// unit-tested without instantiating a Studio (which needs a real canvas).
//
// Everything here is side-effect free and takes plain data in / gives plain
// data out. Two knobs matter to the rest of the engine:
//   * `historyEntrySize(entry)` — bytes an entry contributes to the history
//     byte budget. Bitmaps and masks dominate; everything else is small.
//   * `snapshotLayer(layer)` / `shallowCloneLayer(layer)` — the two flavors
//     Studio uses to freeze layers into a history node.

import {
  AiProvenance,
  BlendIf,
  BlendPass,
  Document,
  Layer,
  LayerEffect,
  PathStyle,
  RawLayerSource,
  Selection,
  SmartFilter,
  cloneCanvas,
  cloneCurves,
} from "./document";
import type { LayerSnapshot, HistoryEntry, PixelPatch, SurfaceTilePatch } from "./studio";
import type { RawDevelopSettings } from "./raw-develop";

// ---------- byte accounting ----------

export function bitmapBytes(canvas: HTMLCanvasElement | undefined) {
  return canvas ? canvas.width * canvas.height * 4 : 0;
}
export function pixelPatchBytes(p: PixelPatch) {
  return p.before.data.byteLength + p.after.data.byteLength;
}
export function surfaceTilePatchBytes(p: SurfaceTilePatch) {
  return (p.before?.byteLength ?? 0) + (p.after?.byteLength ?? 0);
}
export function layerSnapshotBytes(snap: LayerSnapshot) {
  return bitmapBytes(snap.bitmap) + bitmapBytes(snap.mask);
}
export function documentSnapshotBytes(doc: Document | undefined) {
  if (!doc) return 0;
  let total = 0;
  for (const layer of doc.layers) {
    total += bitmapBytes(layer.bitmap) + bitmapBytes(layer.mask);
  }
  if (doc.selection?.mask) total += bitmapBytes(doc.selection.mask);
  return total;
}

/**
 * Bytes a single history entry retains.
 *
 * Canvases are deduplicated by object identity. This matters because
 * `shallowCloneLayer` deliberately does NOT copy pixels — a structural entry's
 * `layersBefore` and `layersAfter` hold the *same* canvas objects as each other
 * and as the live document. Billing each occurrence separately over-states an
 * entry by a large multiple and makes the byte cap fire far below real memory
 * use. Counting each distinct canvas once gives the retained-set size.
 */
export function historyEntrySize(entry: HistoryEntry): number {
  const seen = new Set<HTMLCanvasElement>();
  let total = 128; // fixed overhead per entry (labels, hashmap, refs)

  const bill = (canvas: HTMLCanvasElement | undefined) => {
    if (!canvas || seen.has(canvas)) return;
    seen.add(canvas);
    total += bitmapBytes(canvas);
  };

  for (const s of entry.before) { bill(s.bitmap); bill(s.mask); }
  for (const s of entry.after) { bill(s.bitmap); bill(s.mask); }
  if (entry.layersBefore) for (const l of entry.layersBefore) { bill(l.bitmap); bill(l.mask); }
  if (entry.layersAfter) for (const l of entry.layersAfter) { bill(l.bitmap); bill(l.mask); }
  bill(entry.selectionBefore?.mask);
  bill(entry.selectionAfter?.mask);
  for (const doc of [entry.documentBefore, entry.documentAfter]) {
    if (!doc) continue;
    for (const layer of doc.layers) { bill(layer.bitmap); bill(layer.mask); }
    bill(doc.selection?.mask);
  }

  // Typed-array payloads are always exclusively owned by the entry.
  if (entry.pixelPatches) for (const p of entry.pixelPatches) total += pixelPatchBytes(p);
  if (entry.surfacePatches) for (const p of entry.surfacePatches) total += surfaceTilePatchBytes(p);
  return total;
}

// ---------- deep clone helpers ----------

export function cloneFilters(filters: SmartFilter[]): SmartFilter[] {
  return filters.map((filter) => ({ ...filter, params: { ...filter.params } }));
}
export function cloneEffects(effects: LayerEffect[]): LayerEffect[] {
  return effects.map((effect) => ({ ...effect }));
}
export function cloneBlendStack(passes: ReadonlyArray<BlendPass>): BlendPass[] {
  return passes.map((pass) => ({ ...pass }));
}
export function cloneBlendIf(settings: BlendIf): BlendIf {
  return {
    activeChannel: settings.activeChannel,
    channels: {
      gray: { source: { ...settings.channels.gray.source }, underlying: { ...settings.channels.gray.underlying } },
      red: { source: { ...settings.channels.red.source }, underlying: { ...settings.channels.red.underlying } },
      green: { source: { ...settings.channels.green.source }, underlying: { ...settings.channels.green.underlying } },
      blue: { source: { ...settings.channels.blue.source }, underlying: { ...settings.channels.blue.underlying } },
    },
  };
}
export function cloneAiProvenance(ai: AiProvenance): AiProvenance {
  return {
    ...ai,
    sourceLayerIds: [...ai.sourceLayerIds],
    parameters: ai.parameters ? {
      ...ai.parameters,
      controls: ai.parameters.controls ? { ...ai.parameters.controls } : undefined,
      selection: ai.parameters.selection ? {
        ...ai.parameters.selection,
        bounds: ai.parameters.selection.bounds ? { ...ai.parameters.selection.bounds } : undefined,
      } : undefined,
    } : undefined,
  };
}
export function cloneRawSettings(settings: RawDevelopSettings): RawDevelopSettings {
  return {
    ...settings,
    customWhiteBalance: [...settings.customWhiteBalance],
  };
}
export function cloneRawLayerSource(raw: RawLayerSource): RawLayerSource {
  return {
    ...raw,
    // Sensor sources are immutable and may be hundreds of megabytes. History
    // nodes intentionally share this byte buffer; .luma serialization dedupes it.
    original: raw.original,
    settings: cloneRawSettings(raw.settings),
    sensor: { ...raw.sensor, warnings: [...raw.sensor.warnings] },
  };
}
export function deepClonePath(p: PathStyle): PathStyle {
  return {
    ...p,
    anchors: p.anchors.map((a) => ({ ...a, hIn: { ...a.hIn }, hOut: { ...a.hOut } })),
  };
}
export function cloneSelection(selection: Selection | null | undefined): Selection | null {
  return selection ? {
    mask: cloneCanvas(selection.mask),
    bounds: { ...selection.bounds },
  } : null;
}

/** Shallow layer clone (does NOT duplicate bitmap/mask pixels). */
export function shallowCloneLayer(layer: Layer): Layer {
  return {
    ...layer,
    surface: layer.surface?.clone(),
    source: layer.source ? {
      ...layer.source,
      colorProfile: layer.source.colorProfile ? {
        ...layer.source.colorProfile,
        warnings: [...layer.source.colorProfile.warnings],
      } : undefined,
    } : undefined,
    photoshop: layer.photoshop ? { ...layer.photoshop } : undefined,
    raw: layer.raw ? cloneRawLayerSource(layer.raw) : undefined,
    blendStack: layer.blendStack ? cloneBlendStack(layer.blendStack) : undefined,
    blendIf: layer.blendIf ? cloneBlendIf(layer.blendIf) : undefined,
    transform: { ...layer.transform },
    tone: layer.tone ? { ...layer.tone } : undefined,
    curves: layer.curves ? cloneCurves(layer.curves) : undefined,
    levels: layer.levels ? { ...layer.levels } : undefined,
    hsl: layer.hsl ? { ...layer.hsl } : undefined,
    text: layer.text ? { ...layer.text } : undefined,
    shape: layer.shape ? { ...layer.shape } : undefined,
    path: layer.path ? deepClonePath(layer.path) : undefined,
    filters: layer.filters ? cloneFilters(layer.filters) : undefined,
    ai: layer.ai ? cloneAiProvenance(layer.ai) : undefined,
    effects: layer.effects ? cloneEffects(layer.effects) : undefined,
  };
}

/** Full document clone (duplicates every layer bitmap + mask + selection). */
export function cloneDocument(doc: Document): Document {
  return {
    ...doc,
    resolution: { ...doc.resolution },
    guides: doc.guides.map((guide) => ({ ...guide })),
    proofing: { ...doc.proofing },
    layers: doc.layers.map((layer) => ({
      ...shallowCloneLayer(layer),
      bitmap: layer.bitmap ? cloneCanvas(layer.bitmap) : undefined,
      mask: layer.mask ? cloneCanvas(layer.mask) : undefined,
    })),
    selection: doc.selection ? {
      mask: cloneCanvas(doc.selection.mask),
      bounds: { ...doc.selection.bounds },
    } : null,
  };
}

/** Freeze a single layer into a history snapshot (deep, duplicates bitmap). */
export function snapshotLayer(layer: Layer): LayerSnapshot {
  return {
    layerId: layer.id,
    bitmap: layer.bitmap ? cloneCanvas(layer.bitmap) : undefined,
    surface: layer.surface?.clone(),
    mask: layer.mask ? cloneCanvas(layer.mask) : undefined,
    tone: layer.tone ? { ...layer.tone } : undefined,
    curves: layer.curves ? cloneCurves(layer.curves) : undefined,
    levels: layer.levels ? { ...layer.levels } : undefined,
    hsl: layer.hsl ? { ...layer.hsl } : undefined,
    opacity: layer.opacity,
    fillOpacity: layer.fillOpacity ?? null,
    blend: layer.blend,
    blendStack: layer.blendStack ? cloneBlendStack(layer.blendStack) : null,
    blendIf: layer.blendIf ? cloneBlendIf(layer.blendIf) : null,
    visible: layer.visible,
    name: layer.name,
    transform: { ...layer.transform },
    text: layer.text ? { ...layer.text } : undefined,
    shape: layer.shape ? { ...layer.shape } : undefined,
    path: layer.path ? deepClonePath(layer.path) : undefined,
    parentId: layer.parentId ?? null,
    locked: layer.locked,
    clipping: layer.clipping,
    filters: layer.filters ? cloneFilters(layer.filters) : undefined,
    ai: layer.ai ? cloneAiProvenance(layer.ai) : undefined,
    raw: layer.raw ? cloneRawLayerSource(layer.raw) : undefined,
    effects: layer.effects ? cloneEffects(layer.effects) : undefined,
  };
}
