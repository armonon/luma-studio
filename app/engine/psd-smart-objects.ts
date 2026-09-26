import type { Layer as PsdLayer, LinkedFile } from "ag-psd";
import { affineForLayerTransform, cloneCanvas, createDocument, createRasterLayer, newCanvas, type Document, type Layer } from "./document";
import { decodeLumaProject } from "./project";
import { exportPhotoshopDocument } from "./psd";
import { getPhotoshopLayerMetadata, type PhotoshopCompatibilityIssue } from "./psd-metadata";
import { renderClean } from "./renderer";
import { assertSmartContentDimensions, photoshopSmartEditReason, SMART_CONTENT_MAX_FILE_BYTES } from "./smart-object-content";
import { waitForDocumentFonts } from "./text-font-resources";

export type PreparedSmartObject = {
  source?: Uint8Array;
  bitmap: HTMLCanvasElement;
  placedLayer: NonNullable<PsdLayer["placedLayer"]>;
  file: LinkedFile;
  issues: PhotoshopCompatibilityIssue[];
};

// Do not replace preserved Adobe descriptors, filtered previews or projected
// geometry with a deceptively editable but visually different placed object.
export function canEmbedNativeSmartObject(layer: Layer, doc?: Document) {
  return layer.kind === "smart-object" && !!layer.bitmap &&
    (!getPhotoshopLayerMetadata(layer)?.source.placedLayer || (!!layer.smartSource && !!doc && !photoshopSmartEditReason(doc, layer))) && !layer.spatial &&
    !layer.mesh3d && !layer.lettering3d && !layer.raw && !(layer.filters?.length);
}

function placement(layer: Layer, width: number, height: number) {
  const bitmap = layer.bitmap!;
  const scale = Math.min(bitmap.width / width, bitmap.height / height);
  const ox = (bitmap.width - width * scale) / 2, oy = (bitmap.height - height * scale) / 2;
  const m = affineForLayerTransform(layer.transform);
  return [[0, 0], [width, 0], [width, height], [0, height]].flatMap(([x, y]) => {
    const px = x * scale + ox, py = y * scale + oy;
    return [m.a * px + m.c * py + m.e, m.b * px + m.d * py + m.f];
  });
}

/** Prepares actual editable PSBs, never labels a flattened PNG as a source.
 * The caller holds all output reservations until the parent file is written.
 */
export async function preparePhotoshopSmartObjects(
  doc: Document,
  reserve: (bytes: number) => () => void,
  assertCurrent: () => void,
) {
  const objects = new Map<string, PreparedSmartObject>();
  const retained: (() => void)[] = [];
  const release = () => { for (const done of retained.splice(0)) done(); objects.clear(); };
  let totalBytes = 0;
  try {
    const candidates = doc.layers.filter(layer => canEmbedNativeSmartObject(layer, doc));
    if (candidates.length > 32) throw new Error("Photoshop export supports at most 32 native embedded Smart Objects per file");
    for (const layer of candidates) {
      const source = layer.smartSource;
      if (source && source.byteLength > SMART_CONTENT_MAX_FILE_BYTES) throw new Error("Embedded Smart Object source exceeds 32 MiB");
      let contents: Document | undefined, preview: HTMLCanvasElement | undefined;
      const working: (() => void)[] = [];
      try {
        if (source) {
          const project = await decodeLumaProject(source, {
            restoreHistory: false,
            maximumDecodedBytes: 128 * 1024 * 1024,
            admitDecodedBytes: bytes => { working.push(reserve(bytes * 3)); return () => {}; },
          });
          contents = project.doc;
        } else {
          assertSmartContentDimensions(layer.bitmap!.width, layer.bitmap!.height);
          working.push(reserve(layer.bitmap!.width * layer.bitmap!.height * 8));
          contents = createDocument(layer.bitmap!.width, layer.bitmap!.height);
          contents.layers = [createRasterLayer("Contents", cloneCanvas(layer.bitmap!))];
        }
        assertCurrent();
        assertSmartContentDimensions(contents.width, contents.height);
        if (contents.bitDepth !== 8 || contents.colorSpace !== "srgb" || contents.layers.length > 128 || contents.layers.some(child => child.smartSource || child.kind === "smart-object")) {
          throw new Error("Embedded Photoshop contents require RGB8 sRGB, at most 128 layers, and no nested Smart Objects");
        }
        await waitForDocumentFonts(contents);
        assertCurrent();
        working.push(reserve(contents.width * contents.height * (64 + contents.layers.filter(child => child.kind === "group").length * 4)));
        preview = newCanvas(contents.width, contents.height);
        renderClean(contents, preview);
        const result = exportPhotoshopDocument(contents, { format: "psb", mergedPreview: preview });
        assertCurrent();
        if (result.buffer.byteLength > SMART_CONTENT_MAX_FILE_BYTES || totalBytes + result.buffer.byteLength > 128 * 1024 * 1024) {
          throw new Error("Embedded Photoshop output exceeds its 32 MiB per-object / 128 MiB per-document limit");
        }
        totalBytes += result.buffer.byteLength;
        retained.push(reserve(result.buffer.byteLength * 3));
        const id = crypto.randomUUID();
        objects.set(layer.id, {
          source, bitmap: layer.bitmap!,
          placedLayer: { id, type: "raster", width: contents.width, height: contents.height,
            transform: placement(layer, contents.width, contents.height), resolution: { units: "Density", value: contents.resolution.x } },
          file: { id, name: `${layer.name}.psb`, type: "8BPB", creator: "8BIM", data: new Uint8Array(result.buffer) },
          issues: result.report.issues.filter(issue => issue.severity !== "info").map(issue => ({ ...issue, layerId: layer.id, message: `${layer.name} contents: ${issue.message}` })),
        });
      } finally {
        if (preview) { preview.width = 1; preview.height = 1; }
        if (contents) for (const child of contents.layers) {
          if (child.bitmap) { child.bitmap.width = 1; child.bitmap.height = 1; }
          child.surface?.store.unbindMemoryBudget();
        }
        for (const done of working) done();
      }
    }
    return { objects, release };
  } catch (error) { release(); throw error; }
}
