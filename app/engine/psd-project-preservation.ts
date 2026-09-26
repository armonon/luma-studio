import type { Layer as PsdLayer } from "ag-psd";
import type { Document } from "./document";
import { readPsd } from "./ag-psd-io";
import {
  extractPhotoshopImageResources, getPhotoshopDocumentMetadata, getPhotoshopLayerMetadata,
  inspectPhotoshopHeader, setPhotoshopDocumentMetadata, setPhotoshopLayerMetadata,
  type PhotoshopCompatibilityIssue, type PhotoshopLayerMetadata,
} from "./psd-metadata";

export type ProjectPhotoshopPreservation = {
  version: 1;
  documentFingerprint?: string;
  issues: PhotoshopCompatibilityIssue[];
  layers: Array<{ sourceIndex: number; state: Omit<PhotoshopLayerMetadata, "source"> }>;
};

export function captureProjectPhotoshopPreservation(doc: Document): ProjectPhotoshopPreservation | undefined {
  const metadata = getPhotoshopDocumentMetadata(doc);
  if (!metadata?.originalSource) return undefined;
  // Disabled/secondary raster masks have no Luma-owned pixel equivalent yet.
  // Keep the legacy decoder rather than silently discard those source channels.
  if (doc.layers.some(layer => {
    const source = getPhotoshopLayerMetadata(layer)?.source;
    return (source?.mask?.disabled && (source.mask.canvas || source.mask.imageData))
      || source?.realMask?.canvas || source?.realMask?.imageData;
  })) return undefined;
  return {
    version: 1, documentFingerprint: metadata.originalDocumentFingerprint,
    issues: metadata.importedIssues,
    layers: doc.layers.flatMap(layer => {
      const preserved = getPhotoshopLayerMetadata(layer);
      if (!preserved || layer.photoshop?.sourceIndex === undefined) return [];
      const { source, ...state } = preserved; void source;
      return [{ sourceIndex: layer.photoshop.sourceIndex, state }];
    }),
  };
}

/** Restore descriptors, never a second copy of the original document's pixels. */
export function restoreProjectPhotoshopPreservation(doc: Document, originalSource: Uint8Array<ArrayBuffer>, mode: "layered" | "flattened" | undefined, saved: ProjectPhotoshopPreservation) {
  if (saved.version !== 1 || !Array.isArray(saved.layers) || !Array.isArray(saved.issues) || saved.layers.length > 100_000) throw new Error("Invalid Photoshop preservation manifest");
  const buffer = originalSource.buffer;
  const header = inspectPhotoshopHeader(buffer);
  const view = new DataView(buffer);
  if (buffer.byteLength < 34) throw new Error("Truncated Photoshop preservation source");
  const resourceOffset = 30 + view.getUint32(26, false);
  if (resourceOffset + 4 > buffer.byteLength) throw new Error("Invalid Photoshop resource section");
  const resourceBytes = view.getUint32(resourceOffset, false);
  if (resourceOffset + 4 + resourceBytes > buffer.byteLength || resourceBytes > (mode === "flattened" ? 2 : 16) * 1024 * 1024) throw new Error("Photoshop preservation resources exceed the metadata working budget");
  // Flattened previews have no editable source descriptors. Keep the original
  // bytes/resources and import fingerprints without decoding their layer table.
  const psd = mode === "flattened" ? undefined : readPsd(buffer, {
    skipLayerImageData: header.bitsPerChannel !== 8 || header.colorMode !== 3,
    useRawData: header.bitsPerChannel === 8 && header.colorMode === 3,
    skipCompositeImageData: true, skipThumbnail: true,
    useImageData: true, totalMemoryLimit: 32 * 1024 * 1024,
    throwForMissingFeatures: false, logMissingFeatures: false,
  });
  const sources: PsdLayer[] = [];
  const visit = (layers: PsdLayer[]) => { for (const layer of layers) { sources.push(layer); if (layer.children) visit(layer.children); } };
  visit(psd?.children ?? []);
  if (!sources.length) sources.push({ name: "Flattened composite" });
  const states = new Map(saved.layers.map(layer => [layer.sourceIndex, layer.state]));
  for (const layer of doc.layers) {
    const index = layer.photoshop?.sourceIndex;
    if (index === undefined) continue;
    const source = sources[index], state = states.get(index);
    if (!source || !state) throw new Error("Photoshop source layer mapping cannot be restored");
    setPhotoshopLayerMetadata(layer, { ...state, source });
  }
  setPhotoshopDocumentMetadata(doc, {
    header, importMode: mode, originalSource,
    originalDocumentFingerprint: saved.documentFingerprint,
    importedIssues: saved.issues,
    imageResources: psd?.imageResources, linkedFiles: psd?.linkedFiles,
    engineData: psd?.engineData, originalLayerCount: sources.length,
    rawImageResources: extractPhotoshopImageResources(buffer),
  });
}
