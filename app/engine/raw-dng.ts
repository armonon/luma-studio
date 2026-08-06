import {
  CfaColor,
  Matrix3,
  RawDevelopSettings,
  demosaicBayer,
  developCameraRgb,
  invertMatrix3,
  multiplyMatrices3,
  normalizeSensorMosaic,
  recoverClippedHighlights,
  sanitizeRawDevelopSettings,
  whiteBalanceMultipliers,
} from "./raw-develop";
import { workingToDisplaySrgb } from "./color";
import { decodeLosslessJpeg, LosslessJpegError } from "./lossless-jpeg";

const TAG = {
  imageWidth: 256,
  imageLength: 257,
  bitsPerSample: 258,
  compression: 259,
  photometric: 262,
  fillOrder: 266,
  stripOffsets: 273,
  orientation: 274,
  samplesPerPixel: 277,
  rowsPerStrip: 278,
  stripByteCounts: 279,
  planarConfiguration: 284,
  tileWidth: 322,
  tileLength: 323,
  tileOffsets: 324,
  tileByteCounts: 325,
  subIfds: 330,
  cfaRepeatPatternDim: 33421,
  cfaPattern: 33422,
  dngVersion: 50706,
  cfaPlaneColor: 50710,
  blackLevelRepeatDim: 50713,
  blackLevel: 50714,
  blackLevelDeltaH: 50715,
  blackLevelDeltaV: 50716,
  whiteLevel: 50717,
  colorMatrix1: 50721,
  cameraCalibration1: 50723,
  analogBalance: 50727,
  asShotNeutral: 50728,
  baselineExposure: 50730,
  calibrationIlluminant1: 50778,
  activeArea: 50829,
  opcodeList1: 51008,
  opcodeList2: 51009,
  opcodeList3: 51022,
  forwardMatrix1: 50964,
} as const;

const TYPE_SIZE: Record<number, number> = {
  1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4,
  16: 8, 17: 8, 18: 8,
};

export type RawDecodeErrorCode =
  | "invalid-container"
  | "unsupported-container"
  | "unsupported-compression"
  | "unsupported-pixel-layout"
  | "unsupported-cfa"
  | "corrupt-data";

export class RawDecodeError extends Error {
  constructor(public readonly code: RawDecodeErrorCode, message: string) {
    super(message);
    this.name = "RawDecodeError";
  }
}

export type DngMetadata = {
  width: number;
  height: number;
  bitsPerSample: number;
  compression: number;
  orientation: number;
  cfaPatternDim: readonly [number, number];
  cfaPattern: readonly CfaColor[];
  blackLevelRepeatDim: readonly [number, number];
  blackLevel: readonly number[];
  blackLevelDeltaH?: readonly number[];
  blackLevelDeltaV?: readonly number[];
  whiteLevel: readonly number[];
  asShotNeutral?: readonly number[];
  colorMatrix1?: Matrix3;
  cameraCalibration1?: Matrix3;
  analogBalance?: readonly number[];
  forwardMatrix1?: Matrix3;
  baselineExposure: number;
  calibrationIlluminant1?: number;
  activeArea?: readonly [number, number, number, number];
  dngVersion?: string;
  matrixSource: "forward-matrix-1" | "color-matrix-1" | "assumed-camera-rgb";
  warnings: readonly string[];
};

export type ParsedDng = {
  metadata: DngMetadata;
  sensorSamples: Float32Array;
  container: "classic-tiff" | "bigtiff";
};

export type DevelopedDng = {
  width: number;
  height: number;
  /** Unclipped, scene-referred linear RGBA in settings.workingSpace. */
  pixels: Float32Array;
  metadata: DngMetadata;
  settings: RawDevelopSettings;
  whiteBalanceMultipliers: readonly [number, number, number];
  provenance: {
    mode: "dng-cfa-developed";
    originalName: string;
    format: "DNG";
    decoder: "luma-dng-tiff-v1";
    originalBytes: number;
    matrixSource: DngMetadata["matrixSource"];
    settings: RawDevelopSettings;
    boundary: "classic-tiff-uncompressed-bayer" | "bigtiff-uncompressed-bayer" | "tiff-lossless-jpeg-bayer";
  };
};

