import type { Layer as PsdLayer, Psd } from "ag-psd";
import type { Document, Layer } from "./document";

export type PhotoshopContainer = "psd" | "psb";

export type PhotoshopHeader = {
  container: PhotoshopContainer;
  version: 1 | 2;
  channels: number;
  width: number;
  height: number;
  bitsPerChannel: number;
  colorMode: number;
};

export type PhotoshopCompatibilitySeverity = "info" | "warning" | "error";

export type PhotoshopCompatibilityIssue = {
  code: string;
  severity: PhotoshopCompatibilitySeverity;
  message: string;
  layerId?: string;
};

export type PhotoshopDocumentMetadata = {
  header: PhotoshopHeader;
  /** Complete source container retained for preservation metadata restoration after .luma reload. */
  originalSource?: Uint8Array;
  /** Luma document settings at import time, excluding layers and the active selection. */
  originalDocumentFingerprint?: string;
  /** ag-psd resources that it can decode and write back. */
  imageResources?: Psd["imageResources"];
  /** Embedded and linked smart-object payloads. Data is retained byte-for-byte. */
  linkedFiles?: Psd["linkedFiles"];
  /** Raw resource blocks that ag-psd does not expose, including ICC profiles. */
  rawImageResources: PhotoshopImageResourceBlock[];
  importedIssues: PhotoshopCompatibilityIssue[];
};

export type PhotoshopImageResourceBlock = {
  id: number;
  bytes: Uint8Array;
  data: Uint8Array;
};

export type PhotoshopLayerMetadata = {
  /** Original supported ag-psd descriptor. Pixel buffers are intentionally shared. */
  source: PsdLayer;
  originalText?: string;
  originalTextFingerprint?: string;
  originalPathFingerprint?: string;
  originalEffectsFingerprint?: string;
  /** Editable Luma-facing state at import time, excluding pixel and hierarchy data. */
  originalStateFingerprint?: string;
  originalSurfaceFingerprint?: string;
  originalMaskFingerprint?: string;
  originalParentSourceIndex?: number;
  originalStackPosition?: number;
  preservation: "editable" | "descriptor-preserved" | "preview-only";
};

const documentMetadata = new WeakMap<Document, PhotoshopDocumentMetadata>();
const layerMetadata = new WeakMap<Layer, PhotoshopLayerMetadata>();

export class PhotoshopFormatError extends Error {
  readonly code: "TRUNCATED_HEADER" | "INVALID_SIGNATURE" | "UNSUPPORTED_VERSION";

  constructor(code: PhotoshopFormatError["code"], message: string) {
    super(message);
    this.name = "PhotoshopFormatError";
    this.code = code;
  }
}

export class PhotoshopDecodeError extends Error {
  readonly header: PhotoshopHeader;

  constructor(header: PhotoshopHeader, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`Unable to decode this ${header.container.toUpperCase()} safely: ${detail}`, { cause });
    this.name = "PhotoshopDecodeError";
    this.header = header;
  }
}

export function inspectPhotoshopHeader(buffer: ArrayBuffer): PhotoshopHeader {
  if (buffer.byteLength < 26) {
    throw new PhotoshopFormatError("TRUNCATED_HEADER", "This file is too short to contain a Photoshop document header.");
  }
  const bytes = new Uint8Array(buffer, 0, 4);
  if (String.fromCharCode(...bytes) !== "8BPS") {
    throw new PhotoshopFormatError("INVALID_SIGNATURE", "This file does not have a valid PSD/PSB signature.");
  }
  const view = new DataView(buffer);
  const version = view.getUint16(4, false);
  if (version !== 1 && version !== 2) {
    throw new PhotoshopFormatError("UNSUPPORTED_VERSION", `Photoshop document version ${version} is not supported.`);
  }
  return {
    container: version === 2 ? "psb" : "psd",
    version,
    channels: view.getUint16(12, false),
    height: view.getUint32(14, false),
    width: view.getUint32(18, false),
    bitsPerChannel: view.getUint16(22, false),
    colorMode: view.getUint16(24, false),
  };
}

