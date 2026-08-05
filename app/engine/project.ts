import JSZip from "jszip";
import { Action } from "./actions";
import {
  Document,
  Guide,
  Layer,
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
  LayerSnapshot,
  PixelPatch,
} from "./studio";

export const LUMA_PROJECT_VERSION = 2 as const;
const SUPPORTED_PROJECT_VERSIONS = new Set([1, LUMA_PROJECT_VERSION]);
const RESTORED_HISTORY_LIMIT = 80;

type SerializedLayer = Omit<Layer, "bitmap" | "mask"> & {
  bitmapAsset?: string;
  maskAsset?: string;
};

type SerializedDocument = Omit<Document, "layers" | "selection"> & {
  layers: SerializedLayer[];
  selection?: { asset: string; bounds: Selection["bounds"] };
};

type SerializedLayerSnapshot = Omit<LayerSnapshot, "bitmap" | "mask"> & {
  bitmapAsset?: string;
  maskAsset?: string;
};

type SerializedPixelPatch = Omit<PixelPatch, "before" | "after"> & {
  beforeAsset: string;
  afterAsset: string;
};

type SerializedHistoryEntry = {
  label: string;
  before: SerializedLayerSnapshot[];
  after: SerializedLayerSnapshot[];
  layersBefore?: SerializedLayer[];
  layersAfter?: SerializedLayer[];
  selectionBefore?: { asset: string; bounds: Selection["bounds"] } | null;
  selectionAfter?: { asset: string; bounds: Selection["bounds"] } | null;
  pixelPatches?: SerializedPixelPatch[];
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
  version: 1 | typeof LUMA_PROJECT_VERSION;
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

type EncodeContext = {
  zip: JSZip;
  assets: WeakMap<HTMLCanvasElement, string>;
  nextAsset: number;
};

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("Canvas encoding failed")),
      "image/png",
    );
  });
}

async function addCanvasAsset(context: EncodeContext, canvas: HTMLCanvasElement) {
  const existing = context.assets.get(canvas);
  if (existing) return existing;
  context.nextAsset += 1;
  const asset = `assets/data/${context.nextAsset.toString().padStart(6, "0")}.png`;
  context.zip.file(asset, await canvasBlob(canvas));
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

async function serializeLayer(layer: Layer, context: EncodeContext): Promise<SerializedLayer> {
  const { bitmap, mask, ...metadata } = layer;
  return {
    ...metadata,
    bitmapAsset: bitmap ? await addCanvasAsset(context, bitmap) : undefined,
    maskAsset: mask ? await addCanvasAsset(context, mask) : undefined,
  };
}

async function deserializeLayer(
  source: SerializedLayer,
  zip: JSZip,
  preserveId: boolean,
  idMap?: Map<string, string>,
): Promise<Layer> {
  const { bitmapAsset, maskAsset, ...metadata } = source;
  const id = preserveId ? metadata.id : nextId(metadata.kind);
  if (preserveId) reserveId(id);
  else idMap?.set(metadata.id, id);
  const layer: Layer = {
    ...metadata,
    id,
    transform: { ...metadata.transform },
  };
  if (bitmapAsset) layer.bitmap = await readCanvasAsset(zip, bitmapAsset);
  if (maskAsset) layer.mask = await readCanvasAsset(zip, maskAsset);
  return layer;
}

async function serializeDocument(doc: Document, context: EncodeContext): Promise<SerializedDocument> {
  const layers = await Promise.all(doc.layers.map((layer) => serializeLayer(layer, context)));
  const selection = doc.selection
    ? { asset: await addCanvasAsset(context, doc.selection.mask), bounds: { ...doc.selection.bounds } }
    : undefined;
  return {
    width: doc.width,
    height: doc.height,
    colorSpace: doc.colorSpace,
    bitDepth: doc.bitDepth,
    resolution: { ...doc.resolution },
    guides: doc.guides.map((guide) => ({ ...guide })),
    layers,
    selection,
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
    selection = {
      mask: await readCanvasAsset(zip, source.selection.asset),
      bounds: { ...source.selection.bounds },
    };
  }
  return {
    width: source.width,
    height: source.height,
    colorSpace: source.colorSpace ?? "srgb",
    bitDepth: source.bitDepth ?? 8,
    resolution: source.resolution ?? { x: 72, y: 72, unit: "ppi" },
    guides: (source.guides ?? []).map((guide) => ({ ...guide })),
    layers,
    selection,
  };
}

async function serializeLayerSnapshot(
  snapshot: LayerSnapshot,
  context: EncodeContext,
): Promise<SerializedLayerSnapshot> {
  const { bitmap, mask, ...metadata } = snapshot;
  return {
    ...metadata,
    bitmapAsset: bitmap ? await addCanvasAsset(context, bitmap) : undefined,
    maskAsset: mask ? await addCanvasAsset(context, mask) : undefined,
  };
}

async function deserializeLayerSnapshot(
  source: SerializedLayerSnapshot,
  zip: JSZip,
): Promise<LayerSnapshot> {
  const { bitmapAsset, maskAsset, ...metadata } = source;
  return {
    ...metadata,
    bitmap: bitmapAsset ? await readCanvasAsset(zip, bitmapAsset) : undefined,
    mask: maskAsset ? await readCanvasAsset(zip, maskAsset) : undefined,
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
  if ("selectionBefore" in entry) {
    serialized.selectionBefore = entry.selectionBefore
      ? {
          asset: await addCanvasAsset(context, entry.selectionBefore.mask),
          bounds: { ...entry.selectionBefore.bounds },
        }
      : null;
  }
  if ("selectionAfter" in entry) {
    serialized.selectionAfter = entry.selectionAfter
      ? {
          asset: await addCanvasAsset(context, entry.selectionAfter.mask),
          bounds: { ...entry.selectionAfter.bounds },
        }
      : null;
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
  if ("selectionBefore" in source) {
    entry.selectionBefore = source.selectionBefore
      ? {
          mask: await readCanvasAsset(zip, source.selectionBefore.asset),
          bounds: { ...source.selectionBefore.bounds },
        }
      : null;
  }
  if ("selectionAfter" in source) {
    entry.selectionAfter = source.selectionAfter
      ? {
          mask: await readCanvasAsset(zip, source.selectionAfter.asset),
          bounds: { ...source.selectionAfter.bounds },
        }
      : null;
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
    nextAsset: 0,
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
      doc.width < 1 || doc.height < 1 || !Array.isArray(doc.layers)) {
    throw new Error("Invalid Luma project manifest");
  }
}

export async function decodeLumaProject(blob: Blob | ArrayBuffer | Uint8Array): Promise<DecodedProject> {
  const zip = await JSZip.loadAsync(blob);
  const manifestFile = zip.file("manifest.json");
  if (!manifestFile) throw new Error("Project manifest is missing");
  const manifest: unknown = JSON.parse(await manifestFile.async("string"));
  assertManifest(manifest);
  const preserveIds = manifest.version >= 2;
  return {
    name: manifest.name,
    doc: await deserializeDocument(manifest.document, zip, preserveIds),
    actions: Array.isArray(manifest.actions) ? manifest.actions : [],
    history: manifest.version >= 2 && manifest.history
      ? await deserializeHistory(manifest.history, zip)
      : undefined,
  };
}
