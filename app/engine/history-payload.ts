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
import { cloneProAdjustment } from "./pro-adjustments";
import type { ProAdjustmentParams } from "./pro-adjustments";
import { alphaTileRecordBytes, type SparseAlphaSurface } from "./alpha-surface";
import { cloneTextStyle } from "./text-model";
import { cloneSpatialStyle } from "./text-3d";
import { pathContours } from "./vector-path";
import { cloneLetteringAsset, letteringAssetBytes } from "./lettering-asset";
import { meshAssetBytes } from "./form-mesh-asset";
import { getPhotoshopDocumentMetadata, setPhotoshopDocumentMetadata, getPhotoshopLayerMetadata, setPhotoshopLayerMetadata } from "./psd-metadata";

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
  return bitmapBytes(snap.bitmap) + bitmapBytes(snap.mask) + (snap.maskSurface?.stats().residentBytes ?? 0) + vectorPathBytes(snap.path) + letteringAssetBytes(snap.lettering3d) + meshAssetBytes(snap.mesh3d) + proAdjustmentBytes(snap.proAdjustment) + (snap.smartSource?.byteLength ?? 0);
}
export function proAdjustmentBytes(params?: ProAdjustmentParams) {
  return params ? 256 + (params.kind === "color-lookup" ? (params.lut?.values.length ?? 0) * 8 : params.kind === "gradient-map" ? (params.stops?.length ?? 0) * 128 : 0) : 0;
}
export function vectorPathBytes(path: PathStyle | undefined): number {
  if (!path) return 0;
  const contours = [...pathContours(path), ...(path.booleanSource?.operands.flat() ?? []), ...(path.offsetSource?.contours ?? [])];
  // Conservative JS-object allowance; geometry must not be free in history.
  return 256 + contours.reduce((n, contour) => n + 128 + contour.anchors.length * 192, 0) + (path.fill.length + path.stroke.length) * 2 + (path.appearance?.reduce((n, p) => n + 128 + p.color.length * 2, 0) ?? 0) + (path.symbolId?.length ?? 0) * 2;
}
export function documentSnapshotBytes(doc: Document | undefined) {
  if (!doc) return 0;
  let total = 0;
  for (const layer of doc.layers) {
    total += letteringAssetBytes(layer.lettering3d) + meshAssetBytes(layer.mesh3d);
    total += proAdjustmentBytes(layer.proAdjustment);
    total += bitmapBytes(layer.bitmap) + bitmapBytes(layer.mask) + (layer.maskSurface?.stats().residentBytes ?? 0) + vectorPathBytes(layer.path) + vectorPathBytes(layer.vectorMask);
  }
  if (doc.selection?.mask) total += bitmapBytes(doc.selection.mask);
  if (doc.selection?.surface) total += doc.selection.surface.stats().residentBytes;
  for (const layer of doc.layers) total += layer.smartSource?.byteLength ?? 0;
  for (const channel of doc.alphaChannels ?? []) total += 128 + channel.surface.stats().residentBytes;
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
  const seenAlpha = new Set<SparseAlphaSurface>();
  const seenPaths = new Set<PathStyle>();
  const seenLettering = new Set<Layer["lettering3d"]>();
  const seenMeshes = new Set<Layer["mesh3d"]>();
  const seenAdjustments = new Set<ProAdjustmentParams>();
  const seenSmartSources = new Set<Uint8Array>();
  let total = 128; // fixed overhead per entry (labels, hashmap, refs)
  const archives = new Set<Uint8Array>();
  for (const list of [entry.designSnapshotsBefore, entry.designSnapshotsAfter, entry.documentBefore?.designSnapshots, entry.documentAfter?.designSnapshots]) {
    for (const snapshot of list ?? []) if (!archives.has(snapshot.bytes)) { archives.add(snapshot.bytes); total += snapshot.bytes.byteLength; }
  }
  for (const state of [entry.campaignBefore, entry.campaignAfter, entry.artboardsBefore, entry.artboardsAfter]) if(state)total+=JSON.stringify(state).length*2;

  const bill = (canvas: HTMLCanvasElement | undefined) => {
    if (!canvas || seen.has(canvas)) return;
    seen.add(canvas);
    total += bitmapBytes(canvas);
  };
  const billAlpha = (surface: SparseAlphaSurface | undefined) => {
    if (!surface || seenAlpha.has(surface)) return;
    seenAlpha.add(surface);
    total += surface.stats().residentBytes;
  };
  const billPath = (path: PathStyle | undefined) => {
    if (!path || seenPaths.has(path)) return;
    seenPaths.add(path); total += vectorPathBytes(path);
  };
  for (const layer of [...entry.before, ...entry.after, ...(entry.layersBefore ?? []), ...(entry.layersAfter ?? []), ...(entry.documentBefore?.layers ?? []), ...(entry.documentAfter?.layers ?? [])]) {
    if (layer.smartSource && !seenSmartSources.has(layer.smartSource)) { seenSmartSources.add(layer.smartSource); total += layer.smartSource.byteLength; }
    if (layer.proAdjustment && !seenAdjustments.has(layer.proAdjustment)) { seenAdjustments.add(layer.proAdjustment); total += proAdjustmentBytes(layer.proAdjustment); }
    if (layer.lettering3d && !seenLettering.has(layer.lettering3d)) { seenLettering.add(layer.lettering3d); total += letteringAssetBytes(layer.lettering3d); }
    if (layer.mesh3d && !seenMeshes.has(layer.mesh3d)) { seenMeshes.add(layer.mesh3d); total += meshAssetBytes(layer.mesh3d); }
  }

  for (const s of entry.before) { bill(s.bitmap); bill(s.mask); billAlpha(s.maskSurface); billPath(s.path); }
  for (const s of entry.after) { bill(s.bitmap); bill(s.mask); billAlpha(s.maskSurface); billPath(s.path); }
  if (entry.layersBefore) for (const l of entry.layersBefore) { bill(l.bitmap); bill(l.mask); billAlpha(l.maskSurface); billPath(l.path); billPath(l.vectorMask); }
  if (entry.layersAfter) for (const l of entry.layersAfter) { bill(l.bitmap); bill(l.mask); billAlpha(l.maskSurface); billPath(l.path); billPath(l.vectorMask); }
  if (entry.layerOrderBefore) total += entry.layerOrderBefore.reduce((bytes, id) => bytes + 8 + id.length * 2, 0);
  if (entry.layerOrderAfter) total += entry.layerOrderAfter.reduce((bytes, id) => bytes + 8 + id.length * 2, 0);
  bill(entry.selectionBefore?.mask);
  bill(entry.selectionAfter?.mask);
  billAlpha(entry.selectionBefore?.surface);
  billAlpha(entry.selectionAfter?.surface);
  for (const channel of [...(entry.channelsBefore ?? []), ...(entry.channelsAfter ?? [])]) { total += 128; billAlpha(channel.surface); }
  for (const doc of [entry.documentBefore, entry.documentAfter]) {
    if (!doc) continue;
    for (const layer of doc.layers) { bill(layer.bitmap); bill(layer.mask); billAlpha(layer.maskSurface); billPath(layer.path); billPath(layer.vectorMask); }
    bill(doc.selection?.mask);
    billAlpha(doc.selection?.surface);
    for (const channel of doc.alphaChannels ?? []) { total += 128; billAlpha(channel.surface); }
  }

  // Typed-array payloads are always exclusively owned by the entry.
  if (entry.selectionTranslation?.source) {
    total += entry.selectionTranslation.source.data.byteLength;
  }
  if (entry.pixelPatches) for (const p of entry.pixelPatches) total += pixelPatchBytes(p);
  if (entry.surfacePatches) for (const p of entry.surfacePatches) total += surfaceTilePatchBytes(p);
  if (entry.maskSurfacePatches) for (const patch of entry.maskSurfacePatches) {
    total += alphaTileRecordBytes(patch.before) + alphaTileRecordBytes(patch.after);
  }
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
      workRegion: ai.parameters.workRegion ? { ...ai.parameters.workRegion } : undefined,
      geometryCopy: ai.parameters.geometryCopy ? { ...ai.parameters.geometryCopy } : undefined,
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
  return structuredClone(p);
}
export function cloneSelection(selection: Selection | null | undefined): Selection | null {
  return selection ? {
    mask: selection.mask ? cloneCanvas(selection.mask) : undefined,
    surface: selection.surface?.clone(),
    bounds: { ...selection.bounds },
  } : null;
}