export function orientLinearRgba(pixels: Float32Array, width: number, height: number, orientation: number) {
  if (pixels.length !== width * height * 4) throw new RangeError("RGBA orientation dimensions do not match its pixel buffer");
  if (orientation === 1 || orientation < 2 || orientation > 8) return { pixels, width, height };
  const swapsAxes = orientation >= 5;
  const outputWidth = swapsAxes ? height : width;
  const outputHeight = swapsAxes ? width : height;
  const output = new Float32Array(pixels.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let dx = x;
      let dy = y;
      if (orientation === 2) dx = width - 1 - x;
      else if (orientation === 3) { dx = width - 1 - x; dy = height - 1 - y; }
      else if (orientation === 4) dy = height - 1 - y;
      else if (orientation === 5) { dx = y; dy = x; }
      else if (orientation === 6) { dx = height - 1 - y; dy = x; }
      else if (orientation === 7) { dx = height - 1 - y; dy = width - 1 - x; }
      else if (orientation === 8) { dx = y; dy = width - 1 - x; }
      const source = (y * width + x) * 4;
      const destination = (dy * outputWidth + dx) * 4;
      output.set(pixels.subarray(source, source + 4), destination);
    }
  }
  return { pixels: output, width: outputWidth, height: outputHeight };
}

type EntryMap = Map<number, number[]>;
type Ifd = { offset: number; entries: EntryMap };

class TiffReader {
  readonly view: DataView;
  readonly littleEndian: boolean;
  readonly firstIfdOffset: number;
  readonly bigTiff: boolean;
  readonly ifdCountBytes: 2 | 8;
  readonly ifdEntryBytes: 12 | 20;
  readonly inlineValueBytes: 4 | 8;

  constructor(readonly source: ArrayBuffer) {
    this.view = new DataView(source);
    if (source.byteLength < 8) throw new RawDecodeError("invalid-container", "The file is too small to be TIFF/DNG");
    const marker = String.fromCharCode(this.view.getUint8(0), this.view.getUint8(1));
    if (marker !== "II" && marker !== "MM") throw new RawDecodeError("invalid-container", "DNG requires an II or MM TIFF byte-order marker");
    this.littleEndian = marker === "II";
    const magic = this.view.getUint16(2, this.littleEndian);
    if (magic === 43) {
      if (source.byteLength < 16) throw new RawDecodeError("invalid-container", "The BigTIFF header is truncated");
      const offsetBytes = this.view.getUint16(4, this.littleEndian);
      const reserved = this.view.getUint16(6, this.littleEndian);
      if (offsetBytes !== 8 || reserved !== 0) throw new RawDecodeError("unsupported-container", "BigTIFF requires 8-byte offsets and a zero reserved field");
      this.bigTiff = true;
      this.ifdCountBytes = 8;
      this.ifdEntryBytes = 20;
      this.inlineValueBytes = 8;
      this.firstIfdOffset = this.readSafeUint64(8);
    } else {
      if (magic !== 42) throw new RawDecodeError("invalid-container", "The TIFF magic number is invalid");
      this.bigTiff = false;
      this.ifdCountBytes = 2;
      this.ifdEntryBytes = 12;
      this.inlineValueBytes = 4;
      this.firstIfdOffset = this.view.getUint32(4, this.littleEndian);
    }
  }

  private readSafeUint64(offset: number) {
    const value = this.view.getBigUint64(offset, this.littleEndian);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new RawDecodeError("corrupt-data", "A BigTIFF offset exceeds JavaScript's safe integer range");
    return Number(value);
  }

