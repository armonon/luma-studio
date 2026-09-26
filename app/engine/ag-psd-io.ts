import {
  createReader,
  readPsd as readPsdFromReader,
  decodeLayerPixels as decodePixels,
  getLayerMaskImageData,
  getLayerRealMaskImageData,
} from "ag-psd/dist-es/psdReader.js";
import {
  createWriter,
  getWriterBuffer,
  writePsd as writePsdToWriter,
} from "ag-psd/dist-es/psdWriter.js";
import { initializeCanvas } from "ag-psd/dist-es/helpers.js";
import type { Psd, Layer, ReadOptions, WriteOptions } from "ag-psd";
import { installPhotoshopTextCompatibility } from "./psd-text-compat";
import { readWithPhotoshopEffectCompatibility } from "./psd-effect-compat";

let canvasInitialized = false;

function ensureCanvasAdapter() {
  if (canvasInitialized) return;
  if (typeof document === "undefined") {
    throw new Error("PSD pixel decoding requires a canvas-capable runtime");
  }
  initializeCanvas(
    (width, height) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      return canvas;
    },
    (width, height) => {
      // ImageData needs no same-sized native canvas backing store. Avoid a
      // redundant decoded plane awaiting GC for every Photoshop layer.
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("PSD pixel decoding requires a 2D canvas context");
      return context.createImageData(width, height);
    },
  );
  canvasInitialized = true;
}

/**
 * Narrow browser entry for the PSD codec. The package root also registers
 * brush/preset parsers that Luma does not call while reading or writing PSDs.
 * Importing the reader and writer directly keeps those unrelated codecs out
 * of the studio's startup graph.
 */
export function readPsd(buffer: ArrayBuffer, options?: ReadOptions): Psd {
  ensureCanvasAdapter();
  installPhotoshopTextCompatibility();
  // ag-psd publishes duplicate declarations under dist/ and dist-es/. Their
  // enum identities differ to TypeScript even though the serialized shape is
  // the same; keep that package artifact contained at this adapter boundary.
  const reader = createReader(buffer);
  const psd = readWithPhotoshopEffectCompatibility(() => readPsdFromReader(
    reader,
    options as unknown as Parameters<typeof readPsdFromReader>[1],
  )) as unknown as Psd;
  // ag-psd puts the first extra RGB channel into RGBA alpha even when the
  // layer-count sign says it is a saved channel, not merged transparency.
  if (!reader.globalAlpha && psd.colorMode === 3 && (psd.channels ?? 3) > 3 && psd.imageData) {
    const max = psd.bitsPerChannel === 32 ? 1 : psd.bitsPerChannel === 16 ? 65535 : 255;
    for (let i = 3; i < psd.imageData.data.length; i += 4) psd.imageData.data[i] = max;
  }
  return psd;
}

/** Only call after whole-file geometry admission; decode a single owned layer. */
export function decodeLayerPixels(layer: Layer, masksOnly = false) {
  const input = layer as unknown as Parameters<typeof decodePixels>[0];
  if (!masksOnly) { decodePixels(input, true); return; }
  // Editable text/vectors/adjustments/groups do not consume the source preview.
  // Decode their masks without materializing and immediately discarding RGBA.
  if (input.mask) input.mask.imageData = getLayerMaskImageData(input);
  if (input.realMask) input.realMask.imageData = getLayerRealMaskImageData(input);
  delete input.rawData;
}

export function writePsd(psd: Psd, options?: WriteOptions): ArrayBuffer {
  ensureCanvasAdapter();
  const writer = createWriter();
  writePsdToWriter(
    writer,
    photoshopWritableEffects(psd) as unknown as Parameters<typeof writePsdToWriter>[1],
    options as unknown as Parameters<typeof writePsdToWriter>[2],
  );
  return getWriterBuffer(writer);
}

/** ag-psd 31 injects an empty TrnS curve for drop shadows without a contour,
 * including disabled legacy lrFX shadows. Photoshop rejects those layer
 * records. Supply the implicit linear contour, preserving all other effects
 * and custom curves. Clone metadata only: never copy pixel/channel buffers or
 * mutate the retained source used by undo and native save/reopen. */