/** Shallow layer clone (does NOT duplicate bitmap/mask pixels). */
export function shallowCloneLayer(layer: Layer): Layer {
  const copy: Layer = {
    ...layer,
    surface: layer.surface?.clone(),
    maskSurface: layer.maskSurface?.clone(),
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
    spatial: cloneSpatialStyle(layer.spatial),
    tone: layer.tone ? { ...layer.tone } : undefined,
    curves: layer.curves ? cloneCurves(layer.curves) : undefined,
    levels: layer.levels ? { ...layer.levels } : undefined,
    hsl: layer.hsl ? { ...layer.hsl } : undefined,
    proAdjustment: layer.proAdjustment ? cloneProAdjustment(layer.proAdjustment) : undefined,
    text: layer.text ? cloneTextStyle(layer.text) : undefined,
    lettering3d: layer.lettering3d ? cloneLetteringAsset(layer.lettering3d) : undefined,
    mesh3d: layer.mesh3d ? structuredClone(layer.mesh3d) : undefined,
    shape: layer.shape ? { ...layer.shape } : undefined,
    path: layer.path ? deepClonePath(layer.path) : undefined,
    vectorMask: layer.vectorMask ? deepClonePath(layer.vectorMask) : undefined,
    filters: layer.filters ? cloneFilters(layer.filters) : undefined,
    ai: layer.ai ? cloneAiProvenance(layer.ai) : undefined,
    effects: layer.effects ? cloneEffects(layer.effects) : undefined,
  };
  const metadata = getPhotoshopLayerMetadata(layer);
  if (metadata) setPhotoshopLayerMetadata(copy, metadata);
  return copy;
}

