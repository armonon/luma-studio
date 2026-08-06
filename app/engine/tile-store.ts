import {
  WorkingColorSpace,
  convertWorkingColor,
  displaySrgbToWorking,
  workingToDisplaySrgb,
} from "./color";

export const DEFAULT_TILE_SIZE = 256;

export type PixelFormat = "rgba8" | "rgba16f" | "rgba32f";

export type PixelRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type TileAddress = PixelRect & {
  key: string;
  column: number;
  row: number;
};

export type DirtyTile = {
  key: string;
  revision: number;
  deleted: boolean;
  data?: Uint8Array;
};

const BYTES_PER_PIXEL: Record<PixelFormat, number> = {
  rgba8: 4,
  rgba16f: 8,
  rgba32f: 16,
};

/** Geometry shared by CPU patches, GPU textures, workers, and OPFS storage. */
export class TileGrid {
  readonly width: number;
  readonly height: number;
  readonly tileSize: number;
  readonly columns: number;
  readonly rows: number;

  constructor(width: number, height: number, tileSize = DEFAULT_TILE_SIZE) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
      throw new Error("Tile grid dimensions must be positive integers");
    }
    if (!Number.isInteger(tileSize) || tileSize < 16 || tileSize > 4096) {
      throw new Error("Tile size must be an integer between 16 and 4096");
    }
    this.width = width;
    this.height = height;
    this.tileSize = tileSize;
    this.columns = Math.ceil(width / tileSize);
    this.rows = Math.ceil(height / tileSize);
  }

  get totalTiles() { return this.columns * this.rows; }

  key(column: number, row: number) {
    this.assertCoordinates(column, row);
    return `${column}:${row}`;
  }

  address(column: number, row: number): TileAddress {
    this.assertCoordinates(column, row);
    const x = column * this.tileSize;
    const y = row * this.tileSize;
    return {
      key: `${column}:${row}`,
      column,
      row,
      x,
      y,
      width: Math.min(this.tileSize, this.width - x),
      height: Math.min(this.tileSize, this.height - y),
    };
  }

  addressForPixel(x: number, y: number) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return null;
    return this.address(Math.floor(x / this.tileSize), Math.floor(y / this.tileSize));
  }

  parseKey(key: string) {
    const match = /^(\d+):(\d+)$/.exec(key);
    if (!match) throw new Error(`Invalid tile key: ${key}`);
    return this.address(Number(match[1]), Number(match[2]));
  }

  tilesIntersecting(rect: PixelRect) {
    const left = Math.max(0, Math.floor(rect.x));
    const top = Math.max(0, Math.floor(rect.y));
    const right = Math.min(this.width, Math.ceil(rect.x + Math.max(0, rect.width)));
    const bottom = Math.min(this.height, Math.ceil(rect.y + Math.max(0, rect.height)));
    if (right <= left || bottom <= top) return [];

    const firstColumn = Math.floor(left / this.tileSize);
    const lastColumn = Math.floor((right - 1) / this.tileSize);
    const firstRow = Math.floor(top / this.tileSize);
    const lastRow = Math.floor((bottom - 1) / this.tileSize);
    const addresses: TileAddress[] = [];
    for (let row = firstRow; row <= lastRow; row += 1) {
      for (let column = firstColumn; column <= lastColumn; column += 1) {
        addresses.push(this.address(column, row));
      }
    }
    return addresses;
  }

  estimatedBytes(format: PixelFormat) {
    return this.width * this.height * BYTES_PER_PIXEL[format];
  }

  byteLength(address: TileAddress, format: PixelFormat) {
    return address.width * address.height * BYTES_PER_PIXEL[format];
  }

  private assertCoordinates(column: number, row: number) {
    if (!Number.isInteger(column) || !Number.isInteger(row) ||
        column < 0 || row < 0 || column >= this.columns || row >= this.rows) {
      throw new Error(`Tile coordinates out of bounds: ${column}:${row}`);
    }
  }
}

/**
 * Sparse byte store with dirty tracking. It intentionally has no DOM or GPU
 * dependency, so the same interface can back worker memory, OPFS, or native IO.
 */
export class SparseTileStore {
  readonly grid: TileGrid;
  readonly format: PixelFormat;

  private readonly tiles = new Map<string, Uint8Array>();
  private readonly dirty = new Map<string, number>();
  private readonly tileRevisions = new Map<string, number>();
  private revision = 0;

  constructor(grid: TileGrid, format: PixelFormat = "rgba8") {
    this.grid = grid;
    this.format = format;
  }