  private readSafeInt64(offset: number) {
    const value = this.view.getBigInt64(offset, this.littleEndian);
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
      throw new RawDecodeError("corrupt-data", "A BigTIFF signed value exceeds JavaScript's safe integer range");
    }
    return Number(value);
  }

  private requireRange(offset: number, length: number) {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > this.source.byteLength) {
      throw new RawDecodeError("corrupt-data", "A TIFF field points outside the file");
    }
  }

  private readValue(type: number, offset: number) {
    switch (type) {
      case 1: case 2: case 7: return this.view.getUint8(offset);
      case 3: return this.view.getUint16(offset, this.littleEndian);
      case 4: case 13: return this.view.getUint32(offset, this.littleEndian);
      case 5: {
        const denominator = this.view.getUint32(offset + 4, this.littleEndian);
        return denominator ? this.view.getUint32(offset, this.littleEndian) / denominator : 0;
      }
      case 6: return this.view.getInt8(offset);
      case 8: return this.view.getInt16(offset, this.littleEndian);
      case 9: return this.view.getInt32(offset, this.littleEndian);
      case 10: {
        const denominator = this.view.getInt32(offset + 4, this.littleEndian);
        return denominator ? this.view.getInt32(offset, this.littleEndian) / denominator : 0;
      }
      case 11: return this.view.getFloat32(offset, this.littleEndian);
      case 12: return this.view.getFloat64(offset, this.littleEndian);
      case 16: case 18: return this.readSafeUint64(offset);
      case 17: return this.readSafeInt64(offset);
      default: throw new RawDecodeError("unsupported-container", `Unsupported TIFF field type ${type}`);
    }
  }

  readIfd(offset: number): Ifd {
    this.requireRange(offset, this.ifdCountBytes);
    const count = this.bigTiff ? this.readSafeUint64(offset) : this.view.getUint16(offset, this.littleEndian);
    if (count > 4096) throw new RawDecodeError("corrupt-data", "The TIFF directory has an unreasonable entry count");
    this.requireRange(offset + this.ifdCountBytes, count * this.ifdEntryBytes + (this.bigTiff ? 8 : 4));
    const entries: EntryMap = new Map();
    for (let index = 0; index < count; index += 1) {
      const entryOffset = offset + this.ifdCountBytes + index * this.ifdEntryBytes;
      const tag = this.view.getUint16(entryOffset, this.littleEndian);
      const type = this.view.getUint16(entryOffset + 2, this.littleEndian);
      const itemCount = this.bigTiff ? this.readSafeUint64(entryOffset + 4) : this.view.getUint32(entryOffset + 4, this.littleEndian);
      const size = TYPE_SIZE[type];
      if (!size) continue;
      if (itemCount > 4_000_000) throw new RawDecodeError("corrupt-data", `TIFF tag ${tag} has an unreasonable value count`);
      const byteLength = itemCount * size;
      const valueFieldOffset = entryOffset + (this.bigTiff ? 12 : 8);
      const valueOffset = byteLength <= this.inlineValueBytes
        ? valueFieldOffset
        : this.bigTiff ? this.readSafeUint64(valueFieldOffset) : this.view.getUint32(valueFieldOffset, this.littleEndian);
      this.requireRange(valueOffset, byteLength);
      const values = new Array<number>(itemCount);
      for (let item = 0; item < itemCount; item += 1) values[item] = this.readValue(type, valueOffset + item * size);
      entries.set(tag, values);
    }
    return { offset, entries };
  }

  allIfds() {
    const output: Ifd[] = [];
    const queue = [this.firstIfdOffset];
    const seen = new Set<number>();
    while (queue.length && output.length < 64) {
      const offset = queue.shift()!;
      if (!offset || seen.has(offset)) continue;
      seen.add(offset);
      const ifd = this.readIfd(offset);
      output.push(ifd);
      for (const child of ifd.entries.get(TAG.subIfds) ?? []) queue.push(child);
      const entryCount = this.bigTiff ? this.readSafeUint64(offset) : this.view.getUint16(offset, this.littleEndian);
      const nextOffset = offset + this.ifdCountBytes + entryCount * this.ifdEntryBytes;
      const next = this.bigTiff ? this.readSafeUint64(nextOffset) : this.view.getUint32(nextOffset, this.littleEndian);
      if (next) queue.push(next);
    }
    return output;
  }

  readImage(entries: EntryMap, width: number, height: number, bits: number) {
    const samplesPerPixel = entries.get(TAG.samplesPerPixel)?.[0] ?? 1;
    const planar = entries.get(TAG.planarConfiguration)?.[0] ?? 1;
    if (samplesPerPixel !== 1 || planar !== 1) {
      throw new RawDecodeError("unsupported-pixel-layout", "The DNG subset requires one chunky CFA sample per pixel");
    }
    const compression = entries.get(TAG.compression)?.[0] ?? 1;
    if (compression !== 1 && compression !== 7) {
      throw new RawDecodeError("unsupported-compression", `DNG compression ${compression} is not decoded locally; the embedded preview remains available`);
    }
    if (![8, 10, 12, 14, 16].includes(bits)) {
      throw new RawDecodeError("unsupported-pixel-layout", `DNG samples with ${bits} bits are not supported`);
    }
    if (width * height > 268_000_000) throw new RawDecodeError("unsupported-pixel-layout", "The RAW frame exceeds the local decoder's safe pixel limit");
    const fillOrder = entries.get(TAG.fillOrder)?.[0] ?? 1;
    if (fillOrder !== 1) throw new RawDecodeError("unsupported-pixel-layout", "Reverse-bit TIFF FillOrder is not supported");
    const output = new Float32Array(width * height);
    const stripOffsets = entries.get(TAG.stripOffsets);
    const stripCounts = entries.get(TAG.stripByteCounts);
    if (stripOffsets?.length && stripCounts?.length) {
      const rowsPerStrip = Math.max(1, entries.get(TAG.rowsPerStrip)?.[0] ?? height);
      for (let strip = 0; strip < stripOffsets.length; strip += 1) {
        const firstRow = strip * rowsPerStrip;
        if (firstRow >= height) break;
        const rows = Math.min(rowsPerStrip, height - firstRow);
        this.decodeImageBlock(compression, stripOffsets[strip], stripCounts[strip] ?? 0, width, rows, bits, output, width, 0, firstRow);
      }
      return output;
    }
    const tileOffsets = entries.get(TAG.tileOffsets);
    const tileCounts = entries.get(TAG.tileByteCounts);
    const tileWidth = entries.get(TAG.tileWidth)?.[0];
    const tileHeight = entries.get(TAG.tileLength)?.[0];
    if (!tileOffsets?.length || !tileCounts?.length || !tileWidth || !tileHeight) {
      throw new RawDecodeError("corrupt-data", "The RAW IFD has neither complete strips nor complete tiles");
    }
    const columns = Math.ceil(width / tileWidth);
    const rows = Math.ceil(height / tileHeight);
    if (tileOffsets.length < columns * rows) throw new RawDecodeError("corrupt-data", "The RAW tile offset table is incomplete");
    for (let tileY = 0; tileY < rows; tileY += 1) {
      for (let tileX = 0; tileX < columns; tileX += 1) {
        const index = tileY * columns + tileX;
        this.decodeImageBlock(
          compression,
          tileOffsets[index], tileCounts[index] ?? 0, tileWidth, tileHeight, bits,
          output, width, tileX * tileWidth, tileY * tileHeight, width, height,
        );
      }
    }
    return output;
  }

  private decodeImageBlock(
    compression: number,
    offset: number,
    byteCount: number,
    blockWidth: number,
    blockHeight: number,
    bits: number,
    destination: Float32Array,
    destinationWidth: number,
    destinationX: number,
    destinationY: number,
    destinationLimitWidth = destinationWidth,
    destinationLimitHeight = destination.length / destinationWidth,
  ) {
    if (compression === 1) {
      this.decodeBlock(
        offset, byteCount, blockWidth, blockHeight, bits,
        destination, destinationWidth, destinationX, destinationY,
        destinationLimitWidth, destinationLimitHeight,
      );
      return;
    }
    this.requireRange(offset, byteCount);
    try {
      const decoded = decodeLosslessJpeg(new Uint8Array(this.source, offset, byteCount));
      if (decoded.width !== blockWidth || decoded.height !== blockHeight || decoded.precision !== bits) {
        throw new RawDecodeError(
          "corrupt-data",
          `Lossless JPEG block is ${decoded.width}×${decoded.height} at ${decoded.precision} bits; expected ${blockWidth}×${blockHeight} at ${bits} bits`,
        );
      }
      for (let row = 0; row < blockHeight; row += 1) {
        const yy = destinationY + row;
        if (yy >= destinationLimitHeight) break;
        for (let column = 0; column < blockWidth; column += 1) {
          const xx = destinationX + column;
          if (xx >= destinationLimitWidth) break;
          destination[yy * destinationWidth + xx] = decoded.samples[row * blockWidth + column];
        }
      }
    } catch (error) {
      if (error instanceof RawDecodeError) throw error;
      const message = error instanceof LosslessJpegError ? error.message : "Lossless JPEG decode failed";
      throw new RawDecodeError("corrupt-data", message);
    }
  }

  private decodeBlock(
    offset: number,
    byteCount: number,
    blockWidth: number,
    blockHeight: number,
    bits: number,
    destination: Float32Array,
    destinationWidth: number,
    destinationX: number,
    destinationY: number,
    destinationLimitWidth = destinationWidth,
    destinationLimitHeight = destination.length / destinationWidth,
  ) {
    const rowBytes = Math.ceil(blockWidth * bits / 8);
    this.requireRange(offset, byteCount);
    if (byteCount < rowBytes * blockHeight) throw new RawDecodeError("corrupt-data", "A RAW strip or tile is shorter than its declared pixels");
    for (let row = 0; row < blockHeight; row += 1) {
      const yy = destinationY + row;
      if (yy >= destinationLimitHeight) break;
      const rowOffset = offset + row * rowBytes;
      for (let column = 0; column < blockWidth; column += 1) {
        const xx = destinationX + column;
        if (xx >= destinationLimitWidth) break;
        destination[yy * destinationWidth + xx] = this.readPackedSample(rowOffset, column, bits);
      }
    }
  }

  private readPackedSample(rowOffset: number, index: number, bits: number) {
    if (bits === 8) return this.view.getUint8(rowOffset + index);
    if (bits === 16) return this.view.getUint16(rowOffset + index * 2, this.littleEndian);
    const firstBit = index * bits;
    let output = 0;
    for (let bit = 0; bit < bits; bit += 1) {
      const absolute = firstBit + bit;
      const byte = this.view.getUint8(rowOffset + Math.floor(absolute / 8));
      output = output * 2 + ((byte >> (7 - absolute % 8)) & 1);
    }
    return output;
  }
}

