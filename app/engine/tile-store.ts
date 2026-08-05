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
    return this.revision;
  }

  delete(key: string) {
    this.grid.parseKey(key);
    if (!this.tiles.delete(key)) return false;
    this.revision += 1;
    this.dirty.set(key, this.revision);
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

  clear() {
    const keys = [...this.tiles.keys()];
    if (!keys.length) return;
    this.tiles.clear();
    for (const key of keys) {
      this.revision += 1;
      this.dirty.set(key, this.revision);
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
