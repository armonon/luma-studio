import JSZip from "jszip";
import { Action } from "./actions";
import {
  Document,
  CapturedBrushAsset,
  Guide,
  Layer,
  MAX_CAPTURED_BRUSHES,
  Selection,
  newCanvas,
  nextId,
  reserveId,
} from "./document";
import {
  OperationHistory,
  OperationHistorySnapshot,
  OperationNode,
} from "./operation-history";
import type {
  HistoryEntry,
  LayerMaskTilePatch,
  LayerSnapshot,
  PixelPatch,
  SelectionTranslationPatch,
  SurfaceTilePatch,
} from "./studio";
import type { AlphaTileRecord } from "./alpha-surface";
import { PixelFormat, PrecisionTileSurface } from "./tile-store";
import { SparseAlphaSurface } from "./alpha-surface";
import { alphaSurfaceFromCanvas } from "./selection";
import type { WorkingColorSpace } from "./color";
import { importPsd } from "./psd";
import {
  getPhotoshopDocumentMetadata,
  getPhotoshopLayerMetadata,
  setPhotoshopDocumentMetadata,
  setPhotoshopLayerMetadata,
} from "./psd-metadata";

export const LUMA_PROJECT_VERSION = 5 as const;
const SUPPORTED_PROJECT_VERSIONS = new Set([1, 2, 3, 4, LUMA_PROJECT_VERSION]);
const RESTORED_HISTORY_LIMIT = 80;

export const LUMA_PROJECT_LIMITS = {
  archiveBytes: 1024 * 1024 * 1024,
  expandedBytes: 8 * 1024 * 1024 * 1024,
  entryBytes: 1024 * 1024 * 1024,
  entries: 25_000,
  manifestBytes: 16 * 1024 * 1024,
  dimension: 300_000,
  layers: 100_000,
  actions: 2_000,
  actionSteps: 20_000,
  historyNodes: 512,
} as const;

type SizedZipEntry = JSZip.JSZipObject & {
  _data?: { uncompressedSize?: number; compressedSize?: number };
};

function sourceByteLength(source: Blob | ArrayBuffer | Uint8Array) {
  return source instanceof Blob ? source.size : source.byteLength;
}

export function assertSafeProjectArchive(zip: JSZip, archiveBytes: number) {
  const files = Object.values(zip.files).filter((entry) => !entry.dir) as SizedZipEntry[];
  if (files.length > LUMA_PROJECT_LIMITS.entries) throw new Error("Luma project contains too many archive entries");
  let expanded = 0;
  for (const entry of files) {
    if (entry.name.startsWith("/") || entry.name.includes("\\") || entry.name.split("/").includes("..")) {
      throw new Error(`Unsafe project archive path: ${entry.name}`);
    }
    const size = entry._data?.uncompressedSize;
    if (!Number.isSafeInteger(size) || size! < 0) throw new Error(`Project entry has an invalid size: ${entry.name}`);
    if (size! > LUMA_PROJECT_LIMITS.entryBytes) throw new Error(`Project entry is too large: ${entry.name}`);
    expanded += size!;
    if (!Number.isSafeInteger(expanded) || expanded > LUMA_PROJECT_LIMITS.expandedBytes) {
      throw new Error("Expanded Luma project exceeds the safety limit");
    }
  }
  if (archiveBytes > 0 && expanded > Math.max(256 * 1024 * 1024, archiveBytes * 250)) {
    throw new Error("Luma project has an unsafe archive expansion ratio");
  }
  const manifest = zip.file("manifest.json") as SizedZipEntry | null;
  if (manifest?._data?.uncompressedSize && manifest._data.uncompressedSize > LUMA_PROJECT_LIMITS.manifestBytes) {
    throw new Error("Project manifest exceeds the safety limit");
  }
}

type SerializedPrecisionSurface = {
  width: number;
  height: number;
  format: PixelFormat;
  colorSpace: WorkingColorSpace;
  tileSize: number;
  tiles: Array<{ key: string; asset: string }>;
};

type SerializedAlphaSurface = {
  width: number;
  height: number;
  tileSize: number;
  defaultAlpha: number;
  tiles: Array<{ key: string; uniform?: number; asset?: string }>;
};

type SerializedSelection = {
  bounds: Selection["bounds"];
  surface?: SerializedAlphaSurface;
  /** v1-v4 selection storage. */
  asset?: string;
};

type SerializedRawSource = Omit<NonNullable<Layer["raw"]>, "original"> & {
  asset: string;
};

type SerializedLayer = Omit<Layer, "bitmap" | "surface" | "mask" | "maskSurface" | "raw" | "subjectMask"> & {
  bitmapAsset?: string;
  surface?: SerializedPrecisionSurface;
  maskAsset?: string;
  maskSurface?: SerializedAlphaSurface;
  raw?: SerializedRawSource;
};

type SerializedCapturedBrush = Omit<CapturedBrushAsset, "bitmap"> & {
  bitmapAsset: string;
};

type SerializedDocument = Omit<Document, "layers" | "selection" | "capturedBrushes"> & {
  layers: SerializedLayer[];
  capturedBrushes?: SerializedCapturedBrush[];
  selection?: SerializedSelection;
  photoshopSourceAsset?: string;
};

type SerializedLayerSnapshot = Omit<LayerSnapshot, "bitmap" | "surface" | "mask" | "maskSurface" | "raw"> & {
  bitmapAsset?: string;
  surface?: SerializedPrecisionSurface;
  maskAsset?: string;
  maskSurface?: SerializedAlphaSurface;
  raw?: SerializedRawSource;
};