function value(entries: EntryMap, tag: number, fallback?: number) {
  return entries.get(tag)?.[0] ?? fallback;
}

function matrix(values: readonly number[] | undefined): Matrix3 | undefined {
  if (!values || values.length < 9 || values.slice(0, 9).some((item) => !Number.isFinite(item))) return undefined;
  return values.slice(0, 9) as unknown as Matrix3;
}

function diagonal(values: readonly number[] | undefined): Matrix3 {
  const safe = values && values.length >= 3 ? values : [1, 1, 1];
  return [safe[0], 0, 0, 0, safe[1], 0, 0, 0, safe[2]];
}

const IDENTITY: Matrix3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const D50_TO_D65: Matrix3 = [
  0.9555766, -0.0230393, 0.0631636,
  -0.0282895, 1.0099416, 0.0210077,
  0.0122982, -0.020483, 1.3299098,
];

function cameraToXyz(metadata: DngMetadata): Matrix3 | undefined {
  if (metadata.forwardMatrix1) return multiplyMatrices3(D50_TO_D65, metadata.forwardMatrix1);
  if (!metadata.colorMatrix1) return undefined;
  const xyzToCamera = multiplyMatrices3(
    diagonal(metadata.analogBalance),
    multiplyMatrices3(metadata.cameraCalibration1 ?? IDENTITY, metadata.colorMatrix1),
  );
  const inverse = invertMatrix3(xyzToCamera);
  return inverse ? multiplyMatrices3(D50_TO_D65, inverse) : undefined;
}

