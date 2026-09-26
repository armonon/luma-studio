import type { Document, Layer } from "./document";
import { getPhotoshopDocumentMetadata, getPhotoshopLayerMetadata } from "./psd-metadata";

// Whole-image replacement is intentionally bounded, not a huge-document path.
export const SMART_CONTENT_MAX_PIXELS = 4_000_000;
export const SMART_CONTENT_MAX_FILE_BYTES = 32 * 1024 * 1024;
export type SmartContentTarget = { documentId: string; layerId: string; revision: number };

export function embeddedPhotoshopSource(doc: Document, layer: Layer) {
  const placed = getPhotoshopLayerMetadata(layer)?.source.placedLayer;
  return placed ? getPhotoshopDocumentMetadata(doc)?.linkedFiles?.find(file => file.id === placed.id) : undefined;
}

/** Only cases whose source-to-preview mapping can be reproduced exactly. */
export function photoshopSmartEditReason(doc: Document, layer: Layer): string | null {
  const source = getPhotoshopLayerMetadata(layer)?.source, placed = source?.placedLayer;
  if (!placed || !layer.bitmap) return "Photoshop contents lack an editable placed-layer descriptor.";
  const file = embeddedPhotoshopSource(doc, layer);
  if (!file?.data || file.linkedFile) return "Externally linked or missing Smart Object sources must be edited in their source application.";
  if (file.data.byteLength > SMART_CONTENT_MAX_FILE_BYTES || file.data.byteLength < 26) return "Embedded Photoshop contents must be valid PSD/PSB files of at most 32 MiB.";
  const h = new DataView(file.data.buffer, file.data.byteOffset, file.data.byteLength);
  if (h.getUint32(0) !== 0x38425053 || ![1,2].includes(h.getUint16(4)) || h.getUint16(22) !== 8 || h.getUint16(24) !== 3) return "Embedded content editing currently requires an RGB8 PSD/PSB source.";
  try { assertSmartContentDimensions(h.getUint32(18), h.getUint32(14)); } catch { return "Embedded contents exceed the 4 MP editing boundary."; }
  if (placed.width !== h.getUint32(18) || placed.height !== h.getUint32(14)) return "Placed source geometry does not match the embedded document; its original payload is preserved.";
  if (doc.layers.filter(candidate => getPhotoshopLayerMetadata(candidate)?.source.placedLayer?.id === placed.id).length !== 1) return "Shared Photoshop instances are preserved; editing all linked instances is not supported yet.";
  if (placed.type !== "raster" || placed.filter || placed.crop || placed.comp || placed.compInfo || (placed.totalPages ?? 1) !== 1 || (placed.frameCount ?? 0) > 1 || layer.filters?.length) return "Filtered, composed, animated or non-raster placed objects are preserved, not rewritten.";
  const q = placed.transform;
  if (q.length !== 8 || q.some(value => !Number.isFinite(value)) || q.some(value => !Number.isInteger(value)) ||
      q[1] !== q[3] || q[2] !== q[4] || q[5] !== q[7] || q[0] !== q[6] || q[2] <= q[0] || q[5] <= q[1] ||
      q[0] !== (source?.left ?? 0) || q[1] !== (source?.top ?? 0) || q[2] - q[0] !== layer.bitmap.width || q[5] - q[1] !== layer.bitmap.height ||
      placed.nonAffineTransform?.some((value, i) => value !== q[i])) return "Rotated, warped, cropped or subpixel Photoshop placement is preserved; edit it in its source application.";
  const warp = placed.warp;
  if (warp) {
    if ((warp.style && !["none", "custom"].includes(warp.style)) || warp.value || warp.perspective || warp.perspectiveOther || warp.values?.some(Boolean) || warp.deformNumRows || warp.deformNumCols) return "Warped Photoshop objects are preserved, not rewritten.";
    const mesh = warp.customEnvelopeWarp;
    if (warp.style === "custom" && (!mesh || warp.uOrder !== 4 || warp.vOrder !== 4 || warp.rotate !== "horizontal" ||
        !warp.bounds || Object.entries({ left: 0, top: 0, right: placed.width, bottom: placed.height }).some(([key, value]) => {
          const bound = warp.bounds![key as keyof NonNullable<typeof warp.bounds>];
          return bound.units !== "Pixels" || bound.value !== value;
        }))) return "Unrecognized custom-warp geometry is preserved, not rewritten.";
    if (mesh && (mesh.quiltSliceX?.length || mesh.quiltSliceY?.length || mesh.meshPoints.length !== 16 ||
        mesh.meshPoints.some((p, i) => Math.abs(p.x - (i % 4) * (placed.width ?? 0) / 3) > 1e-5 || Math.abs(p.y - Math.floor(i / 4) * (placed.height ?? 0) / 3) > 1e-5))) return "Custom-warped Photoshop objects are preserved, not rewritten.";
  }
  return null;
}

export function smartContentUnavailableReason(doc: Document, layer?: Layer, mode: "replace" | "edit" = "replace"): string | null {
  if (layer?.mesh3d) return "Use the Form mesh editor to replace this object's source and render together.";
  if (layer?.lettering3d) return "Use the 3D lettering editor to replace this object's source and render together.";
  if (!layer || layer.kind !== "smart-object" || !layer.bitmap) return "Select a raster-backed Smart Object first.";
  if (layer.locked) return "Unlock the Smart Object before replacing its contents.";
  if (doc.bitDepth !== 8 || layer.raw) return "Content replacement currently supports 8-bit, non-RAW Smart Objects.";
  if (layer.photoshop || getPhotoshopLayerMetadata(layer)?.source.placedLayer) {
    if (mode !== "edit") return "Photoshop embedded/linked contents are preserved, not rewritten. Use Edit Smart Contents for supported embedded PSD/PSB sources.";
    const reason = photoshopSmartEditReason(doc, layer); if (reason) return reason;
  }
  if (layer.bitmap.width * layer.bitmap.height > SMART_CONTENT_MAX_PIXELS) return "Content replacement is limited to 4 megapixels to bound its undo and working memory.";
  return null;
}

export function assertSmartContentDimensions(width: number, height: number) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 ||
      width > 16_384 || height > 16_384 || width * height > SMART_CONTENT_MAX_PIXELS) {
    throw new Error("Replacement images must be at most 4 megapixels and 16,384 pixels on either side.");
  }
}