function photoshopWritableEffects(psd: Psd): Psd {
  const layer = (source: Layer): Layer => {
    const children = source.children?.map(layer);
    const shadows = source.effects?.dropShadow;
    const repair = shadows?.some(shadow => !shadow.contour?.curve.length);
    if (!repair && !children?.some((child, index) => child !== source.children![index])) return source;
    return { ...source, ...(children ? { children } : {}), ...(repair ? {
      effects: { ...source.effects, dropShadow: shadows!.map(shadow => shadow.contour?.curve.length ? shadow : {
        ...shadow, contour: { name: "Linear", curve: [{ x: 0, y: 0 }, { x: 255, y: 255 }] },
      }) },
    } : {}) };
  };
  return psd.children ? { ...psd, children: psd.children.map(layer) } : psd;
}

export type Native16BitRgbChannels = readonly [Uint8Array, Uint8Array, Uint8Array];

/** Layered RGB16/RGB32 writer. Every layer supplies native planar samples;
 * the merged RGB image is opaque, so no ambiguous composite-alpha matte exists. */
export function writeNativeHighDepthRgbPsd(psd: Psd, composite: Native16BitRgbChannels, options: WriteOptions = {}) {
  const depth = psd.bitsPerChannel;
  if ((depth !== 16 && depth !== 32) || psd.colorMode !== 3 || !psd.children?.length || psd.children.length > 128) throw new Error("Invalid native high-depth RGB document");
  const sampleBytes = psd.width * psd.height * depth / 8;
  if (!Number.isSafeInteger(sampleBytes) || sampleBytes > 32 * 1024 * 1024 || composite.some(channel => channel.byteLength !== sampleBytes)) throw new Error("Native high-depth composite exceeds its bounded geometry");
  for (const layer of psd.children) {
    const width = (layer.right ?? 0) - (layer.left ?? 0), height = (layer.bottom ?? 0) - (layer.top ?? 0);
    const bytes = width * height * depth / 8, raw = layer.rawData;
    const mask = layer.mask;
    const maskBytes = mask ? ((mask.right ?? 0) - (mask.left ?? 0)) * ((mask.bottom ?? 0) - (mask.top ?? 0)) * depth / 8 : 0;
    if (mask && (!Number.isSafeInteger(maskBytes) || maskBytes < 1 || maskBytes > 32 * 1024 * 1024 || mask.positionRelativeToLayer || mask.disabled)) throw new Error("Invalid native high-depth mask bounds");
    if (width < 1 || height < 1 || !Number.isSafeInteger(bytes) || layer.children || !raw || raw.bitsPerChannel !== depth || raw.colorMode !== 3 ||
        raw.channels.length !== (mask ? 5 : 4) || raw.channels.some((channel, index) => channel.id !== [0, 1, 2, -1, -2][index] || channel.compression !== 0 || channel.data?.byteLength !== (index === 4 ? maskBytes : bytes))) throw new Error("Invalid native high-depth layer planes");
  }
  const structural = writePsd({ ...psd, bitsPerChannel: 8, canvas: undefined, imageData: undefined }, { ...options, noBackground: true });
  const input = new DataView(structural);
  let section = 26;
  for (let i = 0; i < 2; i++) section += 4 + input.getUint32(section, false);
  const lengthBytes = options.psb ? 8 : 4;
  const layerInfoStart = section + lengthBytes;
  if (options.psb && input.getUint32(layerInfoStart, false) !== 0) throw new Error("High-depth layer info exceeds the browser address limit");
  const infoBytes = input.getUint32(layerInfoStart + lengthBytes - 4, false);
  const info = new Uint8Array(structural, layerInfoStart + lengthBytes, infoBytes);
  // Photoshop stores native high-depth layer information in Lr16/Lr32, with
  // an empty conventional layer-info section. See Adobe File Formats spec.
  const paddedInfo = Math.ceil(infoBytes / 4) * 4;
  const sectionBytes = lengthBytes + 4 + 8 + lengthBytes + paddedInfo;
  const compositeOffset = section + lengthBytes + sectionBytes;
  const output = new Uint8Array(compositeOffset + 2 + sampleBytes * 3);
  output.set(new Uint8Array(structural, 0, section));
  const view = new DataView(output.buffer);
  const length = (offset: number, value: number) => view.setUint32(offset + lengthBytes - 4, value, false);
  view.setUint16(12, 3, false); view.setUint16(22, depth, false);
  length(section, sectionBytes);
  // Conventional layer-info and global-mask lengths remain zero.
  const tag = section + lengthBytes + lengthBytes + 4;
  output.set(new TextEncoder().encode(`8BIMLr${depth}`), tag);
  length(tag + 8, infoBytes);
  output.set(info, tag + 8 + lengthBytes);
  view.setUint16(compositeOffset, 0, false);
  let offset = compositeOffset + 2;
  for (const channel of composite) { output.set(channel, offset); offset += channel.byteLength; }
  return output.buffer;
}