function translateCfaPattern(entries: EntryMap, dim: readonly [number, number]) {
  const encoded = entries.get(TAG.cfaPattern) ?? [];
  const planes = entries.get(TAG.cfaPlaneColor) ?? [0, 1, 2];
  if (encoded.length < dim[0] * dim[1]) throw new RawDecodeError("unsupported-cfa", "The DNG CFA pattern is missing or incomplete");
  const translated = encoded.slice(0, dim[0] * dim[1]).map((plane) => planes[plane]) as CfaColor[];
  if (translated.some((color) => color !== 0 && color !== 1 && color !== 2)) {
    throw new RawDecodeError("unsupported-cfa", "Only red, green, and blue CFA planes are supported");
  }
  return translated;
}

export function parseDng(source: ArrayBuffer): ParsedDng {
  const reader = new TiffReader(source);
  const ifds = reader.allIfds();
  const candidates = ifds.filter(({ entries }) => value(entries, TAG.photometric) === 32803 && value(entries, TAG.imageWidth) && value(entries, TAG.imageLength));
  if (!candidates.length) throw new RawDecodeError("unsupported-pixel-layout", "No CFA RAW image directory was found in this TIFF/DNG");
  const selected = candidates.sort((a, b) => {
    const area = (ifd: Ifd) => (value(ifd.entries, TAG.imageWidth, 0)! * value(ifd.entries, TAG.imageLength, 0)!);
    return area(b) - area(a);
  })[0];
  // DNG commonly keeps camera/develop tags in IFD0 and CFA storage in a
  // SubIFD. The selected RAW IFD wins for layout while inheriting globals.
  const entries: EntryMap = new Map([
    ...(ifds[0]?.entries.entries() ?? []),
    ...selected.entries.entries(),
  ]);
  const width = value(entries, TAG.imageWidth)!;
  const height = value(entries, TAG.imageLength)!;
  const bits = value(entries, TAG.bitsPerSample, 16)!;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RawDecodeError("corrupt-data", "The RAW dimensions are invalid");
  }
  const dimValues = entries.get(TAG.cfaRepeatPatternDim) ?? [2, 2];
  const cfaPatternDim: [number, number] = [dimValues[0] ?? 2, dimValues[1] ?? 2];
  const cfaPattern = translateCfaPattern(entries, cfaPatternDim);
  const blackDimValues = entries.get(TAG.blackLevelRepeatDim) ?? cfaPatternDim;
  const blackLevelRepeatDim: [number, number] = [blackDimValues[0] ?? 1, blackDimValues[1] ?? 1];
  const dngVersion = entries.get(TAG.dngVersion)?.slice(0, 4).join(".");
  const colorMatrix1 = matrix(entries.get(TAG.colorMatrix1));
  const forwardMatrix1 = matrix(entries.get(TAG.forwardMatrix1));
  const warnings: string[] = [];
  if (entries.has(TAG.opcodeList1) || entries.has(TAG.opcodeList2) || entries.has(TAG.opcodeList3)) {
    warnings.push("DNG opcode lists are preserved in the source but are not applied by the local decoder");
  }
  if (!forwardMatrix1 && !colorMatrix1) warnings.push("No DNG camera matrix was found; camera channels are treated as working RGB");
  const metadata: DngMetadata = {
    width,
    height,
    bitsPerSample: bits,
    compression: value(entries, TAG.compression, 1)!,
    orientation: value(entries, TAG.orientation, 1)!,
    cfaPatternDim,
    cfaPattern,
    blackLevelRepeatDim,
    blackLevel: entries.get(TAG.blackLevel) ?? [0],
    blackLevelDeltaH: entries.get(TAG.blackLevelDeltaH),
    blackLevelDeltaV: entries.get(TAG.blackLevelDeltaV),
    whiteLevel: entries.get(TAG.whiteLevel) ?? [(2 ** bits) - 1],
    asShotNeutral: entries.get(TAG.asShotNeutral),
    colorMatrix1,
    cameraCalibration1: matrix(entries.get(TAG.cameraCalibration1)),
    analogBalance: entries.get(TAG.analogBalance),
    forwardMatrix1,
    baselineExposure: value(entries, TAG.baselineExposure, 0)!,
    calibrationIlluminant1: value(entries, TAG.calibrationIlluminant1),
    activeArea: entries.get(TAG.activeArea)?.slice(0, 4) as [number, number, number, number] | undefined,
    dngVersion,
    matrixSource: forwardMatrix1 ? "forward-matrix-1" : colorMatrix1 ? "color-matrix-1" : "assumed-camera-rgb",
    warnings,
  };
  const sensorSamples = reader.readImage(entries, width, height, bits);
  return { metadata, sensorSamples, container: reader.bigTiff ? "bigtiff" : "classic-tiff" };
}

