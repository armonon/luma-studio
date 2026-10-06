import JSZip from "jszip";
import { validateCampaign, remapCampaign, type Campaign } from "./campaign";
import { generateBoundedProjectZip, inspectProjectEntry, readProjectEntryBytes } from "./project-zip-stream";
import { captureProjectPhotoshopPreservation, restoreProjectPhotoshopPreservation, type ProjectPhotoshopPreservation } from "./psd-project-preservation";
import { validateVectorPath } from "./vector-path";
import { validateLetteringAsset, validateLetteringLayer } from "./lettering-asset";
import { validateFormMesh } from "./form-mesh-asset";
import { inspectRasterHeader, PROJECT_DECODE_MEMORY_CEILING } from "./input-limits";
import { exceedsBrowserCanvas } from "./large-documents";
import { isSafeAction, type Action } from "./actions";
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
import { cloneProAdjustment, type ProAdjustmentParams } from "./pro-adjustments";
import { MAX_CUBE_SIZE } from "./cube-lut";
import type { WorkingColorSpace } from "./color";
import { importPsd } from "./psd";
import { getPhotoshopTileSource } from "./photoshop-tile-source";
import {
  getPhotoshopDocumentMetadata,
  getPhotoshopLayerMetadata,
  inspectPhotoshopHeader,
  setPhotoshopDocumentMetadata,
  setPhotoshopLayerMetadata,
} from "./psd-metadata";

import { validateDesignSnapshots, DESIGN_SNAPSHOT_LIMITS, type DesignSnapshot } from "./design-snapshots";
import { documentUserFontFamilies } from "./text-font-resources";
import { getUserFontBytes, installUserFont, isUserFontFamily } from "./user-fonts";

export const LUMA_PROJECT_VERSION = 15 as const;
const SUPPORTED_PROJECT_VERSIONS = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, LUMA_PROJECT_VERSION]);
/** Mirrors user-fonts.ts's own per-browser cap; an archive cannot carry more than that anyway. */
const MAX_EMBEDDED_FONTS = 32;
const RESTORED_HISTORY_LIMIT = 80;

/** Avoid simultaneous codec scratch allocations for every layer/history item. */
async function serialMap<T, R>(items: readonly T[], map: (item: T) => Promise<R>): Promise<R[]> {
  const result: R[] = [];
  for (const item of items) result.push(await map(item));
  return result;
}

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
  decodedBytes: PROJECT_DECODE_MEMORY_CEILING,
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
  baseSource?: { asset: string; layerIndex: number };
  deleted?: string[];
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

type SerializedLayer = Omit<Layer, "bitmap" | "surface" | "mask" | "maskSurface" | "raw" | "subjectMask" | "smartSource"> & {
  smartSourceAsset?: string;
  proAdjustmentLutAsset?: string;
  bitmapAsset?: string;
  surface?: SerializedPrecisionSurface;
  maskAsset?: string;
  maskSurface?: SerializedAlphaSurface;
  raw?: SerializedRawSource;
};

type SerializedCapturedBrush = Omit<CapturedBrushAsset, "bitmap"> & {
  bitmapAsset: string;
};

type SerializedAlphaChannel = { id: string; name: string; surface: SerializedAlphaSurface };
type SerializedDesignSnapshot = { id: string; name: string; asset: string };
type SerializedDocument = Omit<Document, "layers" | "selection" | "capturedBrushes" | "alphaChannels" | "designSnapshots"> & {
  designSnapshots?: SerializedDesignSnapshot[];
  alphaChannels?: SerializedAlphaChannel[];
  layers: SerializedLayer[];
  capturedBrushes?: SerializedCapturedBrush[];
  selection?: SerializedSelection;
  photoshopSourceAsset?: string;
  photoshopImportMode?: "layered" | "flattened";
  photoshopPreservation?: ProjectPhotoshopPreservation;
};

