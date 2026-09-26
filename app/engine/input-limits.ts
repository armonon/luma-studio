export const FILE_INPUT_LIMITS = {
  photoshopBytes: 1024 * 1024 * 1024,
  rawBytes: 512 * 1024 * 1024,
  imageBytes: 512 * 1024 * 1024,
  pluginBytes: 8 * 1024 * 1024,
} as const;

export const PHOTOSHOP_DECODE_MEMORY_CEILING = 2 * 1024 * 1024 * 1024;
export const PROJECT_DECODE_MEMORY_CEILING = 512 * 1024 * 1024;

export type PhotoshopImportPlan = {
  mode: "layered" | "flattened";
  estimatedBytes: number;
  layeredEstimatedBytes: number;
};

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
  /** Validated local layer/mask bounds; absent when only a header is available. */
  layerPixels?: number;
  largestLayerPixels?: number;
  bitmapPixels?: number;
  largestBitmapPixels?: number;
};

export function estimatePhotoshopDecodeBytes(header: PhotoshopHeader, sourceBytes: number) {
  const sampleBytes = header.depth === 32 ? 4 : header.depth === 16 ? 2 : 1;
  const pixels = header.width * header.height;
  const decodedPlanes = (header.layerPixels ?? pixels * Math.max(1, header.layers)) * 4 * sampleBytes;
  const documentPlane = pixels * 4 * sampleBytes;
  if (header.depth === 8 && header.layerPixels !== undefined && header.largestLayerPixels !== undefined) {
    // RGB8 channel decoding is serial. Retained layer canvases and conversion
    // overhead, plus only the largest layer's decode scratch, not a second
    // decoded stack. Keep source, document scratch and fixed reserves unchanged.
    return decodedPlanes * 2 + header.largestLayerPixels * 4 * 2 + documentPlane * 3 + sourceBytes * 3 + 256 * 1024 * 1024;
  }
  // ag-psd materializes raw channels, ImageData and a canvas backing store,
  // while Luma creates its local bitmap/surface master. Real 4,800×6,000
  // corpus files measured close to four decoded-plane working sets plus three
  // full-document scratch/composite planes during import. Keep the estimate
  // deliberately conservative until the streaming decoder replaces ag-psd.
  return decodedPlanes * 4 + documentPlane * 3 + sourceBytes * 3 + 256 * 1024 * 1024;
}

/**
 * Conservative budget for decoding only the document composite. This is the
 * safe fallback for otherwise valid layered PSD/PSB files whose editable
 * planes would cross the process memory ceiling.
 */
export function estimatePhotoshopFlattenedDecodeBytes(header: PhotoshopHeader, sourceBytes: number) {
  const sampleBytes = header.depth === 32 ? 4 : header.depth === 16 ? 2 : 1;
  const documentPlane = header.width * header.height * 4 * sampleBytes;
  // Source preservation + the codec input copy + parser bookkeeping account
  // for the source multiplier. Composite channel storage, ImageData, Luma's
  // local bitmap and export-safe scratch account for four document planes.
  return documentPlane * 4 + sourceBytes * 3 + 256 * 1024 * 1024;
}

export function planPhotoshopImport(
  header: PhotoshopHeader,
  sourceBytes: number,
  ceiling = PHOTOSHOP_DECODE_MEMORY_CEILING,
): PhotoshopImportPlan {
  const layeredEstimatedBytes = estimatePhotoshopDecodeBytes(header, sourceBytes);
  if (Number.isSafeInteger(layeredEstimatedBytes) && layeredEstimatedBytes <= ceiling && estimatePhotoshopProjectRestoreBytes(header, sourceBytes) <= PROJECT_DECODE_MEMORY_CEILING) {
    return { mode: "layered", estimatedBytes: layeredEstimatedBytes, layeredEstimatedBytes };
  }
  const estimatedBytes = estimatePhotoshopFlattenedDecodeBytes(header, sourceBytes);
  if (!Number.isSafeInteger(estimatedBytes) || estimatedBytes > ceiling) {
    throw new Error(
      `Even a flattened Photoshop decode would require approximately ${Math.ceil(estimatedBytes / 1024 / 1024)} MB; `
      + `the safe import ceiling is ${Math.floor(ceiling / 1024 / 1024)} MB. `
      + "Reduce the pixel dimensions in Photoshop before importing.",
    );
  }
  return { mode: "flattened", estimatedBytes, layeredEstimatedBytes };
}