export function developParsedDng(
  parsed: ParsedDng,
  originalName: string,
  originalBytes: number,
  settingsInput: Partial<RawDevelopSettings> = {},
): DevelopedDng {
  const { metadata } = parsed;
  const settings = sanitizeRawDevelopSettings({
    ...settingsInput,
    exposureEV: settingsInput.exposureEV ?? metadata.baselineExposure,
  });
  const normalized = normalizeSensorMosaic(parsed.sensorSamples, {
    width: metadata.width,
    height: metadata.height,
    blackLevel: metadata.blackLevel,
    blackLevelRepeatDim: metadata.blackLevelRepeatDim,
    blackLevelDeltaH: metadata.blackLevelDeltaH,
    blackLevelDeltaV: metadata.blackLevelDeltaV,
    whiteLevel: metadata.whiteLevel,
  });
  let mosaic = normalized;
  let developedWidth = metadata.width;
  let developedHeight = metadata.height;
  let pattern = metadata.cfaPattern;
  const active = metadata.activeArea;
  if (active) {
    const top = Math.max(0, Math.min(metadata.height, Math.floor(active[0])));
    const left = Math.max(0, Math.min(metadata.width, Math.floor(active[1])));
    const bottom = Math.max(top, Math.min(metadata.height, Math.floor(active[2])));
    const right = Math.max(left, Math.min(metadata.width, Math.floor(active[3])));
    if (bottom > top && right > left && (top || left || bottom !== metadata.height || right !== metadata.width)) {
      developedWidth = right - left;
      developedHeight = bottom - top;
      mosaic = new Float32Array(developedWidth * developedHeight);
      for (let y = 0; y < developedHeight; y += 1) {
        mosaic.set(normalized.subarray((y + top) * metadata.width + left, (y + top) * metadata.width + right), y * developedWidth);
      }
      const [patternRows, patternColumns] = metadata.cfaPatternDim;
      pattern = Array.from({ length: patternRows * patternColumns }, (_, index) => {
        const y = Math.floor(index / patternColumns);
        const x = index % patternColumns;
        return metadata.cfaPattern[((y + top) % patternRows) * patternColumns + ((x + left) % patternColumns)];
      });
    }
  }
  const cameraRgb = demosaicBayer(mosaic, developedWidth, developedHeight, pattern, metadata.cfaPatternDim);
  const recoveredCameraRgb = recoverClippedHighlights(
    cameraRgb,
    developedWidth,
    developedHeight,
    settings.highlightRecovery,
  );
  const matrixTransform = cameraToXyz(metadata);
  const developed = developCameraRgb(recoveredCameraRgb, settings, {
    asShotNeutral: metadata.asShotNeutral,
    cameraToXyz: matrixTransform,
  });
  const oriented = orientLinearRgba(developed.pixels, developedWidth, developedHeight, metadata.orientation);
  return {
    width: oriented.width,
    height: oriented.height,
    pixels: oriented.pixels,
    metadata,
    settings: developed.settings,
    whiteBalanceMultipliers: developed.whiteBalanceMultipliers,
    provenance: {
      mode: "dng-cfa-developed",
      originalName,
      format: "DNG",
      decoder: "luma-dng-tiff-v1",
      originalBytes,
      matrixSource: metadata.matrixSource,
      settings: developed.settings,
      boundary: parsed.metadata.compression === 7
        ? "tiff-lossless-jpeg-bayer"
        : parsed.container === "bigtiff" ? "bigtiff-uncompressed-bayer" : "classic-tiff-uncompressed-bayer",
    },
  };
}

