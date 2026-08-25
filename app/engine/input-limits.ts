export const FILE_INPUT_LIMITS = {
  photoshopBytes: 1024 * 1024 * 1024,
  rawBytes: 512 * 1024 * 1024,
  imageBytes: 512 * 1024 * 1024,
  pluginBytes: 8 * 1024 * 1024,
} as const;

const IMAGE_HEADER_SCAN_BYTES = 16 * 1024 * 1024;
export type CanvasLimitCheck = (width: number, height: number) => boolean;

export type RasterHeader = {
  format: "png" | "jpeg" | "webp" | "gif" | "bmp" | "tiff";
  width: number;
  height: number;
};

export type PhotoshopHeader = {
  container: "psd" | "psb";
  channels: number;
  width: number;
  height: number;
  depth: number;
  colorMode: number;
  layers: number;
};

function u16(bytes: Uint8Array, offset: number, littleEndian: boolean) {
  if (offset < 0 || offset + 2 > bytes.byteLength) return null;
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, littleEndian);
}

function u32(bytes: Uint8Array, offset: number, littleEndian: boolean) {
  if (offset < 0 || offset + 4 > bytes.byteLength) return null;
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, littleEndian);
}

function ascii(bytes: Uint8Array, offset: number, value: string) {
  if (offset < 0 || offset + value.length > bytes.byteLength) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (bytes[offset + index] !== value.charCodeAt(index)) return false;
  }
  return true;
}

function jpegDimensions(bytes: Uint8Array): RasterHeader {
  let offset = 2;
  while (offset < bytes.byteLength) {
    while (offset < bytes.byteLength && bytes[offset] !== 0xff) offset += 1;
    while (offset < bytes.byteLength && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.byteLength) break;
    const marker = bytes[offset++];
    if (marker === 0x00 || marker === 0x01 || marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const length = u16(bytes, offset, false);
    if (length === null || length < 2 || offset + length > bytes.byteLength) break;
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isStartOfFrame) {
      const height = u16(bytes, offset + 3, false);
      const width = u16(bytes, offset + 5, false);
      if (width === null || height === null) break;
      return { format: "jpeg", width, height };
    }
    offset += length;
  }
  throw new Error("JPEG dimensions are missing or exceed the safe header scan");
}

function webpDimensions(bytes: Uint8Array): RasterHeader {
  if (ascii(bytes, 12, "VP8X")) {
    if (bytes.byteLength < 30) throw new Error("Truncated WebP header");
    const width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
    const height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
    return { format: "webp", width, height };
  }
  if (ascii(bytes, 12, "VP8 ")) {
    if (bytes.byteLength < 30 || bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) {
      throw new Error("Malformed WebP VP8 header");
    }
    return {
      format: "webp",
      width: (bytes[26] | (bytes[27] << 8)) & 0x3fff,
      height: (bytes[28] | (bytes[29] << 8)) & 0x3fff,
    };
  }
  if (ascii(bytes, 12, "VP8L")) {
    if (bytes.byteLength < 25 || bytes[20] !== 0x2f) throw new Error("Malformed WebP lossless header");
    const b0 = bytes[21], b1 = bytes[22], b2 = bytes[23], b3 = bytes[24];
    return {
      format: "webp",
      width: 1 + b0 + ((b1 & 0x3f) << 8),
      height: 1 + (b1 >> 6) + (b2 << 2) + ((b3 & 0x0f) << 10),
    };
  }
  throw new Error("Unsupported WebP image header");
}

function tiffDimensions(bytes: Uint8Array, littleEndian: boolean): RasterHeader {
  const firstIfd = u32(bytes, 4, littleEndian);
  if (firstIfd === null) throw new Error("Truncated TIFF header");
  const count = u16(bytes, firstIfd, littleEndian);
  if (count === null || count > 4096) throw new Error("Malformed TIFF directory");
  let width: number | null = null;
  let height: number | null = null;
  for (let index = 0; index < count; index += 1) {
    const offset = firstIfd + 2 + index * 12;
    const tag = u16(bytes, offset, littleEndian);
    const type = u16(bytes, offset + 2, littleEndian);
    const values = u32(bytes, offset + 4, littleEndian);
    if (tag === null || type === null || values === null || offset + 12 > bytes.byteLength) break;
    if ((tag !== 256 && tag !== 257) || values !== 1 || (type !== 3 && type !== 4)) continue;
    const value = type === 3 ? u16(bytes, offset + 8, littleEndian) : u32(bytes, offset + 8, littleEndian);
    if (tag === 256) width = value;
    else height = value;
  }
  if (width === null || height === null) throw new Error("TIFF dimensions are missing or exceed the safe header scan");
  return { format: "tiff", width, height };
}

/** Reads dimensions from bounded file headers before a browser decoder can allocate pixels. */
export function inspectRasterHeader(source: ArrayBuffer | Uint8Array): RasterHeader | null {
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
  if (bytes.byteLength >= 24 && bytes[0] === 0x89 && ascii(bytes, 1, "PNG\r\n\x1a\n") && ascii(bytes, 12, "IHDR")) {
    return { format: "png", width: u32(bytes, 16, false)!, height: u32(bytes, 20, false)! };
  }
  if (bytes.byteLength >= 10 && (ascii(bytes, 0, "GIF87a") || ascii(bytes, 0, "GIF89a"))) {
    return { format: "gif", width: u16(bytes, 6, true)!, height: u16(bytes, 8, true)! };
  }
  if (bytes.byteLength >= 26 && ascii(bytes, 0, "BM")) {
    const width = u32(bytes, 18, true)!;
    const signedHeight = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt32(22, true);
    return { format: "bmp", width, height: Math.abs(signedHeight) };
  }
  if (bytes.byteLength >= 12 && ascii(bytes, 0, "RIFF") && ascii(bytes, 8, "WEBP")) return webpDimensions(bytes);
  if (bytes.byteLength >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) return jpegDimensions(bytes);
  if (bytes.byteLength >= 8 && ((ascii(bytes, 0, "II") && u16(bytes, 2, true) === 42) || (ascii(bytes, 0, "MM") && u16(bytes, 2, false) === 42))) {
    return tiffDimensions(bytes, bytes[0] === 0x49);
  }
  return null;
}