/** Do not auto-open a newly admitted layer stack that cannot fit native restore. */
export function estimatePhotoshopProjectRestoreBytes(header: PhotoshopHeader, sourceBytes: number) {
  if (header.bitmapPixels === undefined || header.largestBitmapPixels === undefined) return 0;
  // Include a retained canvas stack, one serial decoder image, the immutable
  // original, metadata parser reserve and encoded PNG scratch. Masks restore
  // through sparse alpha tiles rather than document-sized RGBA decoder planes.
  return (header.bitmapPixels + header.largestBitmapPixels) * 4 + sourceBytes + 80 * 1024 * 1024;
}

export function assertSafePhotoshopDecodeBudget(
  header: PhotoshopHeader,
  sourceBytes: number,
  ceiling = PHOTOSHOP_DECODE_MEMORY_CEILING,
) {
  const estimated = estimatePhotoshopDecodeBytes(header, sourceBytes);
  if (estimatePhotoshopProjectRestoreBytes(header, sourceBytes) > PROJECT_DECODE_MEMORY_CEILING) {
    throw new Error("The editable Photoshop stack exceeds the native project restore memory ceiling; use a flattened preview until disk-backed layer storage is available.");
  }
  if (!Number.isSafeInteger(estimated) || estimated > ceiling) {
    throw new Error(
      `Photoshop decode would require approximately ${Math.ceil(estimated / 1024 / 1024)} MB; `
      + `the safe import ceiling is ${Math.floor(ceiling / 1024 / 1024)} MB. `
      + "Flatten or reduce the layer count in Photoshop before importing.",
    );
  }
  return estimated;
}

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
  let geometry: { layerPixels: number; largestLayerPixels: number; bitmapPixels: number; largestBitmapPixels: number } | undefined;
  if (layerAndMask.length) {
    const layerInfoLength = photoshopSectionLength(view, layerAndMask.dataOffset, lengthBytes);
    if (layerInfoLength) {
      if (layerInfoLength > layerAndMask.length - lengthBytes) throw new Error("Malformed Photoshop layer-info length");
      const countOffset = layerAndMask.dataOffset + lengthBytes;
      if (countOffset + 2 > layerAndMask.next) throw new Error("Truncated Photoshop layer table");
      layers = Math.abs(view.getInt16(countOffset, false));
      if (layers && colorMode === 3) {
        geometry = inspectLayerPixels(view, countOffset + 2, countOffset + layerInfoLength, layers, lengthBytes);
      }
    }
    // Native Photoshop high-depth files commonly keep the conventional table
    // empty and store their actual layers in Lr16/Lr32. Treating them as flat
    // skipped every layer's pixels and also undercounted decode admission.
    let tagOffset = layerAndMask.dataOffset + lengthBytes + layerInfoLength;
    if (tagOffset + 4 <= layerAndMask.next) {
      const globalMask = skipPhotoshopSection(view, tagOffset, 4);
      if (globalMask.next > layerAndMask.next) throw new Error("Malformed Photoshop global mask");
      tagOffset = globalMask.next;
      let nativeTableSeen = false;
      const largeKeys = new Set(["LMsk", "Lr16", "Lr32", "Layr", "Mt16", "Mt32", "Mtrn", "Alph", "FMsk", "lnk2", "FEid", "FXid", "PxSD"]);
      while (tagOffset + 12 <= layerAndMask.next) {
        const signature = String.fromCharCode(...bytes.subarray(tagOffset, tagOffset + 4));
        if (signature !== "8BIM" && signature !== "8B64") throw new Error("Invalid Photoshop global layer tag");
        const key = String.fromCharCode(...bytes.subarray(tagOffset + 4, tagOffset + 8));
        // Modern Photoshop also writes 8B64 for keys outside the historical
        // PSB list (for example cinf and lnkE). Honor the signature first;
        // otherwise the low word of the length is mistaken for the next tag.
        const tagLengthBytes = signature === "8B64" || version === 2 && largeKeys.has(key) ? 8 : 4;
        const block = skipPhotoshopSection(view, tagOffset + 8, tagLengthBytes);
        if (block.next > layerAndMask.next) throw new Error("Malformed Photoshop global layer tag length");
        if (key === "Lr16" || key === "Lr32") {
          if (nativeTableSeen || layers || depth !== Number(key.slice(2)) || block.length < 2) throw new Error("Ambiguous or malformed Photoshop high-depth layer table");
          nativeTableSeen = true;
          layers = Math.abs(view.getInt16(block.dataOffset, false));
          if (layers) geometry = inspectLayerPixels(view, block.dataOffset + 2, block.next, layers, lengthBytes);
        }
        tagOffset = block.dataOffset + Math.ceil(block.length / 4) * 4;
      }
    }
  }
  return { container: version === 1 ? "psd" : "psb", channels, width, height, depth, colorMode, layers,
    ...geometry };
}

