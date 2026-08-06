import type { Document } from "./document";
import { newCanvas } from "./document";
import { renderViewport } from "./renderer";
import type { DisplayViewport } from "./viewport";

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const MAX_IDAT_BYTES = 64 * 1024 * 1024;

function uint32(value: number) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value >>> 0, false);
  return bytes;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function updateCrc(crc: number, bytes: Uint8Array) {
  let value = crc;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return value;
}

function chunk(type: string, parts: Uint8Array[]) {
  const typeBytes = new TextEncoder().encode(type);
  const length = parts.reduce((total, part) => total + part.byteLength, 0);
  let crc = updateCrc(0xffffffff, typeBytes);
  for (const part of parts) crc = updateCrc(crc, part);
  return [uint32(length), typeBytes, ...parts, uint32((crc ^ 0xffffffff) >>> 0)];
}

function blobPart(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

function ihdr(width: number, height: number) {
  const data = new Uint8Array(13);
  const view = new DataView(data.buffer);
  view.setUint32(0, width, false);
  view.setUint32(4, height, false);
  data[8] = 8; // channel depth
  data[9] = 6; // RGBA
  data[10] = 0; // deflate
  data[11] = 0; // adaptive filtering
  data[12] = 0; // no interlace
  return data;
}

type CompressedGroup = { chunks: Uint8Array[]; bytes: number };

function collectCompressed(stream: ReadableStream<Uint8Array>) {
  return (async () => {
    const reader = stream.getReader();
    const groups: CompressedGroup[] = [];
    let group: CompressedGroup = { chunks: [], bytes: 0 };
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      let offset = 0;
      while (offset < value.byteLength) {
        const room = MAX_IDAT_BYTES - group.bytes;
        const take = Math.min(room, value.byteLength - offset);
        group.chunks.push(value.subarray(offset, offset + take));
        group.bytes += take;
        offset += take;
        if (group.bytes === MAX_IDAT_BYTES) {
          groups.push(group);
          group = { chunks: [], bytes: 0 };
        }
      }
    }
    if (group.bytes || !groups.length) groups.push(group);
    return groups;
  })();
}

/**
 * Streams an 8-bit RGBA PNG from bounded compositor tiles. The largest raster
 * allocation is one haloed export tile; document height never affects memory.
 */
export async function exportTiledPng(
  doc: Document,
  options: { tileWidth?: number; bandHeight?: number; halo?: number } = {},
) {
  if (typeof CompressionStream === "undefined") {
    throw new Error("Streaming PNG export requires CompressionStream support");
  }
  if (doc.width > 0x7fffffff || doc.height > 0x7fffffff) {
    throw new Error("PNG dimensions exceed the signed 31-bit interoperability limit");
  }
  const tileWidth = Math.max(64, Math.min(3072, Math.round(options.tileWidth ?? 2048)));
  const bandHeight = Math.max(1, Math.min(64, Math.round(options.bandHeight ?? 16)));
  const halo = Math.max(0, Math.min(512, Math.round(options.halo ?? 256)));
  const compressor = new CompressionStream("deflate");
  const writer = compressor.writable.getWriter();
  const compressed = collectCompressed(compressor.readable);

  for (let bandY = 0; bandY < doc.height; bandY += bandHeight) {
    const height = Math.min(bandHeight, doc.height - bandY);
    const horizontalTiles: Array<{ x: number; width: number; data: Uint8ClampedArray }> = [];
    for (let tileX = 0; tileX < doc.width; tileX += tileWidth) {
      const width = Math.min(tileWidth, doc.width - tileX);
      const renderLeft = Math.max(0, tileX - halo);
      const renderTop = Math.max(0, bandY - halo);
      const renderRight = Math.min(doc.width, tileX + width + halo);
      const renderBottom = Math.min(doc.height, bandY + height + halo);
      const renderWidth = renderRight - renderLeft;
      const renderHeight = renderBottom - renderTop;
      const canvas = newCanvas(renderWidth, renderHeight);
      const viewport: DisplayViewport = {
        x: renderLeft,
        y: renderTop,
        width: renderWidth,
        height: renderHeight,
        zoom: 1,
        outputWidth: renderWidth,
        outputHeight: renderHeight,
        cssScale: 1,
        devicePixelRatio: 1,
      };
      renderViewport(doc, canvas, viewport, {
        checkerboard: false,
        selectionOverlay: false,
        proofing: false,
      });
      const data = canvas.getContext("2d")!.getImageData(
        tileX - renderLeft,
        bandY - renderTop,
        width,
        height,
      ).data;
      horizontalTiles.push({ x: tileX, width, data });
    }

    for (let row = 0; row < height; row += 1) {
      const scanline = new Uint8Array(1 + doc.width * 4);
      scanline[0] = 0;
      for (const tile of horizontalTiles) {
        const sourceStart = row * tile.width * 4;
        scanline.set(tile.data.subarray(sourceStart, sourceStart + tile.width * 4), 1 + tile.x * 4);
      }
      await writer.write(scanline);
    }
  }
  await writer.close();
  const idatGroups = await compressed;
  const parts: BlobPart[] = [blobPart(PNG_SIGNATURE), ...chunk("IHDR", [ihdr(doc.width, doc.height)]).map(blobPart)];
  for (const group of idatGroups) parts.push(...chunk("IDAT", group.chunks).map(blobPart));
  parts.push(...chunk("IEND", []).map(blobPart));
  return new Blob(parts, { type: "image/png" });
}
