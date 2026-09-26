import { DEFAULT_TILE_SIZE, PixelRect, TileAddress, TileGrid } from "./tile-store";
import { ResidentMemoryBudget, type ResidentMemoryAccount } from "./resident-memory";

export const DEFAULT_ALPHA_MEMORY_CEILING = 256 * 1024 * 1024;
export const DEFAULT_ALPHA_RECORD_CEILING = 1_000_000;
export const DEFAULT_ALPHA_SCRATCH_CEILING = 64 * 1024 * 1024;
const RECORD_OVERHEAD_BYTES = 48;

export type AlphaCombineMode = "replace" | "add" | "subtract" | "intersect";
export type AlphaCalculation = "multiply" | "screen" | "difference" | "add" | "subtract";
export type AlphaTileRecord = number | Uint8Array;
export type AlphaTilePatch = {
  key: string;
  before: AlphaTileRecord | null;
  after: AlphaTileRecord | null;
};

export class AlphaMemoryLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AlphaMemoryLimitError";
  }
}

function clampByte(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function cloneRecord(record: AlphaTileRecord | null | undefined): AlphaTileRecord | null {
  if (record === null || record === undefined) return null;
  return typeof record === "number" ? record : record.slice();
}

function intersects(a: PixelRect, b: PixelRect) {
  return a.x < b.x + b.width && a.x + a.width > b.x &&
    a.y < b.y + b.height && a.y + a.height > b.y;
}

export function alphaTileRecordBytes(record: AlphaTileRecord | null | undefined) {
  if (record === null || record === undefined) return 0;
  return RECORD_OVERHEAD_BYTES + (typeof record === "number" ? 1 : record.byteLength);
}

function compactAlpha(source: Uint8Array, fallback: number): AlphaTileRecord | null {
  const first = source[0] ?? fallback;
  let uniform = true;
  for (let index = 1; index < source.length; index += 1) {
    if (source[index] !== first) { uniform = false; break; }
  }
  if (uniform) return first === fallback ? null : first;
  return source.slice();
}

function combineAlpha(current: number, source: number, mode: AlphaCombineMode) {
  if (mode === "replace") return source;
  if (mode === "add") return 255 - Math.round((255 - current) * (255 - source) / 255);
  if (mode === "subtract") return Math.round(current * (255 - source) / 255);
  return Math.round(current * source / 255);
}

function clippedRect(rect: PixelRect, width: number, height: number) {
  const left = Math.max(0, Math.floor(rect.x));
  const top = Math.max(0, Math.floor(rect.y));
  const right = Math.min(width, Math.ceil(rect.x + Math.max(0, rect.width)));
  const bottom = Math.min(height, Math.ceil(rect.y + Math.max(0, rect.height)));
  return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

export function assertAlphaScratch(bytes: number, ceiling = DEFAULT_ALPHA_SCRATCH_CEILING) {
  if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > ceiling) {
    throw new AlphaMemoryLimitError(`Alpha operation requires ${Math.ceil(bytes / 1024 / 1024)} MB of scratch memory; the ceiling is ${Math.floor(ceiling / 1024 / 1024)} MB`);
  }
}

/**
 * Sparse 8-bit alpha plane shared by selections and layer masks.
 *
 * Tiles compact to a single byte when uniform. Missing tiles inherit the
 * surface default, so Select All and reveal-all masks occupy zero tile bytes,
 * and inversion only flips defaults/records instead of visiting every pixel.
 */
export class SparseAlphaSurface {
  readonly grid: TileGrid;
  readonly memoryCeiling: number;
  readonly recordCeiling: number;
  private records = new Map<string, AlphaTileRecord>();
  private residentBytes = 0;
  private _defaultAlpha: number;
  private _revision = 0;
  private residentMemoryAccount: ResidentMemoryAccount | null = null;
  private residentMemoryBudget: ResidentMemoryBudget | null = null;

  constructor(
    width: number,
    height: number,
    options: {
      tileSize?: number;
      defaultAlpha?: number;
      memoryCeiling?: number;
      recordCeiling?: number;
    } = {},
  ) {
    this.grid = new TileGrid(width, height, options.tileSize ?? DEFAULT_TILE_SIZE);
    this._defaultAlpha = clampByte(options.defaultAlpha ?? 0);
    this.memoryCeiling = options.memoryCeiling ?? DEFAULT_ALPHA_MEMORY_CEILING;
    this.recordCeiling = options.recordCeiling ?? DEFAULT_ALPHA_RECORD_CEILING;
  }

  get width() { return this.grid.width; }
  get height() { return this.grid.height; }
  get tileSize() { return this.grid.tileSize; }
  get defaultAlpha() { return this._defaultAlpha; }
  get revision() { return this._revision; }

  bindMemoryBudget(budget: ResidentMemoryBudget, label = "alpha surface") {
    if (this.residentMemoryBudget === budget && this.residentMemoryAccount?.active()) return;
    this.residentMemoryAccount?.release();
    this.residentMemoryBudget = budget;
    this.residentMemoryAccount = budget.register(this, label, this.residentBytes);
  }

  unbindMemoryBudget() {
    this.residentMemoryAccount?.release();
    this.residentMemoryAccount = null;
    this.residentMemoryBudget = null;
  }

  stats() {
    return {
      width: this.width,
      height: this.height,
      tileSize: this.tileSize,
      totalTiles: this.grid.totalTiles,
      residentTiles: this.records.size,
      residentBytes: this.residentBytes,
      memoryCeiling: this.memoryCeiling,
      recordCeiling: this.recordCeiling,
      defaultAlpha: this.defaultAlpha,
      revision: this.revision,
    };
  }

  reset(defaultAlpha = this.defaultAlpha) {
    this.residentMemoryAccount?.resize(0);
    this.records.clear();
    this.residentBytes = 0;
    this._defaultAlpha = clampByte(defaultAlpha);
    this._revision += 1;
  }

  setDefaultAlpha(defaultAlpha: number) {
    const next = clampByte(defaultAlpha);
    if (next === this._defaultAlpha) return;
    this._defaultAlpha = next;
    for (const [key, record] of [...this.records]) {
      if (typeof record === "number") this.setRecord(key, record === next ? null : record);
      else this.setRecord(key, compactAlpha(record, next));
    }
    this._revision += 1;
  }

  keys() { return [...this.records.keys()]; }

  record(key: string) {
    this.grid.parseKey(key);
    return cloneRecord(this.records.get(key));
  }

  readTile(key: string) {
    const address = this.grid.parseKey(key);
    const record = this.records.get(key);
    const length = address.width * address.height;
    if (typeof record === "number") return new Uint8Array(length).fill(record);
    if (record) return record.slice();
    return new Uint8Array(length).fill(this.defaultAlpha);
  }

  writeTile(key: string, source: Uint8Array | Uint8ClampedArray) {
    const address = this.grid.parseKey(key);
    const expected = address.width * address.height;
    if (source.byteLength !== expected) throw new Error(`Alpha tile ${key} expected ${expected} bytes, received ${source.byteLength}`);
    this.setRecord(key, compactAlpha(new Uint8Array(source.buffer, source.byteOffset, source.byteLength), this.defaultAlpha));
  }

  writeUniform(key: string, alpha: number) {
    this.grid.parseKey(key);
    const value = clampByte(alpha);
    this.setRecord(key, value === this.defaultAlpha ? null : value);
  }

  applyPatch(patch: AlphaTilePatch, side: "before" | "after") {
    this.setRecord(patch.key, cloneRecord(patch[side]));
  }

  clone() {
    const result = new SparseAlphaSurface(this.width, this.height, {
      tileSize: this.tileSize,
      defaultAlpha: this.defaultAlpha,
      memoryCeiling: this.memoryCeiling,
      recordCeiling: this.recordCeiling,
    });
    for (const [key, record] of this.records) result.setRecord(key, cloneRecord(record));
    result._revision = this._revision;
    return result;
  }

  inverted() {
    const result = new SparseAlphaSurface(this.width, this.height, {
      tileSize: this.tileSize,
      defaultAlpha: 255 - this.defaultAlpha,
      memoryCeiling: this.memoryCeiling,
      recordCeiling: this.recordCeiling,
    });
    for (const [key, record] of this.records) {
      if (typeof record === "number") result.writeUniform(key, 255 - record);
      else {
        const next = new Uint8Array(record.length);
        for (let index = 0; index < record.length; index += 1) next[index] = 255 - record[index];
        result.writeTile(key, next);
      }
    }
    return result;
  }

  translated(deltaX: number, deltaY: number) {
    if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) throw new Error("Invalid alpha translation");
    const result = new SparseAlphaSurface(this.width, this.height, {
      tileSize: this.tileSize,
      defaultAlpha: 0,
      memoryCeiling: this.memoryCeiling,
      recordCeiling: this.recordCeiling,
    });
    const candidates = new Map<string, TileAddress>();
    const addRegion = (rect: PixelRect) => {
      for (const address of result.grid.tilesIntersecting(rect)) candidates.set(address.key, address);
    };
    if (this.defaultAlpha > 0) {
      result.fillRect({ x: deltaX, y: deltaY, width: this.width, height: this.height }, this.defaultAlpha);
      // Only the four resampled perimeter strips differ from the uniform
      // interior. Avoid visiting billions of pixels for a translated Select All.
      addRegion({ x: deltaX - 1, y: deltaY - 1, width: this.width + 2, height: 3 });
      addRegion({ x: deltaX - 1, y: deltaY + this.height - 2, width: this.width + 2, height: 3 });
      addRegion({ x: deltaX - 1, y: deltaY - 1, width: 3, height: this.height + 2 });
      addRegion({ x: deltaX + this.width - 2, y: deltaY - 1, width: 3, height: this.height + 2 });
    }
    for (const key of this.records.keys()) {
      const source = this.grid.parseKey(key);
      addRegion({ x: source.x + deltaX - 1, y: source.y + deltaY - 1, width: source.width + 2, height: source.height + 2 });
    }
    for (const address of candidates.values()) {
      const alpha = new Uint8Array(address.width * address.height);
      for (let row = 0; row < address.height; row += 1) {
        for (let column = 0; column < address.width; column += 1) {
          alpha[row * address.width + column] = this.sampleBilinear(
            address.x + column + 0.5 - deltaX,
            address.y + row + 0.5 - deltaY,
          );
        }
      }
      result.writeTile(address.key, alpha);
    }
    return result;
  }

  resized(width: number, height: number) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      throw new Error("Invalid alpha surface dimensions");
    }
    const result = new SparseAlphaSurface(width, height, {
      tileSize: this.tileSize,
      defaultAlpha: this.defaultAlpha,
      memoryCeiling: this.memoryCeiling,
      recordCeiling: this.recordCeiling,
    });
    const scaleX = width / this.width;
    const scaleY = height / this.height;
    const candidates = new Map<string, TileAddress>();
    for (const key of this.records.keys()) {
      const source = this.grid.parseKey(key);
      const region = {
        x: source.x * scaleX - 2,
        y: source.y * scaleY - 2,
        width: source.width * scaleX + 4,
        height: source.height * scaleY + 4,
      };
      for (const address of result.grid.tilesIntersecting(region)) candidates.set(address.key, address);
    }
    for (const address of candidates.values()) {
      const alpha = new Uint8Array(address.width * address.height);
      for (let row = 0; row < address.height; row += 1) {
        for (let column = 0; column < address.width; column += 1) {
          alpha[row * address.width + column] = this.sampleBilinear(
            (address.x + column + 0.5) / scaleX,
            (address.y + row + 0.5) / scaleY,
          );
        }
      }
      result.writeTile(address.key, alpha);
    }
    return result;
  }

  /** Resample sparse mask edits into another document coordinate system.
   * Unlike selection translation, the implicit mask value extends beyond the
   * old canvas. Reveal-all therefore remains reveal-all after canvas growth.
   * Admission happens before building a tile list or allocating pixel buffers.
   */
  remapped(width: number, height: number, scale: number, dx: number, dy: number, maximumBytes = DEFAULT_ALPHA_SCRATCH_CEILING) {
    if (![width, height].every(n => Number.isSafeInteger(n) && n > 0) ||
        ![scale, dx, dy, maximumBytes].every(Number.isFinite) || scale <= 0 || maximumBytes < 0) throw new Error("Invalid sparse mask mapping");
    const result = new SparseAlphaSurface(width, height, { tileSize: this.tileSize, defaultAlpha: this.defaultAlpha,
      memoryCeiling: this.memoryCeiling, recordCeiling: this.recordCeiling });
    const candidates = new Map<string, TileAddress>();
    let bytes = 0;
    for (const key of this.records.keys()) {
      const source = this.grid.parseKey(key), size = this.tileSize;
      const left = Math.max(0, Math.floor((source.x * scale + dx - scale - 1) / size));
      const top = Math.max(0, Math.floor((source.y * scale + dy - scale - 1) / size));
      const right = Math.min(result.grid.columns, Math.ceil(((source.x + source.width) * scale + dx + scale + 1) / size));
      const bottom = Math.min(result.grid.rows, Math.ceil(((source.y + source.height) * scale + dy + scale + 1) / size));
      for (let row = top; row < bottom; row++) for (let col = left; col < right; col++) {
        const key = `${col}:${row}`;
        if (candidates.has(key)) continue;
        const address = result.grid.address(col, row);
        bytes += address.width * address.height + RECORD_OVERHEAD_BYTES;
        if (bytes > Math.min(maximumBytes, this.memoryCeiling) || candidates.size >= this.recordCeiling)
          throw new AlphaMemoryLimitError("Sparse mask remap exceeds the admitted tile budget; no document was changed");
        candidates.set(key, address);
      }
    }
    const sample = (x: number, y: number) => x < 0 || y < 0 || x >= this.width || y >= this.height ? this.defaultAlpha : this.sample(x, y);
    for (const address of candidates.values()) {
      const alpha = new Uint8Array(address.width * address.height);
      for (let row = 0; row < address.height; row++) for (let col = 0; col < address.width; col++) {
        const x = (address.x + col + .5 - dx) / scale - .5, y = (address.y + row + .5 - dy) / scale - .5;
        const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
        alpha[row * address.width + col] = clampByte((sample(x0, y0) * (1 - fx) + sample(x0 + 1, y0) * fx) * (1 - fy) +
          (sample(x0, y0 + 1) * (1 - fx) + sample(x0 + 1, y0 + 1) * fx) * fy);
      }
      result.writeTile(address.key, alpha);
    }
    return result;
  }

  cropped(x: number, y: number, width: number, height: number) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 ||
        !Number.isFinite(x) || !Number.isFinite(y)) throw new Error("Invalid alpha crop");
    const result = new SparseAlphaSurface(width, height, {
      tileSize: this.tileSize,
      defaultAlpha: this.defaultAlpha,
      memoryCeiling: this.memoryCeiling,
      recordCeiling: this.recordCeiling,
    });
    const candidates = new Map<string, TileAddress>();
    for (const key of this.records.keys()) {
      const source = this.grid.parseKey(key);
      for (const address of result.grid.tilesIntersecting({
        x: source.x - x,
        y: source.y - y,
        width: source.width,
        height: source.height,
      })) candidates.set(address.key, address);
    }
    for (const address of candidates.values()) {
      const alpha = new Uint8Array(address.width * address.height);
      for (let row = 0; row < address.height; row += 1) for (let column = 0; column < address.width; column += 1) {
        alpha[row * address.width + column] = this.sample(address.x + column + x, address.y + row + y);
      }
      result.writeTile(address.key, alpha);
    }
    return result;
  }

  sample(x: number, y: number) {
    const address = this.grid.addressForPixel(Math.floor(x), Math.floor(y));
    if (!address) return 0;
    const record = this.records.get(address.key);
    if (typeof record === "number") return record;
    if (!record) return this.defaultAlpha;
    return record[(Math.floor(y) - address.y) * address.width + Math.floor(x) - address.x];
  }

  private sampleBilinear(centerX: number, centerY: number) {
    const x = centerX - 0.5;
    const y = centerY - 0.5;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const top = this.sample(x0, y0) * (1 - fx) + this.sample(x0 + 1, y0) * fx;
    const bottom = this.sample(x0, y0 + 1) * (1 - fx) + this.sample(x0 + 1, y0 + 1) * fx;
    return clampByte(top * (1 - fy) + bottom * fy);
  }

  readRegion(rect: PixelRect, options: { allowOutside?: boolean; scratchCeiling?: number } = {}) {
    const x = Math.floor(rect.x);
    const y = Math.floor(rect.y);
    const width = Math.max(0, Math.ceil(rect.width));
    const height = Math.max(0, Math.ceil(rect.height));
    assertAlphaScratch(width * height, options.scratchCeiling);
    const output = new Uint8ClampedArray(width * height);
    const inside = clippedRect({ x, y, width, height }, this.width, this.height);
    if (!inside.width || !inside.height) return output;
    for (const address of this.grid.tilesIntersecting(inside)) {
      const tile = this.readTile(address.key);
      const left = Math.max(inside.x, address.x);
      const top = Math.max(inside.y, address.y);
      const right = Math.min(inside.x + inside.width, address.x + address.width);
      const bottom = Math.min(inside.y + inside.height, address.y + address.height);
      for (let row = top; row < bottom; row += 1) {
        const sourceOffset = (row - address.y) * address.width + left - address.x;
        const targetOffset = (row - y) * width + left - x;
        output.set(tile.subarray(sourceOffset, sourceOffset + right - left), targetOffset);
      }
    }
    return output;
  }

  writeRegion(rect: PixelRect, alpha: Uint8Array | Uint8ClampedArray) {
    const region = clippedRect(rect, this.width, this.height);
    const sourceWidth = Math.max(0, Math.ceil(rect.width));
    const sourceHeight = Math.max(0, Math.ceil(rect.height));
    if (alpha.byteLength !== sourceWidth * sourceHeight) throw new Error("Alpha region dimensions do not match its payload");
    assertAlphaScratch(alpha.byteLength);
    if (!region.width || !region.height) return [] as AlphaTilePatch[];
    const staged = new Map<string, AlphaTileRecord | null>();
    for (const address of this.grid.tilesIntersecting(region)) {
      const tile = this.readTile(address.key);
      const left = Math.max(region.x, address.x);
      const top = Math.max(region.y, address.y);
      const right = Math.min(region.x + region.width, address.x + address.width);
      const bottom = Math.min(region.y + region.height, address.y + address.height);
      for (let row = top; row < bottom; row += 1) {
        const sourceOffset = (row - Math.floor(rect.y)) * sourceWidth + left - Math.floor(rect.x);
        const targetOffset = (row - address.y) * address.width + left - address.x;
        tile.set(alpha.subarray(sourceOffset, sourceOffset + right - left), targetOffset);
      }
      staged.set(address.key, compactAlpha(tile, this.defaultAlpha));
    }
    return this.commitRecords(staged);
  }

  fillRect(rect: PixelRect, alpha: number) {
    const region = clippedRect(rect, this.width, this.height);
    if (!region.width || !region.height) return [] as AlphaTilePatch[];
    if (region.x === 0 && region.y === 0 && region.width === this.width && region.height === this.height) {
      const before = this.keys().map((key) => ({ key, before: this.record(key), after: null }));
      this.reset(alpha);
      return before;
    }
    const value = clampByte(alpha);
    const addresses = value === this.defaultAlpha
      ? [...this.records.keys()]
        .map((key) => this.grid.parseKey(key))
        .filter((address) => intersects(address, region))
      : this.grid.tilesIntersecting(region);
    if (value !== this.defaultAlpha && this.records.size + addresses.length > this.recordCeiling) {
      throw new AlphaMemoryLimitError(`Alpha surface would exceed ${this.recordCeiling.toLocaleString()} resident tiles`);
    }
    const staged = new Map<string, AlphaTileRecord | null>();
    for (const address of addresses) {
      const full = region.x <= address.x && region.y <= address.y &&
        region.x + region.width >= address.x + address.width &&
        region.y + region.height >= address.y + address.height;
      if (full) staged.set(address.key, value === this.defaultAlpha ? null : value);
      else {
        const tile = this.readTile(address.key);
        const left = Math.max(region.x, address.x);
        const top = Math.max(region.y, address.y);
        const right = Math.min(region.x + region.width, address.x + address.width);
        const bottom = Math.min(region.y + region.height, address.y + address.height);
        for (let row = top; row < bottom; row += 1) {
          tile.fill(value, (row - address.y) * address.width + left - address.x, (row - address.y) * address.width + right - address.x);
        }
        staged.set(address.key, compactAlpha(tile, this.defaultAlpha));
      }
    }
    return this.commitRecords(staged);
  }

  combined(source: SparseAlphaSurface, mode: AlphaCombineMode) {
    if (source.width !== this.width || source.height !== this.height || source.tileSize !== this.tileSize) {
      throw new Error("Alpha surfaces must share dimensions and tile geometry");
    }
    if (mode === "replace") return source.clone();
    const result = new SparseAlphaSurface(this.width, this.height, {
      tileSize: this.tileSize,
      defaultAlpha: combineAlpha(this.defaultAlpha, source.defaultAlpha, mode),
      memoryCeiling: Math.min(this.memoryCeiling, source.memoryCeiling),
      recordCeiling: Math.min(this.recordCeiling, source.recordCeiling),
    });
    const keys = new Set([...this.records.keys(), ...source.records.keys()]);
    for (const key of keys) {
      const current = this.readTile(key);
      const incoming = source.readTile(key);
      const output = new Uint8Array(current.length);
      for (let index = 0; index < output.length; index += 1) output[index] = combineAlpha(current[index], incoming[index], mode);
      result.writeTile(key, output);
    }
    return result;
  }

  /** Channel math visits stored tiles only, including inverted/default-filled planes. */
  calculated(source: SparseAlphaSurface, mode: AlphaCalculation, opacity = 1) {
    if (source.width !== this.width || source.height !== this.height || source.tileSize !== this.tileSize) throw new Error("Channel dimensions must match");
    if (!["multiply", "screen", "difference", "add", "subtract"].includes(mode) || !Number.isFinite(opacity) || opacity < 0 || opacity > 1) throw new Error("Invalid channel calculation");
    const calculate = (a: number, b: number) => {
      const mixed = mode === "multiply" ? a * b / 255 : mode === "screen" ? 255 - (255 - a) * (255 - b) / 255
        : mode === "difference" ? Math.abs(a - b) : mode === "add" ? Math.min(255, a + b) : Math.max(0, a - b);
      return clampByte(a + (mixed - a) * opacity);
    };
    const result = new SparseAlphaSurface(this.width, this.height, { tileSize: this.tileSize,
      defaultAlpha: calculate(this.defaultAlpha, source.defaultAlpha),
      memoryCeiling: Math.min(this.memoryCeiling, source.memoryCeiling), recordCeiling: Math.min(this.recordCeiling, source.recordCeiling) });
    for (const key of new Set([...this.records.keys(), ...source.records.keys()])) {
      const a = this.readTile(key), b = source.readTile(key), output = new Uint8Array(a.length);
      for (let i = 0; i < output.length; i++) output[i] = calculate(a[i], b[i]);
      result.writeTile(key, output);
    }
    return result;
  }

  bounds() {
    if (this.defaultAlpha > 0) return { x: 0, y: 0, w: this.width, h: this.height };
    let minX = this.width;
    let minY = this.height;
    let maxX = -1;
    let maxY = -1;
    for (const [key, record] of this.records) {
      const address = this.grid.parseKey(key);
      if (typeof record === "number") {
        if (record <= 0) continue;
        minX = Math.min(minX, address.x);
        minY = Math.min(minY, address.y);
        maxX = Math.max(maxX, address.x + address.width - 1);
        maxY = Math.max(maxY, address.y + address.height - 1);
        continue;
      }
      for (let row = 0; row < address.height; row += 1) {
        for (let column = 0; column < address.width; column += 1) {
          if (!record[row * address.width + column]) continue;
          const x = address.x + column;
          const y = address.y + row;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
    }
    return maxX < 0 ? { x: 0, y: 0, w: 0, h: 0 } : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  }

  recordBounds() {
    let minX = this.width;
    let minY = this.height;
    let maxX = 0;
    let maxY = 0;
    for (const key of this.records.keys()) {
      const address = this.grid.parseKey(key);
      minX = Math.min(minX, address.x);
      minY = Math.min(minY, address.y);
      maxX = Math.max(maxX, address.x + address.width);
      maxY = Math.max(maxY, address.y + address.height);
    }
    return maxX <= minX || maxY <= minY
      ? { x: 0, y: 0, width: 0, height: 0 }
      : { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }

  addressesAroundRecords(padding: number) {
    const keys = new Set<string>();
    for (const key of this.records.keys()) {
      const address = this.grid.parseKey(key);
      const region = {
        x: address.x - padding,
        y: address.y - padding,
        width: address.width + padding * 2,
        height: address.height + padding * 2,
      };
      for (const candidate of this.grid.tilesIntersecting(region)) keys.add(candidate.key);
    }
    return [...keys].map((key) => this.grid.parseKey(key));
  }

  /**
   * The tiles within `depth` rings of the document border.
   *
   * A filter that reads past the edge of a `defaultAlpha > 0` surface changes
   * every tile its kernel can reach, not just the outermost ring — feather at
   * a large radius reaches several tiles inward. Asking for one ring when the
   * kernel spans three leaves the ramp truncated at a tile boundary, which
   * reads as a hard seam rather than a soft edge.
   */
  edgeAddresses(depth = 1) {
    const rings = Math.max(1, Math.min(Math.ceil(depth), Math.max(this.grid.columns, this.grid.rows)));
    const result = new Map<string, TileAddress>();
    const add = (column: number, row: number) => {
      const address = this.grid.address(column, row);
      result.set(address.key, address);
    };
    for (let ring = 0; ring < rings; ring += 1) {
      if (ring < this.grid.rows) {
        for (let column = 0; column < this.grid.columns; column += 1) {
          add(column, ring);
          add(column, this.grid.rows - 1 - ring);
        }
      }
      if (ring < this.grid.columns) {
        for (let row = 0; row < this.grid.rows; row += 1) {
          add(ring, row);
          add(this.grid.columns - 1 - ring, row);
        }
      }
    }
    return [...result.values()];
  }

  private setRecord(key: string, record: AlphaTileRecord | null) {
    this.grid.parseKey(key);
    const previous = this.records.get(key);
    const nextCount = this.records.size - (previous === undefined ? 0 : 1) + (record === null ? 0 : 1);
    const nextBytes = this.residentBytes - alphaTileRecordBytes(previous) + alphaTileRecordBytes(record);
    if (nextCount > this.recordCeiling) throw new AlphaMemoryLimitError(`Alpha surface would exceed ${this.recordCeiling.toLocaleString()} resident tiles`);
    if (nextBytes > this.memoryCeiling) throw new AlphaMemoryLimitError(`Alpha surface would exceed its ${Math.floor(this.memoryCeiling / 1024 / 1024)} MB memory ceiling`);
    const prepared = cloneRecord(record);
    this.residentMemoryAccount?.resize(nextBytes);
    if (record === null) this.records.delete(key);
    else this.records.set(key, prepared!);
    this.residentBytes = nextBytes;
    this._revision += 1;
  }

  /** Validate a multi-tile mutation in full before changing the live surface. */
  private commitRecords(staged: ReadonlyMap<string, AlphaTileRecord | null>) {
    let nextCount = this.records.size;
    let nextBytes = this.residentBytes;
    for (const [key, record] of staged) {
      this.grid.parseKey(key);
      const previous = this.records.get(key);
      nextCount += (record === null ? 0 : 1) - (previous === undefined ? 0 : 1);
      nextBytes += alphaTileRecordBytes(record) - alphaTileRecordBytes(previous);
    }
    if (nextCount > this.recordCeiling) {
      throw new AlphaMemoryLimitError(`Alpha surface would exceed ${this.recordCeiling.toLocaleString()} resident tiles`);
    }
    if (nextBytes > this.memoryCeiling) {
      throw new AlphaMemoryLimitError(`Alpha surface would exceed its ${Math.floor(this.memoryCeiling / 1024 / 1024)} MB memory ceiling`);
    }
    const prepared = [...staged].map(([key, record]) => [key, cloneRecord(record)] as const);
    this.residentMemoryAccount?.resize(nextBytes);
    const patches: AlphaTilePatch[] = [];
    for (const [key, record] of prepared) {
      const before = this.record(key);
      if (record === null) this.records.delete(key);
      else this.records.set(key, cloneRecord(record)!);
      this._revision += 1;
      patches.push({ key, before, after: cloneRecord(record) });
    }
    this.residentBytes = nextBytes;
    return patches;
  }
}