/** Walk fixed records without asking the codec to allocate channels or descriptors. */
function inspectLayerPixels(view: DataView, start: number, end: number, count: number, lengthBytes: 4 | 8) {
  let offset = start, pixels = 0, largestLayerPixels = 0, channelBytes = 0, bitmapPixels = 0, largestBitmapPixels = 0;
  const requireBytes = (at: number, length: number, boundary = end) => {
    if (!Number.isSafeInteger(at + length) || at < start || length < 0 || at + length > boundary) throw new Error("Malformed Photoshop layer record");
  };
  const area = (at: number, boundary = end) => {
    requireBytes(at, 16, boundary);
    const width = view.getInt32(at + 12) - view.getInt32(at + 4);
    const height = view.getInt32(at + 8) - view.getInt32(at);
    if (width < 0 || height < 0 || width > 300_000 || height > 300_000) throw new Error("Invalid Photoshop layer or mask bounds");
    return width * height;
  };
  for (let index = 0; index < count; index++) {
    requireBytes(offset, 18);
    const layerArea = area(offset);
    const channels = view.getUint16(offset + 16);
    if (channels > 56) throw new Error("Unsafe Photoshop layer channel count");
    offset += 18;
    requireBytes(offset, channels * (2 + lengthBytes) + 16);
    for (let channel = 0; channel < channels; channel++) {
      channelBytes += photoshopSectionLength(view, offset + 2, lengthBytes);
      offset += 2 + lengthBytes;
    }
    // Blend signature/key, opacity, clipping, flags and filler, then extra data.
    const extraBytes = view.getUint32(offset + 12);
    offset += 16;
    requireBytes(offset, extraBytes);
    const extraEnd = offset + extraBytes;
    requireBytes(offset, 4, extraEnd);
    const maskBytes = view.getUint32(offset);
    const maskStart = offset + 4;
    requireBytes(maskStart, maskBytes, extraEnd);
    let maskArea = 0;
    if (maskBytes) {
      if (maskBytes < 18) throw new Error("Truncated Photoshop mask bounds");
      maskArea += area(maskStart, extraEnd);
      // Match the codec's secondary-mask layout (flags/color then rectangle).
      if (maskBytes >= 36) maskArea += area(maskStart + 20, extraEnd);
    }
    const layerPixels = layerArea * Math.max(1, Math.ceil(channels / 4)) + maskArea;
    pixels += layerPixels;
    bitmapPixels += layerArea;
    largestBitmapPixels = Math.max(largestBitmapPixels, layerArea);
    largestLayerPixels = Math.max(largestLayerPixels, layerPixels);
    if (!Number.isSafeInteger(pixels) || !Number.isSafeInteger(channelBytes)) throw new Error("Unsafe Photoshop layer allocation");
    offset = extraEnd;
  }
  requireBytes(offset, channelBytes);
  return { layerPixels: pixels, largestLayerPixels, bitmapPixels, largestBitmapPixels };
}

export function assertSafePhotoshopHeader(
  source: ArrayBuffer | Uint8Array,
  name: string,
  exceedsCanvas: CanvasLimitCheck,
  options: { allowFlattenedFallback?: boolean } = {},
) {
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
  if (options.allowFlattenedFallback) planPhotoshopImport(header, source.byteLength);
  else assertSafePhotoshopDecodeBudget(header, source.byteLength);
  return header;
}

export function assertFileSize(file: Blob & { name?: string }, kind: keyof typeof FILE_INPUT_LIMITS) {
  const limit = FILE_INPUT_LIMITS[kind];
  if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > limit) {
    const mb = Math.round(limit / 1024 / 1024);
    throw new Error(`${file.name || "Input"} exceeds the ${mb} MB ${kind} safety limit`);
  }
}