type SerializedPixelPatch = Omit<PixelPatch, "before" | "after"> & {
  beforeAsset: string;
  afterAsset: string;
};

type SerializedSelectionTranslationPatch = Omit<SelectionTranslationPatch, "source"> & {
  sourceAsset?: string;
};

type SerializedSurfaceTilePatch = Omit<SurfaceTilePatch, "before" | "after"> & {
  beforeAsset?: string;
  afterAsset?: string;
};

type SerializedAlphaTileRecord = { uniform?: number; asset?: string } | null;
type SerializedLayerMaskTilePatch = Omit<LayerMaskTilePatch, "before" | "after"> & {
  before: SerializedAlphaTileRecord;
  after: SerializedAlphaTileRecord;
};

type SerializedHistoryEntry = {
  label: string;
  before: SerializedLayerSnapshot[];
  after: SerializedLayerSnapshot[];
  layersBefore?: SerializedLayer[];
  layersAfter?: SerializedLayer[];
  layerOrderBefore?: string[];
  layerOrderAfter?: string[];
  selectionBefore?: SerializedSelection | null;
  selectionAfter?: SerializedSelection | null;
  selectionTranslation?: SerializedSelectionTranslationPatch;
  pixelPatches?: SerializedPixelPatch[];
  surfacePatches?: SerializedSurfaceTilePatch[];
  maskSurfacePatches?: SerializedLayerMaskTilePatch[];
  guidesBefore?: Guide[];
  guidesAfter?: Guide[];
  documentBefore?: SerializedDocument;
  documentAfter?: SerializedDocument;
};

type SerializedHistoryNode = Omit<OperationNode<HistoryEntry>, "value"> & {
  value: SerializedHistoryEntry | null;
};

type SerializedOperationHistory = Omit<OperationHistorySnapshot<HistoryEntry>, "nodes"> & {
  nodes: SerializedHistoryNode[];
};

type ProjectManifest = {
  format: "luma-project";
  version: 1 | 2 | 3 | 4 | typeof LUMA_PROJECT_VERSION;
  name: string;
  savedAt: string;
  document: SerializedDocument;
  actions: Action[];
  history?: SerializedOperationHistory;
};

export type DecodedProject = {
  name: string;
  doc: Document;
  actions: Action[];
  history?: OperationHistory<HistoryEntry>;
};

export type DecodeLumaProjectOptions = {
  /**
   * Recovery only needs the last committed document state. Skipping history
   * leaves its archived assets compressed inside the ZIP instead of inflating
   * every undo snapshot during startup. Normal project opens still restore the
   * complete history by default.
   */
  restoreHistory?: boolean;
};

type EncodeContext = {
  zip: JSZip;
  assets: WeakMap<HTMLCanvasElement, string>;
  precisionAssets: Map<string, string>;
  rawAssets: Map<string, string>;
  photoshopAssets: Map<string, string>;
  nextAsset: number;
  nextPrecisionAsset: number;
  nextRawAsset: number;
  nextPhotoshopAsset: number;
};

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("Canvas encoding failed")),
      "image/png",
    );
  });
}

async function canvasArchiveData(canvas: HTMLCanvasElement): Promise<Blob | Uint8Array> {
  const encoded = await canvasBlob(canvas) as unknown;
  if (encoded instanceof Blob) {
    // JSZip's Node build does not accept Node's standards-compatible Blob,
    // while browser builds do. Keep the browser path zero-copy and normalize
    // only runtimes without FileReader.
    return typeof FileReader === "undefined"
      ? new Uint8Array(await encoded.arrayBuffer())
      : encoded;
  }
  // Native/headless canvas implementations commonly follow the browser
  // callback shape but provide a Buffer/Uint8Array. Normalize it before
  // handing bytes to JSZip instead of letting project save fail asynchronously.
  if (ArrayBuffer.isView(encoded)) {
    return new Uint8Array(encoded.buffer, encoded.byteOffset, encoded.byteLength).slice();
  }
  if (encoded instanceof ArrayBuffer) return new Uint8Array(encoded.slice(0));
  throw new Error("Canvas encoder returned an unsupported PNG payload");
}

async function addCanvasAsset(context: EncodeContext, canvas: HTMLCanvasElement) {
  const existing = context.assets.get(canvas);
  if (existing) return existing;
  context.nextAsset += 1;
  const asset = `assets/data/${context.nextAsset.toString().padStart(6, "0")}.png`;
  context.zip.file(asset, await canvasArchiveData(canvas));
  context.assets.set(canvas, asset);
  return asset;
}

async function blobCanvas(blob: Blob) {
  if (typeof createImageBitmap === "function") {
    const image = await createImageBitmap(blob);
    const canvas = newCanvas(image.width, image.height);
    canvas.getContext("2d")!.drawImage(image, 0, 0);
    image.close();
    return canvas;
  }
  const url = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = reject;
      element.src = url;
    });
    const canvas = newCanvas(image.naturalWidth, image.naturalHeight);
    canvas.getContext("2d")!.drawImage(image, 0, 0);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function readCanvasAsset(zip: JSZip, asset: string) {
  if (!asset.startsWith("assets/")) throw new Error(`Invalid project asset: ${asset}`);
  const file = zip.file(asset);
  if (!file) throw new Error(`Missing project asset: ${asset}`);
  return blobCanvas(await file.async("blob"));
}