/** Full document clone (duplicates every layer bitmap + mask + selection). */
export function cloneDocument(doc: Document): Document {
  const copy: Document = {
    ...doc,
    campaign: doc.campaign ? structuredClone(doc.campaign) : undefined,
    designSnapshots: doc.designSnapshots?.map(snapshot => ({ ...snapshot })),
    alphaChannels: doc.alphaChannels?.map(channel => ({ ...channel, surface: channel.surface.clone() })),
    resolution: { ...doc.resolution },
    globalLight: doc.globalLight ? { ...doc.globalLight } : undefined,
    guides: doc.guides.map((guide) => ({ ...guide })),
    proofing: { ...doc.proofing },
    // Captured tips are immutable assets, so history snapshots share their
    // canvases and only copy the small metadata records.
    capturedBrushes: doc.capturedBrushes?.map((brush) => ({ ...brush })),
    layerComps: doc.layerComps?.map((comp) => ({
      ...comp,
      layers: comp.layers.map((layer) => ({ ...layer, transform: { ...layer.transform } })),
    })),
    artboards: doc.artboards?.map((artboard) => ({ ...artboard })),
    layers: doc.layers.map((layer) => {
      const copy = shallowCloneLayer(layer);
      copy.bitmap = layer.bitmap ? cloneCanvas(layer.bitmap) : undefined;
      copy.mask = layer.mask ? cloneCanvas(layer.mask) : undefined;
      return copy;
    }),
    selection: doc.selection ? {
      mask: doc.selection.mask ? cloneCanvas(doc.selection.mask) : undefined,
      surface: doc.selection.surface?.clone(),
      bounds: { ...doc.selection.bounds },
    } : null,
  };
  const metadata = getPhotoshopDocumentMetadata(doc);
  if (metadata) setPhotoshopDocumentMetadata(copy, metadata);
  return copy;
}

/** Freeze a single layer into a history snapshot (deep, duplicates bitmap). */
export function snapshotLayer(layer: Layer): LayerSnapshot {
  return {
    smartSource: layer.smartSource ?? null,
    layerId: layer.id,
    bitmap: layer.bitmap ? cloneCanvas(layer.bitmap) : undefined,
    surface: layer.surface?.clone(),
    mask: layer.mask ? cloneCanvas(layer.mask) : undefined,
    maskSurface: layer.maskSurface?.clone(),
    maskPresent: Boolean(layer.mask || layer.maskSurface),
    tone: layer.tone ? { ...layer.tone } : undefined,
    curves: layer.curves ? cloneCurves(layer.curves) : undefined,
    levels: layer.levels ? { ...layer.levels } : undefined,
    hsl: layer.hsl ? { ...layer.hsl } : undefined,
    proAdjustment: layer.proAdjustment ? cloneProAdjustment(layer.proAdjustment) : undefined,
    opacity: layer.opacity,
    fillOpacity: layer.fillOpacity ?? null,
    blend: layer.blend,
    blendStack: layer.blendStack ? cloneBlendStack(layer.blendStack) : null,
    blendIf: layer.blendIf ? cloneBlendIf(layer.blendIf) : null,
    visible: layer.visible,
    name: layer.name,
    transform: { ...layer.transform },
    spatial: cloneSpatialStyle(layer.spatial),
    text: layer.text ? cloneTextStyle(layer.text) : undefined,
    lettering3d: layer.lettering3d ? cloneLetteringAsset(layer.lettering3d) : undefined,
    mesh3d: layer.mesh3d ? structuredClone(layer.mesh3d) : undefined,
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