export function decodeDng(
  source: ArrayBuffer,
  originalName: string,
  settings: Partial<RawDevelopSettings> = {},
) {
  return developParsedDng(parseDng(source), originalName, source.byteLength, settings);
}

/**
 * Re-developable in-memory RAW session. Sensor codes and parsed metadata stay
 * immutable while develop parameters can be previewed, reset, or committed by
 * a host UI. Project persistence should store the original DNG asset alongside
 * `currentSettings` before promising editable RAW after a reload.
 */
export class DngDevelopSession {
  readonly parsed: ParsedDng;
  readonly originalName: string;
  readonly originalBytes: number;
  readonly initialSettings: RawDevelopSettings;
  private settingsValue: RawDevelopSettings;

  constructor(source: ArrayBuffer, originalName: string, settings: Partial<RawDevelopSettings> = {}) {
    this.parsed = parseDng(source);
    this.originalName = originalName;
    this.originalBytes = source.byteLength;
    this.initialSettings = sanitizeRawDevelopSettings({
      ...settings,
      exposureEV: settings.exposureEV ?? this.parsed.metadata.baselineExposure,
    });
    this.settingsValue = { ...this.initialSettings, customWhiteBalance: [...this.initialSettings.customWhiteBalance] };
  }

  get currentSettings() {
    return { ...this.settingsValue, customWhiteBalance: [...this.settingsValue.customWhiteBalance] } as RawDevelopSettings;
  }

