import {
  createReader,
  readPsd as readPsdFromReader,
} from "ag-psd/dist-es/psdReader.js";
import {
  createWriter,
  getWriterBuffer,
  writePsd as writePsdToWriter,
} from "ag-psd/dist-es/psdWriter.js";
import { initializeCanvas } from "ag-psd/dist-es/helpers.js";
import type { Psd, ReadOptions, WriteOptions } from "ag-psd";

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
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
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
  // ag-psd publishes duplicate declarations under dist/ and dist-es/. Their
  // enum identities differ to TypeScript even though the serialized shape is
  // the same; keep that package artifact contained at this adapter boundary.
  return readPsdFromReader(
    createReader(buffer),
    options as unknown as Parameters<typeof readPsdFromReader>[1],
  ) as unknown as Psd;
}

export function writePsd(psd: Psd, options?: WriteOptions): ArrayBuffer {
  ensureCanvasAdapter();
  const writer = createWriter();
  writePsdToWriter(
    writer,
    psd as unknown as Parameters<typeof writePsdToWriter>[1],
    options as unknown as Parameters<typeof writePsdToWriter>[2],
  );
  return getWriterBuffer(writer);
}

export type Native16BitRgbChannels = readonly [Uint8Array, Uint8Array, Uint8Array];

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
