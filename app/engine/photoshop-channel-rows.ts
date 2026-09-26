import type { Layer as PsdLayer } from "ag-psd";
import { newCanvas } from "./document";
import { exceedsBrowserCanvas } from "./large-documents";

/** Bounded RGB8 raw/PackBits reader. ZIP/high-depth keep the admitted codec path. */
export function photoshopChannelRows(bytes: Uint8Array, width: number, height: number, compression: number, large: boolean) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || !Number.isSafeInteger(width * height) || width < 1 || height < 1) throw new Error("Invalid Photoshop channel geometry");
  const assertRow = (row: number, output: Uint8Array) => {
    if (!Number.isInteger(row) || row < 0 || row >= height || output.length !== width) throw new Error("Invalid Photoshop row target");
  };
  if (compression === 0) {
    if (bytes.length !== width * height) throw new Error("Photoshop raw channel size mismatch");
    return (row: number, output: Uint8Array) => { assertRow(row, output); output.set(bytes.subarray(row * width, (row + 1) * width)); };
  }
  if (compression !== 1) throw new Error("Unsupported row compression");
  const lengthBytes = large ? 4 : 2;
  const tableBytes = height * lengthBytes;
  if (tableBytes > bytes.length) throw new Error("Truncated Photoshop row table");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const offsets = new Uint32Array(height + 1);
  offsets[0] = tableBytes;
  let offset = tableBytes;
  for (let y = 0; y < height; y++) {
    offset += large ? view.getUint32(y * 4) : view.getUint16(y * 2);
    if (offset > bytes.length) throw new Error("Truncated Photoshop row payload");
    offsets[y + 1] = offset;
  }
  if (offset !== bytes.length) throw new Error("Photoshop channel has trailing payload");
  return (row: number, output: Uint8Array) => {
    assertRow(row, output);
    let source = offsets[row], target = 0;
    const end = offsets[row + 1];
    while (source < end) {
      const control = bytes[source++];
      if (control === 128) continue; // PackBits no-op
      const count = control < 128 ? control + 1 : 257 - control;
      if (target + count > width) throw new Error("Photoshop row exceeds its width");
      if (control < 128) {
        if (source + count > end) throw new Error("Truncated Photoshop literal run");
        output.set(bytes.subarray(source, source + count), target); source += count;
      } else {
        if (source >= end) throw new Error("Truncated Photoshop repeated run");
        output.fill(bytes[source++], target, target + count);
      }
      target += count;
    }
    if (target !== width) throw new Error("Photoshop row is incomplete");
  };
}

/** Allocate only the retained canvas, <=1 MiB RGBA scratch and one channel row. */
export function decodePhotoshopRasterRows(layer: PsdLayer): HTMLCanvasElement | null {
  const raw = layer.rawData;
  if (!raw || raw.bitsPerChannel !== 8 || raw.colorMode !== 3) return null;
  const width = (layer.right ?? 0) - (layer.left ?? 0), height = (layer.bottom ?? 0) - (layer.top ?? 0);
  if (!width || !height) return null;
  if (width < 0 || height < 0 || exceedsBrowserCanvas(width, height)) throw new Error("Unsafe Photoshop layer bounds");
  const channels = raw.channels.filter(channel => channel.id >= -1 && channel.id <= 2 && channel.data?.length);
  if (!channels.length || channels.some(channel => channel.compression !== 0 && channel.compression !== 1)) return null;
  if (new Set(channels.map(channel => channel.id)).size !== channels.length) throw new Error("Duplicate Photoshop color channel");
  const readers = channels.map(channel => ({ offset: channel.id === -1 ? 3 : channel.id,
    read: photoshopChannelRows(channel.data!, width, height, channel.compression, raw.large) }));
  const canvas = newCanvas(width, height);
  try {
    const context = canvas.getContext("2d")!;
    const rows = Math.min(height, Math.max(1, Math.floor(1024 * 1024 / (width * 4))));
    const image = context.createImageData(width, rows);
    const row = new Uint8Array(width);
    for (let y = 0; y < height; y += rows) {
      const count = Math.min(rows, height - y);
      image.data.fill(0);
      for (let i = 3; i < count * width * 4; i += 4) image.data[i] = 255;
      for (const reader of readers) for (let dy = 0; dy < count; dy++) {
        reader.read(y + dy, row);
        for (let x = 0; x < width; x++) image.data[(dy * width + x) * 4 + reader.offset] = row[x];
      }
      context.putImageData(image, 0, y, 0, 0, width, count);
    }
    return canvas;
  } catch (error) {
    canvas.width = 1; canvas.height = 1;
    throw error;
  }
}
