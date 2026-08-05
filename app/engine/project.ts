import JSZip from "jszip";
import { Action } from "./actions";
import {
  Document,
  Layer,
  Selection,
  newCanvas,
  nextId,
} from "./document";

export const LUMA_PROJECT_VERSION = 1 as const;

type SerializedLayer = Omit<Layer, "id" | "bitmap" | "mask"> & {
  id: string;
  bitmapAsset?: string;
  maskAsset?: string;
};

type ProjectManifest = {
  format: "luma-project";
  version: typeof LUMA_PROJECT_VERSION;
  name: string;
  savedAt: string;
  document: Omit<Document, "layers" | "selection"> & {
    layers: SerializedLayer[];
    selection?: { asset: string; bounds: Selection["bounds"] };
  };
  actions: Action[];
};

export type DecodedProject = {
  name: string;
  doc: Document;
  actions: Action[];
};

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("Canvas encoding failed")),
      "image/png",
    );
  });
}

async function blobCanvas(blob: Blob, width: number, height: number) {
  const canvas = newCanvas(width, height);
  const ctx = canvas.getContext("2d")!;
  if (typeof createImageBitmap === "function") {
    const image = await createImageBitmap(blob);
    ctx.drawImage(image, 0, 0);
    image.close();
    return canvas;
  }
  const url = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = url;
    });
    ctx.drawImage(image, 0, 0);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function encodeLumaProject(
  doc: Document,
  actions: Action[],
  name: string,
): Promise<Blob> {
  const zip = new JSZip();
  const layers: SerializedLayer[] = [];

  for (const layer of doc.layers) {
    const { bitmap, mask, ...metadata } = layer;
    const serialized: SerializedLayer = { ...metadata };
    if (bitmap) {
      serialized.bitmapAsset = `assets/${layer.id}.png`;
      zip.file(serialized.bitmapAsset, await canvasBlob(bitmap));
    }
    if (mask) {
      serialized.maskAsset = `assets/${layer.id}.mask.png`;
      zip.file(serialized.maskAsset, await canvasBlob(mask));
    }
    layers.push(serialized);
  }

  let selection: ProjectManifest["document"]["selection"];
  if (doc.selection) {
    const asset = "assets/selection.png";
    zip.file(asset, await canvasBlob(doc.selection.mask));
    selection = { asset, bounds: { ...doc.selection.bounds } };
  }

  const manifest: ProjectManifest = {
    format: "luma-project",
    version: LUMA_PROJECT_VERSION,
    name,
    savedAt: new Date().toISOString(),
    document: {
      width: doc.width,
      height: doc.height,
      colorSpace: doc.colorSpace,
      bitDepth: doc.bitDepth,
      resolution: { ...doc.resolution },
      layers,
      selection,
    },
    actions,
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
  if (manifest.version !== LUMA_PROJECT_VERSION) {
    throw new Error(`Unsupported Luma project version: ${String(manifest.version)}`);
  }
  const doc = manifest.document;
  if (!doc || !Number.isInteger(doc.width) || !Number.isInteger(doc.height) ||
      doc.width < 1 || doc.height < 1 || !Array.isArray(doc.layers)) {
    throw new Error("Invalid Luma project manifest");
  }
}

export async function decodeLumaProject(blob: Blob): Promise<DecodedProject> {
  const zip = await JSZip.loadAsync(blob);
  const manifestFile = zip.file("manifest.json");
  if (!manifestFile) throw new Error("Project manifest is missing");
  const manifest: unknown = JSON.parse(await manifestFile.async("string"));
  assertManifest(manifest);
  const source = manifest.document;

  const layers: Layer[] = [];
  const idMap = new Map<string, string>();
  for (const item of source.layers) {
    const { bitmapAsset, maskAsset, ...metadata } = item;
    const id = nextId(metadata.kind);
    idMap.set(metadata.id, id);
    const layer: Layer = {
      ...metadata,
      id,
      transform: { ...metadata.transform },
    };
    if (bitmapAsset) {
      const file = zip.file(bitmapAsset);
      if (!file) throw new Error(`Missing layer asset: ${bitmapAsset}`);
      layer.bitmap = await blobCanvas(await file.async("blob"), source.width, source.height);
    }
    if (maskAsset) {
      const file = zip.file(maskAsset);
      if (!file) throw new Error(`Missing mask asset: ${maskAsset}`);
      layer.mask = await blobCanvas(await file.async("blob"), source.width, source.height);
    }
    layers.push(layer);
  }
  for (const layer of layers) {
    if (layer.parentId) layer.parentId = idMap.get(layer.parentId);
    if (layer.ai) {
      layer.ai = {
        ...layer.ai,
        sourceLayerIds: layer.ai.sourceLayerIds.map((id) => idMap.get(id) ?? id),
      };
    }
  }

  let selection: Selection | null = null;
  if (source.selection) {
    const file = zip.file(source.selection.asset);
    if (!file) throw new Error("Missing selection asset");
    selection = {
      mask: await blobCanvas(await file.async("blob"), source.width, source.height),
      bounds: { ...source.selection.bounds },
    };
  }

  return {
    name: manifest.name,
    doc: {
      width: source.width,
      height: source.height,
      colorSpace: source.colorSpace ?? "srgb",
      bitDepth: source.bitDepth ?? 8,
      resolution: source.resolution ?? { x: 72, y: 72, unit: "ppi" },
      guides: source.guides ?? [],
      layers,
      selection,
    },
    actions: Array.isArray(manifest.actions) ? manifest.actions : [],
  };
}