type SerializedLayerSnapshot = Omit<LayerSnapshot, "bitmap" | "surface" | "mask" | "maskSurface" | "raw" | "smartSource"> & {
  smartSourceAsset?: string | null;
  proAdjustmentLutAsset?: string;
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
  designSnapshotsBefore?: SerializedDesignSnapshot[];
  designSnapshotsAfter?: SerializedDesignSnapshot[];
  campaignBefore?: Campaign | null;
  campaignAfter?: Campaign | null;
  artboardsBefore?: NonNullable<Document["artboards"]>;
  artboardsAfter?: NonNullable<Document["artboards"]>;
  layoutBefore?: { width: number; height: number };
  layoutAfter?: { width: number; height: number };
  channelsBefore?: SerializedAlphaChannel[];
  channelsAfter?: SerializedAlphaChannel[];
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

/** An installed Glyph font this project's text layers use, embedded so it reopens anywhere. */
type SerializedEmbeddedFont = { family: string; asset: string };

type ProjectManifest = {
  format: "luma-project";
  version: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | typeof LUMA_PROJECT_VERSION;
  name: string;
  savedAt: string;
  document: SerializedDocument;
  actions: Action[];
  history?: SerializedOperationHistory;
  fonts?: SerializedEmbeddedFont[];
};

export type DecodedProject = {
  name: string;
  doc: Document;
  actions: Action[];
  history?: OperationHistory<HistoryEntry>;
};

export type DecodeLumaProjectOptions = {
  /** May lower, never raise, the aggregate decode admission ceiling. */
  maximumDecodedBytes?: number;
  /** The owner reserves process-wide working memory before any pixel decode. */
  admitDecodedBytes?: (bytes: number) => () => void;
  /**
   * Recovery only needs the last committed document state. Skipping history
   * leaves its archived assets compressed inside the ZIP instead of inflating
   * every undo snapshot during startup. Normal project opens still restore the
   * complete history by default.
   */
  restoreHistory?: boolean;
};

/** Count references, not unique ZIP entries: each mutable canvas is decoded separately. */
export async function assertProjectDecodeAdmission(zip: JSZip, manifest: unknown, ceiling = LUMA_PROJECT_LIMITS.decodedBytes as number, encodedSizes?: ReadonlyMap<string, number>, encodedPrefixes?: ReadonlyMap<string, Uint8Array>) {
  if (!Number.isSafeInteger(ceiling) || ceiling < 1 || ceiling > LUMA_PROJECT_LIMITS.decodedBytes) throw new Error("Invalid project decoded-memory ceiling");
  const references = new Map<string, number>();
  const streamedSources = new Map<string, number>();
  const canvasReferences = new Map<string, number>();
  const sourceBases = new Set<string>();
  let descriptorBytes = 0;
  const pending: unknown[] = [manifest];
  let objects = 0;
  while (pending.length) {
    const value = pending.pop();
    if (++objects > 2_000_000) throw new Error("Project manifest complexity exceeds the safety limit");
    if (typeof value === "string" && value.startsWith("assets/")) references.set(value, (references.get(value) ?? 0) + 1);
    else if (value && typeof value === "object") {
      for (const key of ["bitmapAsset", "maskAsset"] as const) {
        const asset = (value as Record<string, unknown>)[key];
        if (typeof asset === "string" && asset.startsWith("assets/")) canvasReferences.set(asset, (canvasReferences.get(asset) ?? 0) + 1);
      }
      const candidate = value as Partial<SerializedDocument>;
      const surface = value as Partial<SerializedPrecisionSurface>;
      if (surface.baseSource && typeof surface.baseSource.asset === "string") {
        const asset = surface.baseSource.asset;
        if (!sourceBases.has(asset)) { sourceBases.add(asset); descriptorBytes += 128 * 1024 * 1024; }
        streamedSources.set(asset, (streamedSources.get(asset) ?? 0) + 1);
        // Per-source channel indexes plus globally bounded decode scratch.
        descriptorBytes += 128 * 1024;
      }
      if (typeof candidate.photoshopSourceAsset === "string" && candidate.photoshopPreservation?.version === 1) {
        const asset = candidate.photoshopSourceAsset;
        streamedSources.set(asset, (streamedSources.get(asset) ?? 0) + 1);
        descriptorBytes += (candidate.photoshopImportMode === "flattened" ? 4 : 64) * 1024 * 1024;
      }
      for (const child of Object.values(value)) pending.push(child);
    }
  }
  let estimatedBytes = descriptorBytes;
  let bitmapScratchBytes = 0;
  for (const [asset, count] of references) {
    const file = zip.file(asset) as SizedZipEntry | null;
    if (!file) throw new Error(`Missing project asset: ${asset}`);
    const bytes = encodedSizes?.get(asset) ?? file._data?.uncompressedSize;
    if (!Number.isSafeInteger(bytes) || bytes! < 0) throw new Error(`Invalid project asset size: ${asset}`);
    // Include decompression, working copies and history restore copies.
    // v9 metadata-only sources are streamed into one owned buffer, with no
    // second Photoshop pixel decode. Older projects retain their prior bound.
    const streamed = Math.min(count, streamedSources.get(asset) ?? 0);
    {
      const signature = encodedPrefixes?.get(asset) ?? (await inspectProjectEntry(file, LUMA_PROJECT_LIMITS.entryBytes, bytes)).prefix;
      // Only PNG assets become canvases here. RAW/TIFF payloads may need more
      // than 32 bytes to parse and remain opaque until their own decoder runs.
      const header = signature[0] === 137 && signature[1] === 80 && signature[2] === 78 && signature[3] === 71
        ? inspectRasterHeader(signature.buffer.slice(signature.byteOffset, signature.byteOffset + signature.byteLength) as ArrayBuffer) : null;
      if (header?.format === "png") {
        if (!header.width || !header.height || exceedsBrowserCanvas(header.width, header.height)) throw new Error("Project bitmap has unsafe PNG dimensions");
        // Canvas restore is serial: retain each mutable backing store, but only
        // one decoder image/encoded working set exists at a time. readCanvasAsset
        // streams into one buffer and closes the decoder image before continuing.
        const plane = header.width * header.height * 4;
        estimatedBytes += plane * count;
        // Only fields that actually consume canvases qualify for streamed PNG
        // scratch. Opaque/raw assets can contain a PNG signature too and must
        // still reserve each retained byte payload, including repeated refs.
        estimatedBytes += bytes! * 4 * (count - Math.min(count, canvasReferences.get(asset) ?? 0));
        bitmapScratchBytes = Math.max(bitmapScratchBytes, plane + bytes! * 3);
      } else {
        estimatedBytes += bytes! * ((count - streamed) * 4 + (streamed ? 1 : 0));
      }
      if (!Number.isSafeInteger(estimatedBytes + bitmapScratchBytes) || estimatedBytes + bitmapScratchBytes > ceiling) {
        throw new Error(`Project exceeds the aggregate decoded-memory ceiling (${Math.ceil((estimatedBytes + bitmapScratchBytes) / 1024 / 1024)} MiB required so far; ${Math.floor(ceiling / 1024 / 1024)} MiB limit; asset ${asset}, ${count} references). The document has not been saved or changed.`);
      }
    }
  }
  return estimatedBytes + bitmapScratchBytes;
}

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
    try {
      const canvas = newCanvas(image.width, image.height);
      canvas.getContext("2d")!.drawImage(image, 0, 0);
      return canvas;
    } finally { image.close(); }
  }
  const url = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = reject;
      element.src = url;
    });
    try {
      const canvas = newCanvas(image.naturalWidth, image.naturalHeight);
      canvas.getContext("2d")!.drawImage(image, 0, 0);
      return canvas;
    } finally { image.src = ""; }
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function readCanvasAsset(zip: JSZip, asset: string, expected?: { width: number; height: number }) {
  if (!asset.startsWith("assets/")) throw new Error(`Invalid project asset: ${asset}`);
  const file = zip.file(asset) as SizedZipEntry | null;
  if (!file) throw new Error(`Missing project asset: ${asset}`);
  const bytes = await readProjectEntryBytes(file, file._data?.uncompressedSize ?? 0, LUMA_PROJECT_LIMITS.entryBytes);
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "image/png" });
  const header = inspectRasterHeader(await blob.slice(0, 32).arrayBuffer());
  if (!header || header.format !== "png" || !header.width || !header.height || exceedsBrowserCanvas(header.width, header.height)) throw new Error("Project bitmap has invalid or unsafe PNG dimensions; use tiled surfaces for large artwork.");
  if (expected && (header.width !== expected.width || header.height !== expected.height)) throw new Error("3D committed render dimensions do not match its source.");
  return blobCanvas(blob);
}