  develop(patch: Partial<RawDevelopSettings> = {}) {
    this.settingsValue = sanitizeRawDevelopSettings({ ...this.settingsValue, ...patch });
    return developParsedDng(this.parsed, this.originalName, this.originalBytes, this.settingsValue);
  }

  reset() {
    this.settingsValue = { ...this.initialSettings, customWhiteBalance: [...this.initialSettings.customWhiteBalance] };
    return this.develop();
  }
}

export function previewDisplayRgba(developed: DevelopedDng) {
  const output = new Uint8ClampedArray(developed.width * developed.height * 4);
  const encode = (value: number) => Math.round(Math.max(0, Math.min(1, value)) * 255);
  for (let index = 0; index < output.length; index += 4) {
    const display = workingToDisplaySrgb([
      developed.pixels[index], developed.pixels[index + 1], developed.pixels[index + 2],
    ], developed.settings.workingSpace);
    output[index] = encode(display[0]);
    output[index + 1] = encode(display[1]);
    output[index + 2] = encode(display[2]);
    output[index + 3] = 255;
  }
  return output;
}

export function effectiveWhiteBalance(metadata: DngMetadata, settings: Partial<RawDevelopSettings> = {}) {
  const sanitized = sanitizeRawDevelopSettings(settings);
  return whiteBalanceMultipliers(sanitized.whiteBalance, metadata.asShotNeutral, sanitized.customWhiteBalance);
}