export function assertSafeRasterHeader(source: ArrayBuffer | Uint8Array, name: string, exceedsCanvas: CanvasLimitCheck) {
  const header = inspectRasterHeader(source);
  if (!header) return null;
  if (!Number.isSafeInteger(header.width) || !Number.isSafeInteger(header.height) || header.width < 1 || header.height < 1) {
    throw new Error(`${name} has invalid image dimensions`);
  }
  if (exceedsCanvas(header.width, header.height)) {
    throw new Error(`${name} is too large to decode as one bitmap; use a tiled Luma or PSB project`);
  }
  return header;
}

export async function preflightRasterFile(file: Blob & { name?: string }, exceedsCanvas: CanvasLimitCheck) {
  assertFileSize(file, "imageBytes");
  const header = await file.slice(0, IMAGE_HEADER_SCAN_BYTES).arrayBuffer();
  return assertSafeRasterHeader(header, file.name || "Image", exceedsCanvas);
}

function photoshopSectionLength(view: DataView, offset: number, bytes: 4 | 8) {
  if (offset < 0 || offset + bytes > view.byteLength) throw new Error("Truncated Photoshop section table");
  if (bytes === 4) return view.getUint32(offset, false);
  const value = view.getBigUint64(offset, false);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Photoshop section length exceeds the safe integer range");
  return Number(value);
}

function skipPhotoshopSection(view: DataView, offset: number, lengthBytes: 4 | 8) {
  const length = photoshopSectionLength(view, offset, lengthBytes);
  const next = offset + lengthBytes + length;
  if (!Number.isSafeInteger(next) || next > view.byteLength) throw new Error("Malformed Photoshop section length");
  return { dataOffset: offset + lengthBytes, length, next };
}

/** Parses only bounded PSD/PSB structure needed to reject dangerous inputs before ag-psd. */
export function inspectPhotoshopHeader(source: ArrayBuffer | Uint8Array): PhotoshopHeader {
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
  if (bytes.byteLength < 26 || !ascii(bytes, 0, "8BPS")) throw new Error("Invalid Photoshop signature");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint16(4, false);
  if (version !== 1 && version !== 2) throw new Error("Unsupported Photoshop container version");
  for (let offset = 6; offset < 12; offset += 1) {
    if (bytes[offset] !== 0) throw new Error("Malformed Photoshop reserved header bytes");
  }
  const channels = view.getUint16(12, false);
  const height = view.getUint32(14, false);
  const width = view.getUint32(18, false);
  const depth = view.getUint16(22, false);
  const colorMode = view.getUint16(24, false);
  let offset = 26;
  const colorData = skipPhotoshopSection(view, offset, 4);
  offset = colorData.next;
  const resources = skipPhotoshopSection(view, offset, 4);
  offset = resources.next;
  const lengthBytes = version === 1 ? 4 : 8;
  const layerAndMask = skipPhotoshopSection(view, offset, lengthBytes);
  let layers = 0;
  if (layerAndMask.length) {
    const layerInfoLength = photoshopSectionLength(view, layerAndMask.dataOffset, lengthBytes);
    if (layerInfoLength) {
      if (layerInfoLength > layerAndMask.length - lengthBytes) throw new Error("Malformed Photoshop layer-info length");
      const countOffset = layerAndMask.dataOffset + lengthBytes;
      if (countOffset + 2 > layerAndMask.next) throw new Error("Truncated Photoshop layer table");
      layers = Math.abs(view.getInt16(countOffset, false));
    }
  }
  return { container: version === 1 ? "psd" : "psb", channels, width, height, depth, colorMode, layers };
}

export function assertSafePhotoshopHeader(source: ArrayBuffer | Uint8Array, name: string, exceedsCanvas: CanvasLimitCheck) {
  const header = inspectPhotoshopHeader(source);
  if (header.channels < 1 || header.channels > 56) throw new Error(`${name} has an unsafe channel count`);
  if (header.width < 1 || header.height < 1 || header.width > 300_000 || header.height > 300_000) {
    throw new Error(`${name} has invalid Photoshop dimensions`);
  }
  if (![1, 8, 16, 32].includes(header.depth)) throw new Error(`${name} uses an unsupported bit depth`);
  if (![0, 1, 2, 3, 4, 7, 8, 9].includes(header.colorMode)) throw new Error(`${name} uses an invalid color mode`);
  if (header.layers > 100_000) throw new Error(`${name} contains too many layers`);
  if (exceedsCanvas(header.width, header.height)) {
    throw new Error(`${name} exceeds the safe PSD/PSB import canvas; convert it to a tiled Luma project first`);
  }
  return header;
}

export function assertFileSize(file: Blob & { name?: string }, kind: keyof typeof FILE_INPUT_LIMITS) {
  const limit = FILE_INPUT_LIMITS[kind];
  if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > limit) {
    const mb = Math.round(limit / 1024 / 1024);
    throw new Error(`${file.name || "Input"} exceeds the ${mb} MB ${kind} safety limit`);
  }
}