async function serializePrecisionSurface(
  surface: PrecisionTileSurface,
  context: EncodeContext,
): Promise<SerializedPrecisionSurface> {
  const tiles: SerializedPrecisionSurface["tiles"] = [];
  for (const { key, data } of surface.store.entries()) {
    tiles.push({ key, asset: await addPrecisionAsset(context, data) });
  }
  return {
    width: surface.grid.width,
    height: surface.grid.height,
    format: surface.format,
    colorSpace: surface.colorSpace,
    tileSize: surface.grid.tileSize,
    tiles,
  };
}

async function addPrecisionAsset(context: EncodeContext, data: Uint8Array) {
  const digest = await digestBytes(data);
  let asset = context.precisionAssets.get(digest);
  if (!asset) {
    context.nextPrecisionAsset += 1;
    asset = `assets/precision/${context.nextPrecisionAsset.toString().padStart(6, "0")}-${digest.slice(0, 12)}.bin`;
    context.zip.file(asset, data);
    context.precisionAssets.set(digest, asset);
  }
  return asset;
}

async function readPrecisionAsset(zip: JSZip, asset: string) {
  if (!asset.startsWith("assets/precision/") || !asset.endsWith(".bin")) {
    throw new Error(`Invalid precision asset: ${asset}`);
  }
  const file = zip.file(asset);
  if (!file) throw new Error(`Missing precision asset: ${asset}`);
  return file.async("uint8array");
}