  has(key: string) { return this.tiles.has(key); }

  read(key: string) {
    this.grid.parseKey(key);
    const data = this.tiles.get(key);
    return data ? data.slice() : null;
  }

  write(key: string, source: ArrayBufferView) {
    const address = this.grid.parseKey(key);
    const expected = this.grid.byteLength(address, this.format);
    if (source.byteLength !== expected) {
      throw new Error(`Tile ${key} expected ${expected} bytes, received ${source.byteLength}`);
    }
    const data = new Uint8Array(source.buffer, source.byteOffset, source.byteLength).slice();
    this.tiles.set(key, data);
    this.revision += 1;
    this.dirty.set(key, this.revision);
    this.tileRevisions.set(key, this.revision);
    return this.revision;
  }

  delete(key: string) {
    this.grid.parseKey(key);
    if (!this.tiles.delete(key)) return false;
    this.revision += 1;
    this.dirty.set(key, this.revision);
    this.tileRevisions.set(key, this.revision);
    return true;
  }

  drainDirty(): DirtyTile[] {
    const result = [...this.dirty.entries()]
      .sort((a, b) => a[1] - b[1])
      .map(([key, revision]) => {
        const data = this.tiles.get(key);
        return {
          key,
          revision,
          deleted: !data,
          data: data?.slice(),
        };
      });
    this.dirty.clear();
    return result;
  }

  entries() {
    return [...this.tiles.entries()]
      .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
      .map(([key, data]) => ({ key, data: data.slice() }));
  }

  revisionFor(key: string) {
    this.grid.parseKey(key);
    return this.tileRevisions.get(key) ?? 0;
  }

  clear() {
    const keys = [...this.tiles.keys()];
    if (!keys.length) return;
    this.tiles.clear();
    for (const key of keys) {
      this.revision += 1;
      this.dirty.set(key, this.revision);
      this.tileRevisions.set(key, this.revision);
    }
  }

  stats() {
    let residentBytes = 0;
    for (const tile of this.tiles.values()) residentBytes += tile.byteLength;
    return {
      format: this.format,
      tileSize: this.grid.tileSize,
      residentTiles: this.tiles.size,
      totalTiles: this.grid.totalTiles,
      residentBytes,
      dirtyTiles: this.dirty.size,
      revision: this.revision,
    };
  }
}

export type PixelBuffer = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
};

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

/** IEEE-754 binary16 conversion used for lossless `.luma` half-float tiles. */
export function float32ToFloat16(value: number) {
  if (Number.isNaN(value)) return 0x7e00;
  if (value === Infinity) return 0x7c00;
  if (value === -Infinity) return 0xfc00;
  const sign = value < 0 || Object.is(value, -0) ? 0x8000 : 0;
  const magnitude = Math.abs(value);
  if (magnitude === 0) return sign;
  if (magnitude >= 65504) return sign | 0x7bff;
  if (magnitude < 2 ** -14) return sign | Math.round(magnitude / 2 ** -24);
  const exponent = Math.floor(Math.log2(magnitude));
  let fraction = Math.round((magnitude / 2 ** exponent - 1) * 1024);
  let encodedExponent = exponent + 15;
  if (fraction === 1024) {
    fraction = 0;
    encodedExponent += 1;
  }
  return sign | (encodedExponent << 10) | fraction;
}

export function float16ToFloat32(value: number) {
  const sign = value & 0x8000 ? -1 : 1;
  const exponent = (value >>> 10) & 0x1f;
  const fraction = value & 0x3ff;
  if (exponent === 0) return sign * fraction * 2 ** -24;
  if (exponent === 0x1f) return fraction ? Number.NaN : sign * Infinity;
  return sign * (1 + fraction / 1024) * 2 ** (exponent - 15);
}

function readChannel(bytes: Uint8Array, index: number, format: PixelFormat) {
  if (format === "rgba8") return bytes[index] / 255;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (format === "rgba16f") return float16ToFloat32(view.getUint16(index * 2, true));
  return view.getFloat32(index * 4, true);
}