type ImageResourceSection = {
  lengthOffset: number;
  start: number;
  end: number;
  blocks: PhotoshopImageResourceBlock[];
};

function imageResourceSection(buffer: ArrayBuffer): ImageResourceSection | null {
  if (buffer.byteLength < 34) return null;
  const view = new DataView(buffer);
  const colorModeLength = view.getUint32(26, false);
  const lengthOffset = 30 + colorModeLength;
  if (lengthOffset + 4 > buffer.byteLength) return null;
  const length = view.getUint32(lengthOffset, false);
  const start = lengthOffset + 4;
  const end = start + length;
  if (end > buffer.byteLength) return null;
  const bytes = new Uint8Array(buffer);
  const blocks: PhotoshopImageResourceBlock[] = [];
  let offset = start;
  while (offset + 12 <= end) {
    const blockStart = offset;
    const signature = String.fromCharCode(...bytes.subarray(offset, offset + 4));
    if (signature !== "8BIM" && signature !== "MeSa") break;
    const id = view.getUint16(offset + 4, false);
    offset += 6;
    const nameLength = bytes[offset];
    offset += 1 + nameLength;
    if ((1 + nameLength) % 2 !== 0) offset += 1;
    if (offset + 4 > end) break;
    const dataLength = view.getUint32(offset, false);
    offset += 4;
    const dataStart = offset;
    const dataEnd = dataStart + dataLength;
    const blockEnd = dataEnd + (dataLength % 2);
    if (blockEnd > end) break;
    blocks.push({
      id,
      bytes: bytes.slice(blockStart, blockEnd),
      data: bytes.slice(dataStart, dataEnd),
    });
    offset = blockEnd;
  }
  return { lengthOffset, start, end, blocks };
}

export function extractPhotoshopImageResources(buffer: ArrayBuffer) {
  return imageResourceSection(buffer)?.blocks ?? [];
}

/**
 * Restore source resource blocks that ag-psd could not decode/write. Writer
 * output always wins for recognized resource ids, so edited guides, DPI, XMP,
 * and other supported metadata are never replaced with stale copies.
 */
export function mergePhotoshopImageResources(
  output: ArrayBuffer,
  preserved: readonly PhotoshopImageResourceBlock[],
  options: { includeIccProfile: boolean },
) {
  const section = imageResourceSection(output);
  if (!section || !preserved.length) return output;
  const ids = new Set(section.blocks.map((block) => block.id));
  const additions = preserved.filter((block) => (
    !ids.has(block.id) && (block.id !== 1039 || options.includeIccProfile)
  ));
  if (!additions.length) return output;
  const extraLength = additions.reduce((sum, block) => sum + block.bytes.byteLength, 0);
  const oldBytes = new Uint8Array(output);
  const merged = new Uint8Array(oldBytes.byteLength + extraLength);
  merged.set(oldBytes.subarray(0, section.end), 0);
  let offset = section.end;
  for (const block of additions) {
    merged.set(block.bytes, offset);
    offset += block.bytes.byteLength;
  }
  merged.set(oldBytes.subarray(section.end), offset);
  new DataView(merged.buffer).setUint32(
    section.lengthOffset,
    section.end - section.start + extraLength,
    false,
  );
  return merged.buffer;
}

export function setPhotoshopDocumentMetadata(doc: Document, metadata: PhotoshopDocumentMetadata) {
  documentMetadata.set(doc, metadata);
}

export function getPhotoshopDocumentMetadata(doc: Document) {
  return documentMetadata.get(doc);
}

export function setPhotoshopLayerMetadata(layer: Layer, metadata: PhotoshopLayerMetadata) {
  layerMetadata.set(layer, metadata);
}

export function getPhotoshopLayerMetadata(layer: Layer) {
  return layerMetadata.get(layer);
}

export function pathFingerprint(layer: Pick<Layer, "path">) {
  return layer.path ? JSON.stringify(layer.path) : undefined;
}