async function digestBytes(data: Uint8Array) {
  if (globalThis.crypto?.subtle) {
    const source = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    const digest = await globalThis.crypto.subtle.digest("SHA-256", source);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  let hash = 2166136261;
  for (const byte of data) hash = Math.imul(hash ^ byte, 16777619);
  return `${data.byteLength.toString(16)}-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

async function addRawAsset(context: EncodeContext, data: Uint8Array) {
  const digest = await digestBytes(data);
  let asset = context.rawAssets.get(digest);
  if (!asset) {
    context.nextRawAsset += 1;
    asset = `assets/raw/${context.nextRawAsset.toString().padStart(4, "0")}-${digest.slice(0, 12)}.dng`;
    context.zip.file(asset, data);
    context.rawAssets.set(digest, asset);
  }
  return asset;
}

async function readRawAsset(zip: JSZip, asset: string) {
  if (!asset.startsWith("assets/raw/") || !asset.endsWith(".dng")) {
    throw new Error(`Invalid RAW source asset: ${asset}`);
  }
  const file = zip.file(asset);
  if (!file) throw new Error(`Missing RAW source asset: ${asset}`);
  return file.async("uint8array");
}

async function addPhotoshopAsset(context: EncodeContext, data: Uint8Array) {
  const digest = await digestBytes(data);
  let asset = context.photoshopAssets.get(digest);
  if (!asset) {
    context.nextPhotoshopAsset += 1;
    asset = `assets/photoshop/${context.nextPhotoshopAsset.toString().padStart(4, "0")}-${digest.slice(0, 12)}.bin`;
    context.zip.file(asset, data);
    context.photoshopAssets.set(digest, asset);
  }
  return asset;
}

async function readPhotoshopAsset(zip: JSZip, asset: string) {
  if (!asset.startsWith("assets/photoshop/") || !asset.endsWith(".bin")) {
    throw new Error(`Invalid Photoshop source asset: ${asset}`);
  }
  const file = zip.file(asset);
  if (!file) throw new Error(`Missing Photoshop source asset: ${asset}`);
  return file.async("uint8array");
}

async function deserializePrecisionSurface(source: SerializedPrecisionSurface, zip: JSZip) {
  if (!source || !Number.isInteger(source.width) || !Number.isInteger(source.height) ||
      !["rgba8", "rgba16f", "rgba32f"].includes(source.format) ||
      !["srgb", "display-p3", "linear-srgb"].includes(source.colorSpace) || !Array.isArray(source.tiles)) {
    throw new Error("Invalid precision surface");
  }
  const tiles: Array<{ key: string; data: Uint8Array }> = [];
  for (const tile of source.tiles) {
    tiles.push({ key: tile.key, data: await readPrecisionAsset(zip, tile.asset) });
  }
  return PrecisionTileSurface.fromTiles(
    source.width,
    source.height,
    source.format,
    source.colorSpace,
    source.tileSize,
    tiles,
  );
}

async function serializeAlphaSurface(
  surface: SparseAlphaSurface,
  context: EncodeContext,
): Promise<SerializedAlphaSurface> {
  const tiles: SerializedAlphaSurface["tiles"] = [];
  for (const key of surface.keys()) {
    const record = surface.record(key);
    if (typeof record === "number") tiles.push({ key, uniform: record });
    else if (record) tiles.push({ key, asset: await addPrecisionAsset(context, record) });
  }
  return {
    width: surface.width,
    height: surface.height,
    tileSize: surface.tileSize,
    defaultAlpha: surface.defaultAlpha,
    tiles,
  };
}

async function deserializeAlphaSurface(source: SerializedAlphaSurface, zip: JSZip) {
  if (!source || !Number.isInteger(source.width) || !Number.isInteger(source.height) ||
      source.width <= 0 || source.height <= 0 ||
      source.width > LUMA_PROJECT_LIMITS.dimension || source.height > LUMA_PROJECT_LIMITS.dimension ||
      !Number.isInteger(source.tileSize) || source.tileSize < 32 || source.tileSize > 2048 ||
      !Number.isInteger(source.defaultAlpha) || source.defaultAlpha < 0 || source.defaultAlpha > 255 ||
      !Array.isArray(source.tiles) || source.tiles.length > LUMA_PROJECT_LIMITS.entries) {
    throw new Error("Invalid sparse alpha surface");
  }
  const surface = new SparseAlphaSurface(source.width, source.height, {
    tileSize: source.tileSize,
    defaultAlpha: source.defaultAlpha,
  });
  const seen = new Set<string>();
  for (const tile of source.tiles) {
    if (!tile || typeof tile.key !== "string" || seen.has(tile.key) ||
        (tile.uniform === undefined) === (tile.asset === undefined)) {
      throw new Error("Invalid sparse alpha tile");
    }
    seen.add(tile.key);
    if (tile.uniform !== undefined) {
      if (!Number.isInteger(tile.uniform) || tile.uniform < 0 || tile.uniform > 255) {
        throw new Error("Invalid sparse alpha value");
      }
      surface.writeUniform(tile.key, tile.uniform);
    } else {
      surface.writeTile(tile.key, await readPrecisionAsset(zip, tile.asset!));
    }
  }
  return surface;
}

async function serializeSelection(selection: Selection, context: EncodeContext): Promise<SerializedSelection> {
  const surface = selection.surface ?? (selection.mask
    ? alphaSurfaceFromCanvas(selection.mask)
    : null);
  if (!surface) throw new Error("Selection has no alpha storage");
  return {
    bounds: { ...selection.bounds },
    surface: await serializeAlphaSurface(surface, context),
  };
}

async function deserializeSelection(source: SerializedSelection, zip: JSZip): Promise<Selection> {
  if (!source || !source.bounds) throw new Error("Invalid project selection");
  if (source.surface) {
    return { surface: await deserializeAlphaSurface(source.surface, zip), bounds: { ...source.bounds } };
  }
  if (source.asset) {
    return { mask: await readCanvasAsset(zip, source.asset), bounds: { ...source.bounds } };
  }
  throw new Error("Project selection has no alpha storage");
}

async function serializeLayer(layer: Layer, context: EncodeContext): Promise<SerializedLayer> {
  // subjectMask is a canvas and derived data — recomputable from the layer by
  // the same model that produced it. Left in the spread it went through
  // JSON.stringify as `{}`, which is truthy but has no getContext, so a
  // reopened document threw the moment a subject-restricted effect drew.
  const { bitmap, surface, mask, maskSurface, raw, subjectMask, ...metadata } = layer;
  void subjectMask;
  return {
    ...metadata,
    bitmapAsset: bitmap ? await addCanvasAsset(context, bitmap) : undefined,
    surface: surface ? await serializePrecisionSurface(surface, context) : undefined,
    maskAsset: mask ? await addCanvasAsset(context, mask) : undefined,
    maskSurface: maskSurface ? await serializeAlphaSurface(maskSurface, context) : undefined,
    raw: raw ? {
      ...raw,
      settings: { ...raw.settings, customWhiteBalance: [...raw.settings.customWhiteBalance] },
      sensor: { ...raw.sensor, warnings: [...raw.sensor.warnings] },
      asset: await addRawAsset(context, raw.original),
    } : undefined,
  };
}

async function deserializeLayer(
  source: SerializedLayer,
  zip: JSZip,
  preserveId: boolean,
  idMap?: Map<string, string>,
): Promise<Layer> {
  const { bitmapAsset, surface, maskAsset, maskSurface, raw, ...metadata } = source;
  const id = preserveId ? metadata.id : nextId(metadata.kind);
  if (preserveId) reserveId(id);
  else idMap?.set(metadata.id, id);
  const layer: Layer = {
    ...metadata,
    id,
    transform: { ...metadata.transform },
  };
  if (bitmapAsset) layer.bitmap = await readCanvasAsset(zip, bitmapAsset);
  if (surface) layer.surface = await deserializePrecisionSurface(surface, zip);
  if (maskAsset) layer.mask = await readCanvasAsset(zip, maskAsset);
  if (maskSurface) layer.maskSurface = await deserializeAlphaSurface(maskSurface, zip);
  if (raw) {
    const { asset, ...rawMetadata } = raw;
    layer.raw = {
      ...rawMetadata,
      original: await readRawAsset(zip, asset),
      settings: { ...rawMetadata.settings, customWhiteBalance: [...rawMetadata.settings.customWhiteBalance] },
      sensor: { ...rawMetadata.sensor, warnings: [...rawMetadata.sensor.warnings] },
    };
  }
  return layer;
}

async function serializeDocument(doc: Document, context: EncodeContext): Promise<SerializedDocument> {
  const layers = await Promise.all(doc.layers.map((layer) => serializeLayer(layer, context)));
  const capturedBrushes = await Promise.all((doc.capturedBrushes ?? []).map(async ({ bitmap, ...brush }) => ({
    ...brush,
    bitmapAsset: await addCanvasAsset(context, bitmap),
  })));
  const photoshopSource = getPhotoshopDocumentMetadata(doc)?.originalSource;
  const selection = doc.selection ? await serializeSelection(doc.selection, context) : undefined;
  return {
    width: doc.width,
    height: doc.height,
    colorSpace: doc.colorSpace,
    bitDepth: doc.bitDepth,
    resolution: { ...doc.resolution },
    guides: doc.guides.map((guide) => ({ ...guide })),
    proofing: { ...doc.proofing },
    capturedBrushes,
    layerComps: (doc.layerComps ?? []).map((comp) => ({
      ...comp,
      layers: comp.layers.map((layer) => ({ ...layer, transform: { ...layer.transform } })),
    })),
    artboards: (doc.artboards ?? []).map((artboard) => ({ ...artboard })),
    layers,
    selection,
    photoshopSourceAsset: photoshopSource ? await addPhotoshopAsset(context, photoshopSource) : undefined,
  };
}

async function deserializeDocument(
  source: SerializedDocument,
  zip: JSZip,
  preserveIds: boolean,
): Promise<Document> {
  const idMap = preserveIds ? undefined : new Map<string, string>();
  const layers = await Promise.all(
    source.layers.map((layer) => deserializeLayer(layer, zip, preserveIds, idMap)),
  );
  if (idMap) {
    for (const layer of layers) {
      if (layer.parentId) layer.parentId = idMap.get(layer.parentId);
      if (layer.ai) {
        layer.ai = {
          ...layer.ai,
          sourceLayerIds: layer.ai.sourceLayerIds.map((id) => idMap.get(id) ?? id),
        };
      }
    }
  }

  let selection: Selection | null = null;
  if (source.selection) {
    selection = await deserializeSelection(source.selection, zip);
  }
  const capturedBrushSources = Array.isArray(source.capturedBrushes)
    ? source.capturedBrushes.slice(-MAX_CAPTURED_BRUSHES)
    : [];
  const capturedBrushes = await Promise.all(capturedBrushSources.map(async (brush) => {
    if (!brush || typeof brush.id !== "string" || !brush.id || typeof brush.name !== "string" ||
        typeof brush.createdAt !== "string" || typeof brush.bitmapAsset !== "string" ||
        !Number.isFinite(brush.sourceDiameter) || brush.sourceDiameter <= 0) {
      throw new Error("Invalid captured brush asset");
    }
    const id = preserveIds ? brush.id : nextId("captured-brush");
    if (preserveIds) reserveId(id);
    const source = brush.liveSource;
    const liveSource = source && source.live === true && (source.mode === "merged" || source.mode === "layer") &&
      [source.centerX, source.centerY, source.radius].every(Number.isFinite) && source.radius > 0
      ? {
        mode: source.mode,
        layerId: source.layerId ? (idMap?.get(source.layerId) ?? source.layerId) : undefined,
        centerX: source.centerX,
        centerY: source.centerY,
        radius: source.radius,
        live: true as const,
      }
      : undefined;
    return {
      id,
      name: brush.name.slice(0, 80),
      sourceDiameter: brush.sourceDiameter,
      createdAt: brush.createdAt,
      bitmap: await readCanvasAsset(zip, brush.bitmapAsset),
      liveSource,
    };
  }));
  const doc: Document = {
    width: source.width,
    height: source.height,
    colorSpace: source.colorSpace ?? "srgb",
    bitDepth: source.bitDepth ?? 8,
    resolution: source.resolution ?? { x: 72, y: 72, unit: "ppi" },
    guides: (source.guides ?? []).map((guide) => ({ ...guide })),
    proofing: source.proofing ? { ...source.proofing } : {
      profile: "none",
      intent: "relative-colorimetric",
      blackPointCompensation: true,
      gamutWarning: false,
    },
    capturedBrushes,
    layerComps: (Array.isArray(source.layerComps) ? source.layerComps : []).slice(-64).flatMap((comp) => {
      if (!comp || typeof comp.id !== "string" || typeof comp.name !== "string" ||
          typeof comp.createdAt !== "string" || !Array.isArray(comp.layers)) return [];
      const states = comp.layers.flatMap((state) => {
        const transform = state?.transform;
        const layerId = idMap?.get(state?.layerId) ?? state?.layerId;
        if (typeof layerId !== "string" || !layers.some((layer) => layer.id === layerId) ||
            typeof state.visible !== "boolean" || !Number.isFinite(state.opacity) ||
            !transform || ![transform.tx, transform.ty, transform.sx, transform.sy, transform.rotation].every(Number.isFinite)) return [];
        return [{
          layerId,
          visible: state.visible,
          opacity: Math.max(0, Math.min(1, state.opacity)),
          transform: { ...transform },
        }];
      });
      return [{ ...comp, layers: states }];
    }),
    artboards: (Array.isArray(source.artboards) ? source.artboards : []).slice(-128).flatMap((artboard) => {
      if (!artboard || typeof artboard.id !== "string" || typeof artboard.name !== "string" ||
          ![artboard.x, artboard.y, artboard.width, artboard.height].every(Number.isFinite) ||
          artboard.width <= 0 || artboard.height <= 0) return [];
      return [{ ...artboard }];
    }),
    layers,
    selection,
  };
  if (source.photoshopSourceAsset) {
    const originalSource = await readPhotoshopAsset(zip, source.photoshopSourceAsset);
    try {
      const buffer = originalSource.buffer.slice(
        originalSource.byteOffset,
        originalSource.byteOffset + originalSource.byteLength,
      ) as ArrayBuffer;
      const restoredSource = await importPsd(buffer);
      const documentMetadata = getPhotoshopDocumentMetadata(restoredSource);
      if (documentMetadata) {
        setPhotoshopDocumentMetadata(doc, { ...documentMetadata, originalSource });
      }
      const bySourceIndex = new Map(
        restoredSource.layers
          .filter((layer) => layer.photoshop)
          .map((layer) => [layer.photoshop!.sourceIndex, layer] as const),
      );
      for (const layer of doc.layers) {
        const sourceIndex = layer.photoshop?.sourceIndex;
        if (sourceIndex === undefined) continue;
        const sourceLayer = bySourceIndex.get(sourceIndex);
        const metadata = sourceLayer ? getPhotoshopLayerMetadata(sourceLayer) : undefined;
        if (metadata) setPhotoshopLayerMetadata(layer, metadata);
      }
    } catch {
      // The editable Luma state remains authoritative even if an optional
      // preservation source cannot be rehydrated on this runtime.
    }
  }
  return doc;
}

async function serializeLayerSnapshot(
  snapshot: LayerSnapshot,
  context: EncodeContext,
): Promise<SerializedLayerSnapshot> {
  const { bitmap, surface, mask, maskSurface, raw, ...metadata } = snapshot;
  return {
    ...metadata,
    bitmapAsset: bitmap ? await addCanvasAsset(context, bitmap) : undefined,
    surface: surface ? await serializePrecisionSurface(surface, context) : undefined,
    maskAsset: mask ? await addCanvasAsset(context, mask) : undefined,
    maskSurface: maskSurface ? await serializeAlphaSurface(maskSurface, context) : undefined,
    raw: raw ? {
      ...raw,
      settings: { ...raw.settings, customWhiteBalance: [...raw.settings.customWhiteBalance] },
      sensor: { ...raw.sensor, warnings: [...raw.sensor.warnings] },
      asset: await addRawAsset(context, raw.original),
    } : undefined,
  };
}

async function deserializeLayerSnapshot(
  source: SerializedLayerSnapshot,
  zip: JSZip,
): Promise<LayerSnapshot> {
  const { bitmapAsset, surface, maskAsset, maskSurface, raw, ...metadata } = source;
  return {
    ...metadata,
    bitmap: bitmapAsset ? await readCanvasAsset(zip, bitmapAsset) : undefined,
    surface: surface ? await deserializePrecisionSurface(surface, zip) : undefined,
    mask: maskAsset ? await readCanvasAsset(zip, maskAsset) : undefined,
    maskSurface: maskSurface ? await deserializeAlphaSurface(maskSurface, zip) : undefined,
    raw: raw ? await (async () => {
      const { asset, ...rawMetadata } = raw;
      return {
        ...rawMetadata,
        original: await readRawAsset(zip, asset),
        settings: { ...rawMetadata.settings, customWhiteBalance: [...rawMetadata.settings.customWhiteBalance] },
        sensor: { ...rawMetadata.sensor, warnings: [...rawMetadata.sensor.warnings] },
      };
    })() : undefined,
  };
}

async function addImageDataAsset(context: EncodeContext, image: ImageData) {
  const canvas = newCanvas(image.width, image.height);
  canvas.getContext("2d")!.putImageData(image, 0, 0);
  return addCanvasAsset(context, canvas);
}

async function readImageDataAsset(zip: JSZip, asset: string) {
  const canvas = await readCanvasAsset(zip, asset);
  return canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
}

async function serializeAlphaTileRecord(
  record: AlphaTileRecord | null,
  context: EncodeContext,
): Promise<SerializedAlphaTileRecord> {
  if (record === null) return null;
  return typeof record === "number"
    ? { uniform: record }
    : { asset: await addPrecisionAsset(context, record) };
}

async function deserializeAlphaTileRecord(
  record: SerializedAlphaTileRecord,
  zip: JSZip,
): Promise<AlphaTileRecord | null> {
  if (record === null) return null;
  if ((record.uniform === undefined) === (record.asset === undefined)) throw new Error("Invalid alpha history tile");
  if (record.uniform !== undefined) {
    if (!Number.isInteger(record.uniform) || record.uniform < 0 || record.uniform > 255) throw new Error("Invalid alpha history value");
    return record.uniform;
  }
  return readPrecisionAsset(zip, record.asset!);
}

async function serializeHistoryEntry(
  entry: HistoryEntry,
  context: EncodeContext,
): Promise<SerializedHistoryEntry> {
  const serialized: SerializedHistoryEntry = {
    label: entry.label,
    before: await Promise.all(entry.before.map((snapshot) => serializeLayerSnapshot(snapshot, context))),
    after: await Promise.all(entry.after.map((snapshot) => serializeLayerSnapshot(snapshot, context))),
  };
  if (entry.layersBefore) {
    serialized.layersBefore = await Promise.all(entry.layersBefore.map((layer) => serializeLayer(layer, context)));
  }
  if (entry.layersAfter) {
    serialized.layersAfter = await Promise.all(entry.layersAfter.map((layer) => serializeLayer(layer, context)));
  }
  if (entry.layerOrderBefore) serialized.layerOrderBefore = [...entry.layerOrderBefore];
  if (entry.layerOrderAfter) serialized.layerOrderAfter = [...entry.layerOrderAfter];
  if ("selectionBefore" in entry) {
    serialized.selectionBefore = entry.selectionBefore
      ? await serializeSelection(entry.selectionBefore, context)
      : null;
  }
  if ("selectionAfter" in entry) {
    serialized.selectionAfter = entry.selectionAfter
      ? await serializeSelection(entry.selectionAfter, context)
      : null;
  }
  if (entry.selectionTranslation) {
    const { source, beforeBounds, afterBounds, ...translation } = entry.selectionTranslation;
    serialized.selectionTranslation = {
      ...translation,
      sourceAsset: source ? await addImageDataAsset(context, source) : undefined,
      beforeBounds: { ...beforeBounds },
      afterBounds: { ...afterBounds },
    };
  }
  if (entry.pixelPatches) {
    serialized.pixelPatches = await Promise.all(entry.pixelPatches.map(async (patch) => ({
      layerId: patch.layerId,
      target: patch.target,
      x: patch.x,
      y: patch.y,
      beforeAsset: await addImageDataAsset(context, patch.before),
      afterAsset: await addImageDataAsset(context, patch.after),
    })));
  }
  if (entry.surfacePatches) {
    serialized.surfacePatches = await Promise.all(entry.surfacePatches.map(async (patch) => ({
      layerId: patch.layerId,
      key: patch.key,
      updateBitmap: patch.updateBitmap,
      beforeAsset: patch.before ? await addPrecisionAsset(context, patch.before) : undefined,
      afterAsset: patch.after ? await addPrecisionAsset(context, patch.after) : undefined,
    })));
  }
  if (entry.maskSurfacePatches) {
    serialized.maskSurfacePatches = await Promise.all(entry.maskSurfacePatches.map(async (patch) => ({
      layerId: patch.layerId,
      key: patch.key,
      before: await serializeAlphaTileRecord(patch.before, context),
      after: await serializeAlphaTileRecord(patch.after, context),
    })));
  }
  if (entry.guidesBefore) serialized.guidesBefore = entry.guidesBefore.map((guide) => ({ ...guide }));
  if (entry.guidesAfter) serialized.guidesAfter = entry.guidesAfter.map((guide) => ({ ...guide }));
  if (entry.documentBefore) serialized.documentBefore = await serializeDocument(entry.documentBefore, context);
  if (entry.documentAfter) serialized.documentAfter = await serializeDocument(entry.documentAfter, context);
  return serialized;
}

async function deserializeHistoryEntry(
  source: SerializedHistoryEntry,
  zip: JSZip,
): Promise<HistoryEntry> {
  const entry: HistoryEntry = {
    label: source.label,
    before: await Promise.all((source.before ?? []).map((snapshot) => deserializeLayerSnapshot(snapshot, zip))),
    after: await Promise.all((source.after ?? []).map((snapshot) => deserializeLayerSnapshot(snapshot, zip))),
  };
  if (source.layersBefore) {
    entry.layersBefore = await Promise.all(source.layersBefore.map((layer) => deserializeLayer(layer, zip, true)));
  }
  if (source.layersAfter) {
    entry.layersAfter = await Promise.all(source.layersAfter.map((layer) => deserializeLayer(layer, zip, true)));
  }
  if (source.layerOrderBefore) entry.layerOrderBefore = [...source.layerOrderBefore];
  if (source.layerOrderAfter) entry.layerOrderAfter = [...source.layerOrderAfter];
  if ("selectionBefore" in source) {
    entry.selectionBefore = source.selectionBefore
      ? await deserializeSelection(source.selectionBefore, zip)
      : null;
  }
  if ("selectionAfter" in source) {
    entry.selectionAfter = source.selectionAfter
      ? await deserializeSelection(source.selectionAfter, zip)
      : null;
  }
  if (source.selectionTranslation) {
    const { sourceAsset, beforeBounds, afterBounds, ...translation } = source.selectionTranslation;
    entry.selectionTranslation = {
      ...translation,
      source: sourceAsset ? await readImageDataAsset(zip, sourceAsset) : null,
      beforeBounds: { ...beforeBounds },
      afterBounds: { ...afterBounds },
    };
  }
  if (source.pixelPatches) {
    entry.pixelPatches = await Promise.all(source.pixelPatches.map(async (patch) => ({
      layerId: patch.layerId,
      target: patch.target,
      x: patch.x,
      y: patch.y,
      before: await readImageDataAsset(zip, patch.beforeAsset),
      after: await readImageDataAsset(zip, patch.afterAsset),
    })));
  }
  if (source.surfacePatches) {
    entry.surfacePatches = await Promise.all(source.surfacePatches.map(async (patch) => ({
      layerId: patch.layerId,
      key: patch.key,
      updateBitmap: patch.updateBitmap,
      before: patch.beforeAsset ? await readPrecisionAsset(zip, patch.beforeAsset) : null,
      after: patch.afterAsset ? await readPrecisionAsset(zip, patch.afterAsset) : null,
    })));
  }
  if (source.maskSurfacePatches) {
    entry.maskSurfacePatches = await Promise.all(source.maskSurfacePatches.map(async (patch) => ({
      layerId: patch.layerId,
      key: patch.key,
      before: await deserializeAlphaTileRecord(patch.before, zip),
      after: await deserializeAlphaTileRecord(patch.after, zip),
    })));
  }
  if (source.guidesBefore) entry.guidesBefore = source.guidesBefore.map((guide) => ({ ...guide }));
  if (source.guidesAfter) entry.guidesAfter = source.guidesAfter.map((guide) => ({ ...guide }));
  if (source.documentBefore) entry.documentBefore = await deserializeDocument(source.documentBefore, zip, true);
  if (source.documentAfter) entry.documentAfter = await deserializeDocument(source.documentAfter, zip, true);
  return entry;
}

async function serializeHistory(
  history: OperationHistorySnapshot<HistoryEntry>,
  context: EncodeContext,
): Promise<SerializedOperationHistory> {
  const nodes: SerializedHistoryNode[] = [];
  for (const node of history.nodes) {
    nodes.push({
      ...node,
      childIds: [...node.childIds],
      value: node.value ? await serializeHistoryEntry(node.value, context) : null,
    });
  }
  return {
    ...history,
    preferredChildren: history.preferredChildren.map((pair) => [...pair]),
    nodes,
  };
}

async function deserializeHistory(source: SerializedOperationHistory, zip: JSZip) {
  if (!source || source.format !== "luma-operation-history" || source.version !== 1 || !Array.isArray(source.nodes)) {
    throw new Error("Invalid Luma operation history");
  }
  const nodes: OperationNode<HistoryEntry>[] = [];
  for (const node of source.nodes) {
    nodes.push({
      ...node,
      childIds: [...node.childIds],
      value: node.value ? await deserializeHistoryEntry(node.value, zip) : null,
    });
  }
  return OperationHistory.fromSnapshot<HistoryEntry>({
    ...source,
    preferredChildren: source.preferredChildren.map((pair) => [...pair]),
    nodes,
  }, { maxNodes: RESTORED_HISTORY_LIMIT });
}

export async function encodeLumaProject(
  doc: Document,
  actions: Action[],
  name: string,
  history?: OperationHistorySnapshot<HistoryEntry>,
): Promise<Blob> {
  const zip = new JSZip();
  const context: EncodeContext = {
    zip,
    assets: new WeakMap(),
    precisionAssets: new Map(),
    rawAssets: new Map(),
    photoshopAssets: new Map(),
    nextAsset: 0,
    nextPrecisionAsset: 0,
    nextRawAsset: 0,
    nextPhotoshopAsset: 0,
  };
  const manifest: ProjectManifest = {
    format: "luma-project",
    version: LUMA_PROJECT_VERSION,
    name,
    savedAt: new Date().toISOString(),
    document: await serializeDocument(doc, context),
    actions,
    history: history ? await serializeHistory(history, context) : undefined,
  };
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  return zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 4 },
    mimeType: "application/x-luma-project",
  });
}

function assertManifest(value: unknown): asserts value is ProjectManifest {
  const manifest = value as Partial<ProjectManifest> | null;
  if (!manifest || manifest.format !== "luma-project") {
    throw new Error("Not a Luma project");
  }
  if (!SUPPORTED_PROJECT_VERSIONS.has(Number(manifest.version))) {
    throw new Error(`Unsupported Luma project version: ${String(manifest.version)}`);
  }
  const doc = manifest.document;
  if (!doc || !Number.isInteger(doc.width) || !Number.isInteger(doc.height) ||
      doc.width < 1 || doc.height < 1 || !Array.isArray(doc.layers) ||
      (doc.capturedBrushes !== undefined && !Array.isArray(doc.capturedBrushes))) {
    throw new Error("Invalid Luma project manifest");
  }
  if (doc.width > LUMA_PROJECT_LIMITS.dimension || doc.height > LUMA_PROJECT_LIMITS.dimension) {
    throw new Error("Luma project dimensions exceed the supported safety limit");
  }
  if (doc.layers.length > LUMA_PROJECT_LIMITS.layers) throw new Error("Luma project contains too many layers");
  if ((doc.capturedBrushes?.length ?? 0) > MAX_CAPTURED_BRUSHES) throw new Error("Luma project contains too many captured brushes");
  if (typeof manifest.name !== "string" || manifest.name.length > 500) throw new Error("Invalid Luma project name");
  if (manifest.actions !== undefined) {
    if (!Array.isArray(manifest.actions) || manifest.actions.length > LUMA_PROJECT_LIMITS.actions) throw new Error("Luma project contains too many actions");
    const steps = manifest.actions.reduce((count, action) => count + (Array.isArray(action?.steps) ? action.steps.length : LUMA_PROJECT_LIMITS.actionSteps + 1), 0);
    if (steps > LUMA_PROJECT_LIMITS.actionSteps) throw new Error("Luma project contains too many action steps");
  }
  if (manifest.history?.nodes && manifest.history.nodes.length > LUMA_PROJECT_LIMITS.historyNodes) {
    throw new Error("Luma project contains too many history nodes");
  }
}

export async function decodeLumaProject(
  blob: Blob | ArrayBuffer | Uint8Array,
  options: DecodeLumaProjectOptions = {},
): Promise<DecodedProject> {
  const archiveBytes = sourceByteLength(blob);
  if (archiveBytes > LUMA_PROJECT_LIMITS.archiveBytes) throw new Error("Luma project exceeds the 1 GB archive limit");
  const archive = blob instanceof Blob && typeof FileReader === "undefined"
    ? await blob.arrayBuffer()
    : blob;
  const zip = await JSZip.loadAsync(archive);
  assertSafeProjectArchive(zip, archiveBytes);
  const manifestFile = zip.file("manifest.json");
  if (!manifestFile) throw new Error("Project manifest is missing");
  const manifest: unknown = JSON.parse(await manifestFile.async("string"));
  assertManifest(manifest);
  const preserveIds = manifest.version >= 2;
  return {
    name: manifest.name,
    doc: await deserializeDocument(manifest.document, zip, preserveIds),
    actions: Array.isArray(manifest.actions) ? manifest.actions : [],
    history: options.restoreHistory !== false && manifest.version >= 2 && manifest.history
      ? await deserializeHistory(manifest.history, zip)
      : undefined,
  };
}