function writeChannel(bytes: Uint8Array, index: number, value: number, format: PixelFormat) {
  if (format === "rgba8") {
    bytes[index] = Math.round(clamp01(value) * 255);
    return;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (format === "rgba16f") view.setUint16(index * 2, float32ToFloat16(value), true);
  else view.setFloat32(index * 4, value, true);
}

/**
 * Sparse, linear-light RGBA pixel surface. Canvas remains a display mirror;
 * this surface is the edit master for 16/32-bit documents and can retain HDR
 * and wide-gamut values that an HTML canvas cannot represent.
 */
export class PrecisionTileSurface {
  readonly grid: TileGrid;
  readonly format: PixelFormat;
  readonly colorSpace: WorkingColorSpace;
  readonly store: SparseTileStore;

  constructor(
    width: number,
    height: number,
    format: PixelFormat = "rgba8",
    colorSpace: WorkingColorSpace = "srgb",
    tileSize = DEFAULT_TILE_SIZE,
  ) {
    this.grid = new TileGrid(width, height, tileSize);
    this.format = format;
    this.colorSpace = colorSpace;
    this.store = new SparseTileStore(this.grid, format);
  }

  static fromImageData(
    image: PixelBuffer,
    format: PixelFormat = "rgba8",
    colorSpace: WorkingColorSpace = "srgb",
    tileSize = DEFAULT_TILE_SIZE,
  ) {
    const surface = new PrecisionTileSurface(image.width, image.height, format, colorSpace, tileSize);
    surface.updateFromImageData(image);
    return surface;
  }

  static fromTiles(
    width: number,
    height: number,
    format: PixelFormat,
    colorSpace: WorkingColorSpace,
    tileSize: number,
    tiles: ReadonlyArray<{ key: string; data: Uint8Array }>,
  ) {
    const surface = new PrecisionTileSurface(width, height, format, colorSpace, tileSize);
    for (const tile of tiles) surface.store.write(tile.key, tile.data);
    surface.store.drainDirty();
    return surface;
  }

  clone() {
    return PrecisionTileSurface.fromTiles(
      this.grid.width,
      this.grid.height,
      this.format,
      this.colorSpace,
      this.grid.tileSize,
      this.store.entries(),
    );
  }

  updateFromImageData(image: PixelBuffer, destX = 0, destY = 0) {
    const affected = this.grid.tilesIntersecting({ x: destX, y: destY, width: image.width, height: image.height });
    for (const address of affected) {
      const bytes = this.store.read(address.key) ?? new Uint8Array(this.grid.byteLength(address, this.format));
      const left = Math.max(address.x, destX);
      const top = Math.max(address.y, destY);
      const right = Math.min(address.x + address.width, destX + image.width);
      const bottom = Math.min(address.y + address.height, destY + image.height);
      for (let y = top; y < bottom; y += 1) {
        for (let x = left; x < right; x += 1) {
          const sourceIndex = ((y - destY) * image.width + (x - destX)) * 4;
          const targetIndex = ((y - address.y) * address.width + (x - address.x)) * 4;
          const working = displaySrgbToWorking([
            image.data[sourceIndex] / 255,
            image.data[sourceIndex + 1] / 255,
            image.data[sourceIndex + 2] / 255,
          ], this.colorSpace);
          writeChannel(bytes, targetIndex, working[0], this.format);
          writeChannel(bytes, targetIndex + 1, working[1], this.format);
          writeChannel(bytes, targetIndex + 2, working[2], this.format);
          writeChannel(bytes, targetIndex + 3, image.data[sourceIndex + 3] / 255, this.format);
        }
      }
      if (bytes.some((value) => value !== 0)) this.store.write(address.key, bytes);
      else this.store.delete(address.key);
    }
  }

  readPixel(x: number, y: number): [number, number, number, number] {
    const address = this.grid.addressForPixel(x, y);
    if (!address) throw new Error(`Pixel out of bounds: ${x}:${y}`);
    const bytes = this.store.read(address.key);
    if (!bytes) return [0, 0, 0, 0];
    const index = ((y - address.y) * address.width + (x - address.x)) * 4;
    return [
      readChannel(bytes, index, this.format),
      readChannel(bytes, index + 1, this.format),
      readChannel(bytes, index + 2, this.format),
      readChannel(bytes, index + 3, this.format),
    ];
  }

  writePixel(x: number, y: number, rgba: readonly [number, number, number, number]) {
    const address = this.grid.addressForPixel(x, y);
    if (!address) throw new Error(`Pixel out of bounds: ${x}:${y}`);
    const bytes = this.store.read(address.key) ?? new Uint8Array(this.grid.byteLength(address, this.format));
    const index = ((y - address.y) * address.width + (x - address.x)) * 4;
    for (let channel = 0; channel < 4; channel += 1) writeChannel(bytes, index + channel, rgba[channel], this.format);
    this.store.write(address.key, bytes);
  }

  toRgba8(): PixelBuffer {
    const data = new Uint8ClampedArray(this.grid.width * this.grid.height * 4);
    for (const { key, data: bytes } of this.store.entries()) {
      const address = this.grid.parseKey(key);
      for (let y = 0; y < address.height; y += 1) {
        for (let x = 0; x < address.width; x += 1) {
          const sourceIndex = (y * address.width + x) * 4;
          const targetIndex = ((address.y + y) * this.grid.width + address.x + x) * 4;
          const display = workingToDisplaySrgb([
            readChannel(bytes, sourceIndex, this.format),
            readChannel(bytes, sourceIndex + 1, this.format),
            readChannel(bytes, sourceIndex + 2, this.format),
          ], this.colorSpace);
          data[targetIndex] = Math.round(clamp01(display[0]) * 255);
          data[targetIndex + 1] = Math.round(clamp01(display[1]) * 255);
          data[targetIndex + 2] = Math.round(clamp01(display[2]) * 255);
          data[targetIndex + 3] = Math.round(clamp01(readChannel(bytes, sourceIndex + 3, this.format)) * 255);
        }
      }
    }
    return { width: this.grid.width, height: this.grid.height, data };
  }

  tileToRgba8(key: string): PixelBuffer {
    const address = this.grid.parseKey(key);
    const data = new Uint8ClampedArray(address.width * address.height * 4);
    const bytes = this.store.read(key);
    if (!bytes) return { width: address.width, height: address.height, data };
    for (let index = 0; index < address.width * address.height * 4; index += 4) {
      const display = workingToDisplaySrgb([
        readChannel(bytes, index, this.format),
        readChannel(bytes, index + 1, this.format),
        readChannel(bytes, index + 2, this.format),
      ], this.colorSpace);
      data[index] = Math.round(clamp01(display[0]) * 255);
      data[index + 1] = Math.round(clamp01(display[1]) * 255);
      data[index + 2] = Math.round(clamp01(display[2]) * 255);
      data[index + 3] = Math.round(clamp01(readChannel(bytes, index + 3, this.format)) * 255);
    }
    return { width: address.width, height: address.height, data };
  }

  /** Float display-sRGB tile for RGBA16F GPU upload; unclipped values retain HDR and gamut excursions. */
  tileToFloat32Display(key: string, premultiplied = true, flipY = false) {
    const address = this.grid.parseKey(key);
    const output = new Float32Array(address.width * address.height * 4);
    const bytes = this.store.read(key);
    if (!bytes) return output;
    for (let y = 0; y < address.height; y += 1) {
      const targetY = flipY ? address.height - y - 1 : y;
      for (let x = 0; x < address.width; x += 1) {
        const sourceIndex = (y * address.width + x) * 4;
        const targetIndex = (targetY * address.width + x) * 4;
        const alpha = readChannel(bytes, sourceIndex + 3, this.format);
        const display = workingToDisplaySrgb([
          readChannel(bytes, sourceIndex, this.format),
          readChannel(bytes, sourceIndex + 1, this.format),
          readChannel(bytes, sourceIndex + 2, this.format),
        ], this.colorSpace);
        output[targetIndex] = display[0] * (premultiplied ? alpha : 1);
        output[targetIndex + 1] = display[1] * (premultiplied ? alpha : 1);
        output[targetIndex + 2] = display[2] * (premultiplied ? alpha : 1);
        output[targetIndex + 3] = alpha;
      }
    }
    return output;
  }

  convert(format: PixelFormat, colorSpace: WorkingColorSpace) {
    const converted = new PrecisionTileSurface(
      this.grid.width,
      this.grid.height,
      format,
      colorSpace,
      this.grid.tileSize,
    );
    for (const { key, data: bytes } of this.store.entries()) {
      const address = this.grid.parseKey(key);
      const target = new Uint8Array(converted.grid.byteLength(address, format));
      for (let index = 0; index < address.width * address.height * 4; index += 4) {
        const rgb = convertWorkingColor([
          readChannel(bytes, index, this.format),
          readChannel(bytes, index + 1, this.format),
          readChannel(bytes, index + 2, this.format),
        ], this.colorSpace, colorSpace);
        writeChannel(target, index, rgb[0], format);
        writeChannel(target, index + 1, rgb[1], format);
        writeChannel(target, index + 2, rgb[2], format);
        writeChannel(target, index + 3, readChannel(bytes, index + 3, this.format), format);
      }
      converted.store.write(key, target);
    }
    return converted;
  }

  stats() {
    return { ...this.store.stats(), colorSpace: this.colorSpace };
  }
}