async function serializePrecisionSurface(
  surface: PrecisionTileSurface,
  context: EncodeContext,
): Promise<SerializedPrecisionSurface> {
  const tiles: SerializedPrecisionSurface["tiles"] = [];
  const source = surface.store.sourceState();
  for (const { key, data } of surface.store.editEntries()) {
    tiles.push({ key, asset: await addPrecisionAsset(context, data) });
  }
  return {
    width: surface.grid.width,
    height: surface.grid.height,
    format: surface.format,
    colorSpace: surface.colorSpace,
    tileSize: surface.grid.tileSize,
    tiles,
    ...(source ? { baseSource: { asset: await addPhotoshopAsset(context, source.base.source.bytes), layerIndex: source.base.source.layerIndex }, deleted: source.deleted } : {}),
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

async function serializeSmartSource(context: EncodeContext, bytes: Uint8Array) {
  if (bytes.byteLength < 4 || bytes.byteLength > 32 * 1024 * 1024 || bytes[0] !== 80 || bytes[1] !== 75) throw new Error("Invalid embedded Smart Object project");
  return addPrecisionAsset(context, bytes);
}
async function deserializeSmartSource(zip: JSZip, asset: string) {
  if (typeof asset !== "string" || !asset.startsWith("assets/precision/") || !asset.endsWith(".bin")) throw new Error("Invalid Smart Object source asset");
  const file = zip.file(asset) as SizedZipEntry | null;
  if (!file) throw new Error("Missing Smart Object source asset");
  const bytes = await readProjectEntryBytes(file, file._data?.uncompressedSize ?? 0, 32 * 1024 * 1024);
  if (bytes.byteLength < 4 || bytes[0] !== 80 || bytes[1] !== 75) throw new Error("Invalid embedded Smart Object project");
  return bytes;
}

/** Keep repeated LUTs out of the JSON manifest; preserve every numeric sample. */
async function serializeProAdjustment(adjustment: ProAdjustmentParams | undefined, context: EncodeContext) {
  if (!adjustment) return {};
  const proAdjustment = cloneProAdjustment(adjustment);
  if (proAdjustment.kind !== "color-lookup" || !proAdjustment.lut) return { proAdjustment };
  const values = proAdjustment.lut.values;
  const bytes = new Uint8Array(values.length * 8);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < values.length; i++) view.setFloat64(i * 8, values[i], true);
  proAdjustment.lut.values = [];
  return { proAdjustment, proAdjustmentLutAsset: await addPrecisionAsset(context, bytes) };
}

async function deserializeProAdjustment(adjustment: ProAdjustmentParams | undefined, asset: string | undefined, zip: JSZip) {
  if (asset === undefined) return adjustment ? cloneProAdjustment(adjustment) : undefined;
  if (typeof asset !== "string" || !asset.startsWith("assets/precision/") || !asset.endsWith(".bin") ||
      adjustment?.kind !== "color-lookup" || !adjustment.lut || !Array.isArray(adjustment.lut.values) ||
      adjustment.lut.values.length !== 0 || !Number.isInteger(adjustment.lut.size) ||
      adjustment.lut.size < 2 || adjustment.lut.size > MAX_CUBE_SIZE) throw new Error("Invalid project LUT asset");
  const expectedBytes = adjustment.lut.size ** 3 * 3 * 8;
  const file = zip.file(asset) as SizedZipEntry | null;
  if (!file || file._data?.uncompressedSize !== expectedBytes) throw new Error("Missing or invalid project LUT samples");
  const bytes = await readProjectEntryBytes(file, expectedBytes, expectedBytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const values = Array.from({ length: expectedBytes / 8 }, (_, i) => view.getFloat64(i * 8, true));
  return cloneProAdjustment({ ...adjustment, lut: { ...adjustment.lut, values } });
}

async function digestBytes(data: Uint8Array) {
  if (globalThis.crypto?.subtle) {
    // WebCrypto snapshots the supplied BufferSource. Passing the exact view
    // avoids an extra full-size JS copy of a preserved PSD or RAW payload.
    const source = data.buffer instanceof ArrayBuffer
      ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
      : Uint8Array.from(data);
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

const photoshopAssetIdentities = new WeakMap<EncodeContext, WeakMap<Uint8Array, string>>();
async function addPhotoshopAsset(context: EncodeContext, data: Uint8Array) {
  let identities = photoshopAssetIdentities.get(context);
  if (!identities) { identities = new WeakMap(); photoshopAssetIdentities.set(context, identities); }
  const known = identities.get(data);
  if (known) return known;
  const digest = await digestBytes(data);
  let asset = context.photoshopAssets.get(digest);
  if (!asset) {
    context.nextPhotoshopAsset += 1;
    asset = `assets/photoshop/${context.nextPhotoshopAsset.toString().padStart(4, "0")}-${digest.slice(0, 12)}.bin`;
    context.zip.file(asset, data);
    context.photoshopAssets.set(digest, asset);
  }
  identities.set(data, asset);
  return asset;
}

const photoshopAssetReads = new WeakMap<JSZip, Map<string, Promise<Uint8Array<ArrayBuffer>>>>();
async function readPhotoshopAsset(zip: JSZip, asset: string) {
  if (!asset.startsWith("assets/photoshop/") || !asset.endsWith(".bin")) {
    throw new Error(`Invalid Photoshop source asset: ${asset}`);
  }
  const file = zip.file(asset);
  if (!file) throw new Error(`Missing Photoshop source asset: ${asset}`);
  const size = (file as SizedZipEntry)._data?.uncompressedSize;
  let reads = photoshopAssetReads.get(zip);
  if (!reads) { reads = new Map(); photoshopAssetReads.set(zip, reads); }
  let result = reads.get(asset);
  if (!result) {
    result = readProjectEntryBytes(file, size!, LUMA_PROJECT_LIMITS.entryBytes);
    reads.set(asset, result);
  }
  return result;
}

async function deserializePrecisionSurface(source: SerializedPrecisionSurface, zip: JSZip) {
  if (!source || !Number.isInteger(source.width) || !Number.isInteger(source.height) ||
      !["rgba8", "rgba16f", "rgba32f"].includes(source.format) ||
      !["srgb", "display-p3", "linear-srgb"].includes(source.colorSpace) || !Array.isArray(source.tiles)) {
    throw new Error("Invalid precision surface");
  }
  const surface = new PrecisionTileSurface(source.width, source.height, source.format, source.colorSpace, source.tileSize);
  if (source.baseSource) {
    if (source.format !== "rgba32f" || source.colorSpace !== "srgb" || source.tileSize !== 256 || !Array.isArray(source.deleted) || source.deleted.some(key => typeof key !== "string")) throw new Error("Invalid source-backed precision surface");
    const bytes = await readPhotoshopAsset(zip, source.baseSource.asset);
    surface.store.attachSource(getPhotoshopTileSource(bytes, source.baseSource.layerIndex), source.deleted);
  } else if (source.deleted?.length) throw new Error("Deleted base tiles require a source");
  const keys = new Set<string>();
  for (const tile of source.tiles) {
    if (keys.has(tile.key)) throw new Error("Duplicate precision tile");
    keys.add(tile.key);
    surface.store.write(tile.key, await readPrecisionAsset(zip, tile.asset));
  }
  surface.store.drainDirty();
  return surface;
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

function validateMeshLayer(layer: Layer) {
  validateFormMesh(layer.mesh3d);
  if (layer.kind !== "smart-object" || layer.lettering3d || layer.text || layer.path || layer.raw || layer.spatial?.enabled ||
    !layer.bitmap || layer.bitmap.width !== 1600 || layer.bitmap.height !== 1200) throw new Error("Mesh source has conflicting content or is missing its committed render.");
}

async function serializeLayer(layer: Layer, context: EncodeContext): Promise<SerializedLayer> {
  if (layer.mesh3d) validateMeshLayer(layer);
  if (layer.lettering3d) validateLetteringLayer(layer);
  // subjectMask is a canvas and derived data — recomputable from the layer by
  // the same model that produced it. Left in the spread it went through
  // JSON.stringify as `{}`, which is truthy but has no getContext, so a
  // reopened document threw the moment a subject-restricted effect drew.
  const { bitmap, surface, mask, maskSurface, raw, subjectMask, smartSource, ...metadata } = layer;
  void subjectMask;
  return {
    ...metadata,
    smartSourceAsset: smartSource ? await serializeSmartSource(context, smartSource) : undefined,
    ...await serializeProAdjustment(metadata.proAdjustment, context),
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
  const { bitmapAsset, surface, maskAsset, maskSurface, raw, proAdjustmentLutAsset, smartSourceAsset, ...metadata } = source;
  metadata.proAdjustment = await deserializeProAdjustment(metadata.proAdjustment, proAdjustmentLutAsset, zip);
  if (metadata.transform.skewX !== undefined && !Number.isFinite(metadata.transform.skewX)) throw new Error("Invalid layer shear in Luma project");
  if (metadata.path) validateVectorPath(metadata.path);
  if (metadata.vectorMask) validateVectorPath(metadata.vectorMask);
  if (metadata.lettering3d) validateLetteringAsset(metadata.lettering3d);
  if (metadata.mesh3d) validateFormMesh(metadata.mesh3d);
  const id = preserveId ? metadata.id : nextId(metadata.kind);
  if (preserveId) reserveId(id);
  else idMap?.set(metadata.id, id);
  const layer: Layer = {
    ...metadata,
    id,
    transform: { ...metadata.transform },
    smartSource: smartSourceAsset === undefined ? undefined : await deserializeSmartSource(zip, smartSourceAsset),
  };
  if (bitmapAsset) layer.bitmap = await readCanvasAsset(zip, bitmapAsset, metadata.lettering3d ?? metadata.mesh3d);
  if (layer.mesh3d) validateMeshLayer(layer);
  if (layer.lettering3d) validateLetteringLayer(layer);
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

async function serializeAlphaChannels(channels: NonNullable<Document["alphaChannels"]>, context: EncodeContext): Promise<SerializedAlphaChannel[]> {
  if (channels.length > 64) throw new Error("Too many saved alpha channels");
  return serialMap(channels, async channel => ({ id: channel.id, name: channel.name, surface: await serializeAlphaSurface(channel.surface, context) }));
}

async function deserializeAlphaChannels(channels: SerializedAlphaChannel[], zip: JSZip, dimensions?: { width: number; height: number }) {
  if (!Array.isArray(channels) || channels.length > 64) throw new Error("Invalid saved alpha channels");
  const ids = new Set<string>();
  return serialMap(channels, async channel => {
    if (!channel || typeof channel.id !== "string" || !channel.id || channel.id.length > 120 || ids.has(channel.id) ||
        typeof channel.name !== "string" || !channel.name.trim() || channel.name.length > 80) throw new Error("Invalid alpha channel identity");
    ids.add(channel.id); reserveId(channel.id);
    const surface = await deserializeAlphaSurface(channel.surface, zip);
    if (dimensions && (surface.width !== dimensions.width || surface.height !== dimensions.height)) throw new Error("Alpha channel dimensions do not match the document");
    return { id: channel.id, name: channel.name, surface };
  });
}

const snapshotAssets = new WeakMap<EncodeContext, Map<Uint8Array, string>>();
const snapshotReads = new WeakMap<JSZip, Map<string, Promise<Uint8Array>>>();
async function serializeDesignSnapshots(values: DesignSnapshot[], context: EncodeContext): Promise<SerializedDesignSnapshot[]> {
  validateDesignSnapshots(values);
  let assets = snapshotAssets.get(context);
  if (!assets) { assets = new Map(); snapshotAssets.set(context, assets); }
  return serialMap(values, async value => {
    let asset = assets!.get(value.bytes);
    if (!asset) {
      asset = `assets/design-variants/${assets!.size + 1}.luma`;
      context.zip.file(asset, value.bytes); assets!.set(value.bytes, asset);
    }
    return { id: value.id, name: value.name, asset };
  });
}
async function deserializeDesignSnapshots(values: SerializedDesignSnapshot[], zip: JSZip): Promise<DesignSnapshot[]> {
  if (!Array.isArray(values) || values.length > DESIGN_SNAPSHOT_LIMITS.count) throw new Error("Invalid full variant count");
  let bytes = 0;
  // Validate the complete set before inflating even its first archive.
  for (const value of values) {
    if (!value || typeof value.asset !== "string" || !/^assets\/design-variants\/\d+\.luma$/.test(value.asset)) throw new Error("Invalid full variant asset");
    const size = (zip.file(value.asset) as SizedZipEntry | null)?._data?.uncompressedSize;
    if (!Number.isSafeInteger(size) || size! < 4) throw new Error("Missing or invalid full variant archive");
    bytes += size!;
    if (bytes > DESIGN_SNAPSHOT_LIMITS.bytes) throw new Error("Full variants exceed the 128 MiB archive budget");
  }
  validateDesignSnapshots(values.map(value => ({ ...value, bytes: new Uint8Array(4) })));
  let reads = snapshotReads.get(zip);
  if (!reads) { reads = new Map(); snapshotReads.set(zip, reads); }
  const result = await serialMap(values, async value => {
    let pending = reads!.get(value.asset);
    if (!pending) {
      const file = zip.file(value.asset)! as SizedZipEntry;
      pending = readProjectEntryBytes(file, file._data!.uncompressedSize!, DESIGN_SNAPSHOT_LIMITS.bytes);
      reads!.set(value.asset, pending);
    }
    return { id: value.id, name: value.name, bytes: await pending };
  });
  return validateDesignSnapshots(result);
}

async function serializeDocument(doc: Document, context: EncodeContext): Promise<SerializedDocument> {
  const layers = await serialMap(doc.layers, (layer) => serializeLayer(layer, context));
  const capturedBrushes = await serialMap(doc.capturedBrushes ?? [], async ({ bitmap, ...brush }) => ({
    ...brush,
    bitmapAsset: await addCanvasAsset(context, bitmap),
  }));
  const photoshopMetadata = getPhotoshopDocumentMetadata(doc);
  const photoshopSource = photoshopMetadata?.originalSource;
  const selection = doc.selection ? await serializeSelection(doc.selection, context) : undefined;
  return {
    alphaChannels: doc.alphaChannels ? await serializeAlphaChannels(doc.alphaChannels, context) : undefined,
    campaign: validateCampaign(doc.campaign),
    designSnapshots: doc.designSnapshots ? await serializeDesignSnapshots(doc.designSnapshots, context) : undefined,
    width: doc.width,
    height: doc.height,
    colorSpace: doc.colorSpace,
    bitDepth: doc.bitDepth,
    resolution: { ...doc.resolution },
    globalLight: doc.globalLight ? { ...doc.globalLight } : undefined,
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
    photoshopImportMode: photoshopMetadata?.importMode,
    photoshopPreservation: captureProjectPhotoshopPreservation(doc),
  };
}

async function deserializeDocument(
  source: SerializedDocument,
  zip: JSZip,
  preserveIds: boolean,
): Promise<Document> {
  if (source.globalLight && (!Number.isFinite(source.globalLight.angle) || !Number.isFinite(source.globalLight.altitude))) throw new Error("Invalid document global light");
  const idMap = preserveIds ? undefined : new Map<string, string>();
  const layers: Layer[] = [];
  for (const layer of source.layers) layers.push(await deserializeLayer(layer, zip, preserveIds, idMap));
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
  const capturedBrushes = await serialMap(capturedBrushSources, async (brush) => {
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
  });
  const doc: Document = {
    alphaChannels: source.alphaChannels ? await deserializeAlphaChannels(source.alphaChannels, zip, source) : undefined,
    width: source.width,
    height: source.height,
    colorSpace: source.colorSpace ?? "srgb",
    bitDepth: source.bitDepth ?? 8,
    resolution: source.resolution ?? { x: 72, y: 72, unit: "ppi" },
    globalLight: source.globalLight ? { ...source.globalLight } : undefined,
    guides: (source.guides ?? []).map((guide) => ({ ...guide })),
    proofing: source.proofing ? { ...source.proofing } : {
      profile: "none",
      intent: "relative-colorimetric",
      blackPointCompensation: true,
      gamutWarning: false,
    },
    capturedBrushes,
    campaign: remapCampaign(source.campaign,idMap),
    designSnapshots: source.designSnapshots ? await deserializeDesignSnapshots(source.designSnapshots, zip) : undefined,
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
      if (source.photoshopPreservation) {
        restoreProjectPhotoshopPreservation(doc, originalSource, source.photoshopImportMode, source.photoshopPreservation);
      } else {
      const buffer = originalSource.buffer.slice(
        originalSource.byteOffset,
        originalSource.byteOffset + originalSource.byteLength,
      ) as ArrayBuffer;
      const restoredSource = await importPsd(buffer, {
        mode: source.photoshopImportMode === "flattened" ? "flattened" : "auto",
      });
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
      }
    } catch (error) {
      // Never silently lose the preservation source on the next save. A
      // metadata-only fallback has no fingerprints, so it cannot authorize
      // stale source passthrough; compatibility preflight reports the loss.
      const headerBytes = originalSource.slice(0, 26);
      setPhotoshopDocumentMetadata(doc, {
        header: inspectPhotoshopHeader(headerBytes.buffer),
        originalSource,
        importMode: source.photoshopImportMode,
        rawImageResources: [],
        importedIssues: [{
          code: "PRESERVATION_RESTORE_FAILED", severity: "error",
          message: `Photoshop preservation descriptors could not be restored. The original source is retained in this Luma project, but faithful Photoshop export is not available: ${error instanceof Error ? error.message : "decoder failure"}`,
        }],
      });
    }
  }
  return doc;
}

async function serializeLayerSnapshot(
  snapshot: LayerSnapshot,
  context: EncodeContext,
): Promise<SerializedLayerSnapshot> {
  const { bitmap, surface, mask, maskSurface, raw, smartSource, ...metadata } = snapshot;
  return {
    ...metadata,
    smartSourceAsset: smartSource ? await serializeSmartSource(context, smartSource) : smartSource,
    ...await serializeProAdjustment(metadata.proAdjustment, context),
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
  const { bitmapAsset, surface, maskAsset, maskSurface, raw, proAdjustmentLutAsset, smartSourceAsset, ...metadata } = source;
  metadata.proAdjustment = await deserializeProAdjustment(metadata.proAdjustment, proAdjustmentLutAsset, zip);
  if (metadata.path) validateVectorPath(metadata.path);
  if (metadata.lettering3d) {
    validateLetteringAsset(metadata.lettering3d);
    if (!bitmapAsset) throw new Error("3D history is missing its committed render.");
  }
  if (metadata.mesh3d) {
    validateFormMesh(metadata.mesh3d);
    if (!bitmapAsset) throw new Error("Mesh history is missing its committed render.");
  }
  return {
    ...metadata,
    smartSource: smartSourceAsset == null ? smartSourceAsset : await deserializeSmartSource(zip, smartSourceAsset),
    bitmap: bitmapAsset ? await readCanvasAsset(zip, bitmapAsset, metadata.lettering3d ?? metadata.mesh3d) : undefined,
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
  try { return canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height); }
  finally { canvas.width = 1; canvas.height = 1; }
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
    designSnapshotsBefore: entry.designSnapshotsBefore ? await serializeDesignSnapshots(entry.designSnapshotsBefore, context) : undefined,
    designSnapshotsAfter: entry.designSnapshotsAfter ? await serializeDesignSnapshots(entry.designSnapshotsAfter, context) : undefined,
    ...(entry.campaignBefore!==undefined?{campaignBefore:entry.campaignBefore===null?null:validateCampaign(entry.campaignBefore)}:{}),
    ...(entry.campaignAfter!==undefined?{campaignAfter:entry.campaignAfter===null?null:validateCampaign(entry.campaignAfter)}:{}),
    artboardsBefore:entry.artboardsBefore,artboardsAfter:entry.artboardsAfter,
    layoutBefore:entry.layoutBefore,layoutAfter:entry.layoutAfter,
    channelsBefore: entry.channelsBefore ? await serializeAlphaChannels(entry.channelsBefore, context) : undefined,
    channelsAfter: entry.channelsAfter ? await serializeAlphaChannels(entry.channelsAfter, context) : undefined,
    label: entry.label,
    before: await serialMap(entry.before, (snapshot) => serializeLayerSnapshot(snapshot, context)),
    after: await serialMap(entry.after, (snapshot) => serializeLayerSnapshot(snapshot, context)),
  };
  if (entry.layersBefore) {
    serialized.layersBefore = await serialMap(entry.layersBefore, (layer) => serializeLayer(layer, context));
  }
  if (entry.layersAfter) {
    serialized.layersAfter = await serialMap(entry.layersAfter, (layer) => serializeLayer(layer, context));
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
    designSnapshotsBefore: source.designSnapshotsBefore ? await deserializeDesignSnapshots(source.designSnapshotsBefore, zip) : undefined,
    designSnapshotsAfter: source.designSnapshotsAfter ? await deserializeDesignSnapshots(source.designSnapshotsAfter, zip) : undefined,
    ...(source.campaignBefore!==undefined?{campaignBefore:source.campaignBefore===null?null:remapCampaign(source.campaignBefore)}:{}),
    ...(source.campaignAfter!==undefined?{campaignAfter:source.campaignAfter===null?null:remapCampaign(source.campaignAfter)}:{}),
    channelsBefore: source.channelsBefore ? await deserializeAlphaChannels(source.channelsBefore, zip) : undefined,
    channelsAfter: source.channelsAfter ? await deserializeAlphaChannels(source.channelsAfter, zip) : undefined,
    label: source.label,
    before: await serialMap(source.before ?? [], (snapshot) => deserializeLayerSnapshot(snapshot, zip)),
    after: await serialMap(source.after ?? [], (snapshot) => deserializeLayerSnapshot(snapshot, zip)),
  };
  for(const key of ["artboardsBefore","artboardsAfter"] as const)if(source[key]!==undefined){
    const boards=source[key]!;
    if(!Array.isArray(boards)||boards.length>128||boards.some(a=>!a||typeof a.id!=="string"||typeof a.name!=="string"||a.name.length>80||![a.x,a.y,a.width,a.height].every(n=>Number.isFinite(n)&&n>=0&&n<=300000)||a.width<1||a.height<1))throw new Error("Invalid campaign artboard history");
    boards.forEach(a=>reserveId(a.id));entry[key]=structuredClone(boards);
  }
  for(const key of ["layoutBefore","layoutAfter"] as const)if(source[key]!==undefined){
    const size=source[key]!;
    if(!size||![size.width,size.height].every(n=>Number.isSafeInteger(n)&&n>=1&&n<=300000))throw new Error("Invalid campaign canvas history");
    entry[key]={...size};
  }
  if (source.layersBefore) {
    entry.layersBefore = await serialMap(source.layersBefore, (layer) => deserializeLayer(layer, zip, true));
  }
  if (source.layersAfter) {
    entry.layersAfter = await serialMap(source.layersAfter, (layer) => deserializeLayer(layer, zip, true));
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
    entry.pixelPatches = await serialMap(source.pixelPatches, async (patch) => ({
      layerId: patch.layerId,
      target: patch.target,
      x: patch.x,
      y: patch.y,
      before: await readImageDataAsset(zip, patch.beforeAsset),
      after: await readImageDataAsset(zip, patch.afterAsset),
    }));
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

/**
 * Embed the SFNT bytes for every installed Glyph font this document's text
 * layers actually use, so the project renders correctly in a browser that
 * never installed that font. Best-effort: a font whose stored bytes can't be
 * read is skipped rather than failing the whole save, matching how text
 * already falls back to the next family in its stack when a font is missing.
 */
async function serializeEmbeddedFonts(doc: Document, zip: JSZip): Promise<SerializedEmbeddedFont[] | undefined> {
  const families = documentUserFontFamilies(doc).slice(0, MAX_EMBEDDED_FONTS);
  const fonts: SerializedEmbeddedFont[] = [];
  for (const family of families) {
    const bytes = await getUserFontBytes(family).catch(() => undefined);
    if (!bytes) continue;
    const asset = `fonts/${fonts.length + 1}.font`;
    zip.file(asset, bytes);
    fonts.push({ family, asset });
  }
  return fonts.length ? fonts : undefined;
}

export async function encodeLumaProject(
  doc: Document,
  actions: Action[],
  name: string,
  history?: OperationHistorySnapshot<HistoryEntry>,
  options: { mode?: "project" | "recovery"; maximumArchiveBytes?: number } = {},
): Promise<Blob> {
  const recovery = options.mode === "recovery";
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
    // Recovery checkpoints run constantly and only need the pixels back; a
    // font still on this browser's Glyph library needs no help to reopen.
    fonts: recovery ? undefined : await serializeEmbeddedFonts(doc, zip),
  };
  assertManifest(manifest);
  // Save and recovery must obey the same restore contract as untrusted input.
  // Inspect existing entry data one at a time, without making a second ZIP or
  // decoding canvases merely to validate our own output.
  const sizes = new Map<string, number>();
  const prefixes = new Map<string, Uint8Array>();
  let expanded = 0;
  const manifestText = recovery ? JSON.stringify(manifest) : JSON.stringify(manifest, null, 2);
  const manifestBytes = new TextEncoder().encode(manifestText).byteLength;
  if (manifestBytes > LUMA_PROJECT_LIMITS.manifestBytes) throw new Error("Project manifest exceeds the safety limit");
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    const { size, prefix } = await inspectProjectEntry(entry, LUMA_PROJECT_LIMITS.entryBytes);
    if (size > LUMA_PROJECT_LIMITS.entryBytes) throw new Error(`Project entry is too large: ${entry.name}`);
    sizes.set(entry.name, size);
    prefixes.set(entry.name, prefix);
    expanded += size;
    if (expanded + manifestBytes > LUMA_PROJECT_LIMITS.expandedBytes) throw new Error("Expanded Luma project exceeds the safety limit");
  }
  if (sizes.size + 1 > LUMA_PROJECT_LIMITS.entries) throw new Error("Luma project contains too many archive entries");
  await assertProjectDecodeAdmission(zip, manifest, LUMA_PROJECT_LIMITS.decodedBytes, sizes, prefixes);
  // Recovery runs repeatedly and must finish quickly under memory pressure.
  // A compact manifest and low-cost deflate reduce both transient work and
  // checkpoint latency; explicit project saves keep the stronger compression.
  zip.file("manifest.json", manifestText);
  const maximumArchiveBytes = Math.min(options.maximumArchiveBytes ?? LUMA_PROJECT_LIMITS.archiveBytes, LUMA_PROJECT_LIMITS.archiveBytes);
  const blob = await generateBoundedProjectZip(zip, maximumArchiveBytes, recovery ? 1 : 4);
  if (blob.size > LUMA_PROJECT_LIMITS.archiveBytes) throw new Error("Luma project exceeds the 1 GB archive limit");
  if (expanded + manifestBytes > Math.max(256 * 1024 * 1024, blob.size * 250)) throw new Error("Luma project has an unsafe archive expansion ratio");
  return blob;
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
    if (!manifest.actions.every(isSafeAction)) throw new Error("Luma project contains a malformed or unsupported action");
  }
  if (manifest.history?.nodes && manifest.history.nodes.length > LUMA_PROJECT_LIMITS.historyNodes) {
    throw new Error("Luma project contains too many history nodes");
  }
  if (manifest.fonts !== undefined) {
    if (!Array.isArray(manifest.fonts) || manifest.fonts.length > MAX_EMBEDDED_FONTS) {
      throw new Error("Luma project contains too many embedded fonts");
    }
    const validFont = (font: unknown): font is SerializedEmbeddedFont =>
      !!font && typeof (font as SerializedEmbeddedFont).family === "string" &&
      /^[A-Za-z][A-Za-z0-9 ]{0,30}$/.test((font as SerializedEmbeddedFont).family) &&
      typeof (font as SerializedEmbeddedFont).asset === "string" &&
      /^fonts\/\d+\.font$/.test((font as SerializedEmbeddedFont).asset);
    if (!manifest.fonts.every(validFont)) throw new Error("Luma project contains a malformed embedded font entry");
  }
}

/**
 * Install any fonts a project embedded, so its text renders in the right
 * face immediately instead of falling back while nothing has loaded it. A
 * family already installed locally is left alone — never overwrite a font
 * this browser already has under that name with the archive's copy. A font
 * that fails to install (corrupt bytes, no IndexedDB available, browser
 * rejects the face) is skipped: the project still opens and that text falls
 * back to the next family in its stack, exactly as if it were never embedded.
 */
async function installEmbeddedFonts(fonts: SerializedEmbeddedFont[] | undefined, zip: JSZip): Promise<void> {
  if (!fonts?.length) return;
  for (const { family, asset } of fonts) {
    if (isUserFontFamily(family)) continue;
    try {
      const file = zip.file(asset);
      if (!file) continue;
      const bytes = await file.async("arraybuffer");
      await installUserFont(family, bytes);
    } catch (error) {
      console.warn(`Embedded font "${family}" could not be installed; falling back to the next family in its stack`, error);
    }
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
  const decodedBytes = await assertProjectDecodeAdmission(zip, options.restoreHistory === false ? { ...manifest, history: undefined } : manifest, options.maximumDecodedBytes);
  const release = options.admitDecodedBytes?.(decodedBytes);
  try {
  await installEmbeddedFonts(manifest.fonts, zip);
  const preserveIds = manifest.version >= 2;
  return {
    name: manifest.name,
    doc: await deserializeDocument(manifest.document, zip, preserveIds),
    actions: Array.isArray(manifest.actions) ? manifest.actions : [],
    history: options.restoreHistory !== false && manifest.version >= 2 && manifest.history
      ? await deserializeHistory(manifest.history, zip)
      : undefined,
  };
  } finally { release?.(); }
}
