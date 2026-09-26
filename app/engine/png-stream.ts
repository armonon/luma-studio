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

/** Conservative: only known empty raster masters can skip compositing. */
export function isProvablyTransparent(doc: Document) {
  return doc.layers.filter(layer => layer.visible).every(layer => layer.kind === "raster"
    && !layer.bitmap && Boolean(layer.surface) && !layer.surface!.store.sourceState() && layer.surface!.store.stats().residentTiles === 0
    && !layer.effects?.some(effect => effect.enabled) && !layer.filters?.some(filter => filter.enabled));
}

export function defaultExportHalo(doc: Document) {
  // Plain paint/vector layers need only edge sampling. A fixed 256px halo
  // around every 16-row band used to render ~33 times the necessary pixels.
  return doc.layers.some(layer => layer.effects?.some(effect => effect.enabled)
    || layer.filters?.some(filter => filter.enabled) || layer.spatial?.enabled || layer.text?.spatial?.enabled) ? 256 : 2;
}

function collectCompressed(stream: ReadableStream<Uint8Array>, maximumBytes: number) {
  return (async () => {
    const reader = stream.getReader();
    const groups: CompressedGroup[] = [];
    let group: CompressedGroup = { chunks: [], bytes: 0 };
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        const error = new Error("PNG export exceeds the compressed-output memory ceiling");
        await reader.cancel(error);
        throw error;
      }
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
  options: {
    assertCurrent?: () => void;
    maximumCompressedBytes?: number;
    tileWidth?: number;
    bandHeight?: number;
    halo?: number;
    /**
     * A sub-rectangle of the document to write, for artboard export. Omitted,
     * the whole document is written. Bands and tiles are relative to it, so an
     * artboard past the canvas ceiling streams exactly as a document does.
     */
    region?: { x: number; y: number; width: number; height: number };
  } = {},
) {
  if (typeof CompressionStream === "undefined") {
    throw new Error("Streaming PNG export requires CompressionStream support");
  }
  if (doc.width > 0x7fffffff || doc.height > 0x7fffffff) {
    throw new Error("PNG dimensions exceed the signed 31-bit interoperability limit");
  }
  const tileWidth = Math.max(64, Math.min(3072, Math.round(options.tileWidth ?? 2048)));
  const bandHeight = Math.max(1, Math.min(64, Math.round(options.bandHeight ?? 16)));
  const halo = Math.max(0, Math.min(512, Math.round(options.halo ?? defaultExportHalo(doc))));
  // The region keeps the size it asked for even where it hangs off the
  // document — an artboard partly outside the canvas exports with transparent
  // padding, which is what Photoshop does and what the artboard is *for*.
  // Reading past the edge yields transparent pixels, so the scanlines are still
  // complete. Only the origin and the extent are sanitised, so a region that
  // starts outside the document cannot produce a zero-width render canvas.
  const requested = options.region ?? { x: 0, y: 0, width: doc.width, height: doc.height };
  const region = {
    // The origin is not clamped: an artboard may sit above or left of the
    // canvas origin as well as past its far edge, and the tile loop pads
    // whichever sides the document does not cover. Only the extent is
    // sanitised, because a zero-sized PNG is not a PNG.
    x: Math.round(requested.x),
    y: Math.round(requested.y),
    width: Math.max(1, Math.round(requested.width)),
    height: Math.max(1, Math.round(requested.height)),
  };
  const compressor = new CompressionStream("deflate");
  const writer = compressor.writable.getWriter();
  const maximumBytes = options.maximumCompressedBytes ?? 128 * 1024 * 1024;
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > 128 * 1024 * 1024) throw new Error("Invalid PNG output memory ceiling");
  const compressed = collectCompressed(compressor.readable, maximumBytes);
  // The producer may fail before awaiting the consumer; retain its rejection.
  void compressed.catch(() => undefined);
  const transparent = isProvablyTransparent(doc);

  try {
  for (let bandY = 0; bandY < region.height; bandY += bandHeight) {
    options.assertCurrent?.();
    const height = Math.min(bandHeight, region.height - bandY);
    const horizontalTiles: Array<{ x: number; width: number; data: Uint8ClampedArray }> = [];
    for (let tileX = 0; !transparent && tileX < region.width; tileX += tileWidth) {
      const width = Math.min(tileWidth, region.width - tileX);
      // Where this tile sits in the document, and how much of it the document
      // actually covers. An artboard may hang off the canvas, and reading past
      // the edge of a canvas throws rather than padding, so the part that does
      // not exist is left as the transparent the buffer starts out as.
      const tileLeft = region.x + tileX;
      const tileTop = region.y + bandY;
      const visibleLeft = Math.max(0, tileLeft);
      const visibleTop = Math.max(0, tileTop);
      const visibleRight = Math.min(doc.width, tileLeft + width);
      const visibleBottom = Math.min(doc.height, tileTop + height);
      const data = new Uint8ClampedArray(width * height * 4);
      if (visibleRight <= visibleLeft || visibleBottom <= visibleTop) {
        horizontalTiles.push({ x: tileX, width, data });
        continue;
      }
      const visibleWidth = visibleRight - visibleLeft;
      const visibleHeight = visibleBottom - visibleTop;

      // The halo is clamped to the document, not the region: an artboard's
      // effects sample from the artwork around it, exactly as it previews.
      const renderLeft = Math.max(0, visibleLeft - halo);
      const renderTop = Math.max(0, visibleTop - halo);
      const renderRight = Math.min(doc.width, visibleRight + halo);
      const renderBottom = Math.min(doc.height, visibleBottom + halo);
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
      const visible = canvas.getContext("2d")!.getImageData(
        visibleLeft - renderLeft,
        visibleTop - renderTop,
        visibleWidth,
        visibleHeight,
      ).data;
      // Blit the covered part into the tile at its own offset, so the padding
      // ends up on the side the document runs out on.
      const offsetX = visibleLeft - tileLeft;
      const offsetY = visibleTop - tileTop;
      for (let row = 0; row < visibleHeight; row += 1) {
        const from = row * visibleWidth * 4;
        const to = ((row + offsetY) * width + offsetX) * 4;
        data.set(visible.subarray(from, from + visibleWidth * 4), to);
      }
      horizontalTiles.push({ x: tileX, width, data });
    }

    for (let row = 0; row < height; row += 1) {
      const scanline = new Uint8Array(1 + region.width * 4);
      scanline[0] = 0;
      for (const tile of horizontalTiles) {
        const sourceStart = row * tile.width * 4;
        scanline.set(tile.data.subarray(sourceStart, sourceStart + tile.width * 4), 1 + tile.x * 4);
      }
      await writer.write(scanline);
      options.assertCurrent?.();
    }
  }
  await writer.close();
  const idatGroups = await compressed;
  options.assertCurrent?.();
  const parts: BlobPart[] = [blobPart(PNG_SIGNATURE), ...chunk("IHDR", [ihdr(region.width, region.height)]).map(blobPart)];
  for (const group of idatGroups) parts.push(...chunk("IDAT", group.chunks).map(blobPart));
  parts.push(...chunk("IEND", []).map(blobPart));
  return new Blob(parts, { type: "image/png" });
  } catch (error) {
    await writer.abort(error).catch(() => undefined);
    await compressed.catch(() => undefined);
    throw error;
  } finally {
    writer.releaseLock();
  }
}