function photoshopCompositeOffset(buffer: ArrayBuffer, psb: boolean) {
  const view = new DataView(buffer);
  let offset = 26;
  for (let section = 0; section < 2; section += 1) {
    if (offset + 4 > buffer.byteLength) throw new Error("Truncated Photoshop section header");
    const length = view.getUint32(offset, false);
    offset += 4 + length;
  }
  if (psb) {
    if (offset + 8 > buffer.byteLength) throw new Error("Truncated PSB layer section header");
    const high = view.getUint32(offset, false);
    const low = view.getUint32(offset + 4, false);
    if (high !== 0) throw new Error("Browser-native PSB output cannot address a layer section larger than 4 GiB");
    offset += 8 + low;
  } else {
    if (offset + 4 > buffer.byteLength) throw new Error("Truncated PSD layer section header");
    offset += 4 + view.getUint32(offset, false);
  }
  if (offset + 2 > buffer.byteLength) throw new Error("Truncated Photoshop composite section");
  return offset;
}

/**
 * ag-psd 31.x deliberately rejects non-8-bit writes. Its raw layer-channel
 * path is depth-agnostic, however, and writes the supplied bytes verbatim.
 * This adapter uses that path only for one fully described RGB layer, then
 * promotes the header and replaces the generated 8-bit composite with native
 * planar, big-endian 16-bit samples. Keeping this boundary narrow prevents an
 * 8-bit canvas from being mislabeled as high-depth output.
 */
export function writeNative16BitRgbPsd(
  psd: Psd,
  composite: Native16BitRgbChannels,
  options: WriteOptions = {},
): ArrayBuffer {
  const psb = !!options.psb;
  const layer = psd.children?.[0];
  const sampleBytes = psd.width * psd.height * 2;
  if (psd.children?.length !== 1 || !layer || layer.children?.length) {
    throw new Error("Native 16-bit RGB output currently requires exactly one raster layer");
  }
  if (psd.colorMode !== 3 || psd.bitsPerChannel !== 16) {
    throw new Error("Native high-depth output currently supports 16-bit RGB only");
  }
  if (layer.left !== 0 || layer.top !== 0 || layer.right !== psd.width || layer.bottom !== psd.height) {
    throw new Error("Native 16-bit RGB layer bounds must match the document");
  }
  if (layer.mask || !layer.rawData || layer.rawData.bitsPerChannel !== 16 || layer.rawData.colorMode !== 3) {
    throw new Error("Native 16-bit RGB output requires raw 16-bit RGB layer channels without a raster mask");
  }
  const layerChannels = layer.rawData.channels;
  if (layerChannels.length !== 3 || layerChannels.some((channel, index) => (
    channel.id !== index || channel.compression !== 0 || channel.data?.byteLength !== sampleBytes
  ))) {
    throw new Error("Native 16-bit RGB layer channels must be complete, planar, and uncompressed");
  }
  if (composite.some((channel) => channel.byteLength !== sampleBytes)) {
    throw new Error("Native 16-bit RGB composite channels do not match the document dimensions");
  }

  // The low-level writer has no supported depth override. Give it an 8-bit
  // structural skeleton while the layer data is already native 16-bit raw.
  const skeleton: Psd = { ...psd, bitsPerChannel: 8, imageData: undefined, canvas: undefined };
  const structural = writePsd(skeleton, { ...options, noBackground: true });
  const compositeOffset = photoshopCompositeOffset(structural, psb);
  const beforeComposite = new Uint8Array(structural, 0, compositeOffset);
  const output = new Uint8Array(compositeOffset + 2 + sampleBytes * 3);
  output.set(beforeComposite);
  const view = new DataView(output.buffer);
  view.setUint16(12, 3, false); // R, G, B; this gated path requires opaque pixels.
  view.setUint16(22, 16, false);
  view.setUint16(compositeOffset, 0, false); // Raw planar composite data.
  let offset = compositeOffset + 2;
  for (const channel of composite) {
    output.set(channel, offset);
    offset += channel.byteLength;
  }
  return output.buffer;
}
