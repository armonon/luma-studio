import type { PixelRect } from "./tile-store";

export type VirtualTileKey = `${number}/${number}/${number}`;

export type PyramidLevel = {
  level: number;
  scale: number;
  width: number;
  height: number;
  columns: number;
  rows: number;
  totalTiles: number;
};

export type VirtualTileAddress = {
  key: VirtualTileKey;
  level: number;
  column: number;
  row: number;
  /** Rectangle in this pyramid level's pixel coordinates. */
  levelRect: PixelRect;
  /** Rectangle covered by the tile in full-resolution document coordinates. */
  documentRect: PixelRect;
};

export type VirtualViewport = PixelRect & {
  /** Device/display pixels per full-resolution document pixel. */
  zoom: number;
};

export type TileRequestReason = "visible" | "fallback" | "prefetch";

export type VirtualTileRequest = {
  key: VirtualTileKey;
  address: VirtualTileAddress;
  priority: number;
  reason: TileRequestReason;
  distanceToViewportCenter: number;
};

export type ViewportPlan = {
  level: number;
  viewport: PixelRect;
  requests: VirtualTileRequest[];
  visibleTileCount: number;
  fallbackTileCount: number;
  prefetchTileCount: number;
  truncated: boolean;
};

export type ViewportPlanOptions = {
  /** Extra desired-level tiles around the visible viewport. Defaults to 1. */
  prefetchMarginTiles?: number;
  /** Number of coarser levels requested as progressive fallbacks. Defaults to 2. */
  fallbackLevels?: number;
  /** Positive values choose a finer mip level; negative values choose a coarser one. */
  levelBias?: number;
  /** Hard guard against accidentally materializing an enormous request list. */
  maxRequests?: number;
};

function assertFiniteInteger(value: number, name: string, minimum: number, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be a safe integer between ${minimum} and ${maximum}`);
  }
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function clipRect(rect: PixelRect, width: number, height: number): PixelRect | null {
  const left = clamp(rect.x, 0, width);
  const top = clamp(rect.y, 0, height);
  const right = clamp(rect.x + Math.max(0, rect.width), 0, width);
  const bottom = clamp(rect.y + Math.max(0, rect.height), 0, height);
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function compareRequests(a: VirtualTileRequest, b: VirtualTileRequest) {
  return b.priority - a.priority ||
    a.distanceToViewportCenter - b.distanceToViewportCenter ||
    b.address.level - a.address.level ||
    a.address.row - b.address.row ||
    a.address.column - b.address.column;
}

/**
 * Sparse pyramid geometry for documents that can be many gigapixels. Geometry
 * is computed arithmetically; constructing this object never allocates per-tile
 * state.
 */
export class VirtualCanvasPyramid {
  readonly width: number;
  readonly height: number;
  readonly tileSize: number;
  readonly maxLevel: number;

  constructor(width: number, height: number, tileSize = 256, maxLevel?: number) {
    assertFiniteInteger(width, "width", 1);
    assertFiniteInteger(height, "height", 1);
    assertFiniteInteger(tileSize, "tileSize", 16, 4096);
    this.width = width;
    this.height = height;
    this.tileSize = tileSize;

    const naturalMax = Math.max(0, Math.ceil(Math.log2(Math.max(width, height) / tileSize)));
    if (maxLevel === undefined) {
      this.maxLevel = naturalMax;
    } else {
      assertFiniteInteger(maxLevel, "maxLevel", 0, 52);
      this.maxLevel = maxLevel;
    }
  }

  level(level: number): PyramidLevel {
    this.assertLevel(level);
    const scale = 2 ** level;
    const width = Math.max(1, Math.ceil(this.width / scale));
    const height = Math.max(1, Math.ceil(this.height / scale));
    const columns = Math.ceil(width / this.tileSize);
    const rows = Math.ceil(height / this.tileSize);
    return { level, scale, width, height, columns, rows, totalTiles: columns * rows };
  }

  key(level: number, column: number, row: number): VirtualTileKey {
    this.assertCoordinates(level, column, row);
    return `${level}/${column}/${row}`;
  }

  parseKey(key: string): VirtualTileAddress {
    const match = /^(0|[1-9]\d*)\/(0|[1-9]\d*)\/(0|[1-9]\d*)$/.exec(key);
    if (!match) throw new Error(`Invalid virtual tile key: ${key}`);
    return this.address(Number(match[1]), Number(match[2]), Number(match[3]));
  }

  address(level: number, column: number, row: number): VirtualTileAddress {
    this.assertCoordinates(level, column, row);
    const descriptor = this.level(level);
    const x = column * this.tileSize;
    const y = row * this.tileSize;
    const levelRect = {
      x,
      y,
      width: Math.min(this.tileSize, descriptor.width - x),
      height: Math.min(this.tileSize, descriptor.height - y),
    };
    const documentX = x * descriptor.scale;
    const documentY = y * descriptor.scale;
    return {
      key: `${level}/${column}/${row}`,
      level,
      column,
      row,
      levelRect,
      documentRect: {
        x: documentX,
        y: documentY,
        width: Math.min(this.width - documentX, levelRect.width * descriptor.scale),
        height: Math.min(this.height - documentY, levelRect.height * descriptor.scale),
      },
    };
  }

  tilesIntersecting(level: number, documentRect: PixelRect) {
    const range = this.tileRangeIntersecting(level, documentRect);
    if (!range) return [];
    const result: VirtualTileAddress[] = [];
    for (let row = range.firstRow; row <= range.lastRow; row += 1) {
      for (let column = range.firstColumn; column <= range.lastColumn; column += 1) {
        result.push(this.address(level, column, row));
      }
    }
    return result;
  }

  tileRangeIntersecting(level: number, documentRect: PixelRect) {
    const clipped = clipRect(documentRect, this.width, this.height);
    if (!clipped) return null;
    const descriptor = this.level(level);
    const tileSpan = descriptor.scale * this.tileSize;
    const firstColumn = Math.floor(clipped.x / tileSpan);
    const firstRow = Math.floor(clipped.y / tileSpan);
    const lastColumn = Math.min(descriptor.columns - 1, Math.ceil((clipped.x + clipped.width) / tileSpan) - 1);
    const lastRow = Math.min(descriptor.rows - 1, Math.ceil((clipped.y + clipped.height) / tileSpan) - 1);
    return {
      firstColumn,
      lastColumn,
      firstRow,
      lastRow,
      columns: lastColumn - firstColumn + 1,
      rows: lastRow - firstRow + 1,
      totalTiles: (lastColumn - firstColumn + 1) * (lastRow - firstRow + 1),
    };
  }

  /**
   * Returns the closest intersecting tiles while allocating O(limit), even if
   * the requested rectangle spans millions of tiles.
   */
  tilesIntersectingNearest(level: number, documentRect: PixelRect, limit: number) {
    assertFiniteInteger(limit, "limit", 1, 1_000_000);
    const range = this.tileRangeIntersecting(level, documentRect);
    if (!range) return { tiles: [] as VirtualTileAddress[], totalTiles: 0, truncated: false };
    if (range.totalTiles <= limit) {
      return { tiles: this.tilesIntersecting(level, documentRect), totalTiles: range.totalTiles, truncated: false };
    }

    const descriptor = this.level(level);
    const centerColumn = clamp(
      Math.floor((documentRect.x + documentRect.width / 2) / descriptor.scale / this.tileSize),
      range.firstColumn,
      range.lastColumn,
    );
    const centerRow = clamp(
      Math.floor((documentRect.y + documentRect.height / 2) / descriptor.scale / this.tileSize),
      range.firstRow,
      range.lastRow,
    );
    let selectedColumns = Math.min(
      range.columns,
      Math.max(1, Math.ceil(Math.sqrt(limit * range.columns / range.rows))),
    );
    let selectedRows = Math.min(range.rows, Math.max(1, Math.ceil(limit / selectedColumns)));
    while (selectedColumns * selectedRows < limit &&
      (selectedColumns < range.columns || selectedRows < range.rows)) {
      if (selectedColumns < range.columns) selectedColumns += 1;
      else selectedRows += 1;
    }
    const firstColumn = clamp(
      centerColumn - Math.floor(selectedColumns / 2),
      range.firstColumn,
      range.lastColumn - selectedColumns + 1,
    );
    const firstRow = clamp(
      centerRow - Math.floor(selectedRows / 2),
      range.firstRow,
      range.lastRow - selectedRows + 1,
    );
    const tiles: VirtualTileAddress[] = [];
    for (let row = firstRow; row < firstRow + selectedRows; row += 1) {
      for (let column = firstColumn; column < firstColumn + selectedColumns; column += 1) {
        tiles.push(this.address(level, column, row));
      }
    }
    tiles.sort((a, b) => {
      const aDistance = (a.column - centerColumn) ** 2 + (a.row - centerRow) ** 2;
      const bDistance = (b.column - centerColumn) ** 2 + (b.row - centerRow) ** 2;
      return aDistance - bDistance || a.row - b.row || a.column - b.column;
    });
    return { tiles: tiles.slice(0, limit), totalTiles: range.totalTiles, truncated: true };
  }

  /** Chooses a mip whose source texel density is close to the display density. */
  levelForZoom(zoom: number, levelBias = 0) {
    if (!Number.isFinite(zoom) || zoom <= 0) throw new Error("zoom must be a positive finite number");
    if (!Number.isFinite(levelBias)) throw new Error("levelBias must be finite");
    const ideal = Math.floor(Math.log2(1 / zoom)) - Math.round(levelBias);
    return clamp(ideal, 0, this.maxLevel);
  }

  private assertLevel(level: number) {
    assertFiniteInteger(level, "level", 0, this.maxLevel);
  }

  private assertCoordinates(level: number, column: number, row: number) {
    this.assertLevel(level);
    const descriptor = this.level(level);
    if (!Number.isSafeInteger(column) || !Number.isSafeInteger(row) ||
        column < 0 || row < 0 || column >= descriptor.columns || row >= descriptor.rows) {
      throw new Error(`Virtual tile coordinates out of bounds: ${level}/${column}/${row}`);
    }
  }
}

/** Builds a bounded, priority-ordered working set for the current viewport. */
export class ViewportTilePlanner {
  constructor(readonly pyramid: VirtualCanvasPyramid) {}

  plan(viewport: VirtualViewport, options: ViewportPlanOptions = {}): ViewportPlan {
    if (!Number.isFinite(viewport.zoom) || viewport.zoom <= 0) {
      throw new Error("viewport zoom must be a positive finite number");
    }
    const prefetchMarginTiles = options.prefetchMarginTiles ?? 1;
    const fallbackLevels = options.fallbackLevels ?? 2;
    const maxRequests = options.maxRequests ?? 4096;
    assertFiniteInteger(prefetchMarginTiles, "prefetchMarginTiles", 0, 64);
    assertFiniteInteger(fallbackLevels, "fallbackLevels", 0, 52);
    assertFiniteInteger(maxRequests, "maxRequests", 1, 1_000_000);

    const clipped = clipRect(viewport, this.pyramid.width, this.pyramid.height);
    const level = this.pyramid.levelForZoom(viewport.zoom, options.levelBias);
    if (!clipped) {
      return {
        level,
        viewport: { x: viewport.x, y: viewport.y, width: 0, height: 0 },
        requests: [],
        visibleTileCount: 0,
        fallbackTileCount: 0,
        prefetchTileCount: 0,
        truncated: false,
      };
    }

    const centerX = clipped.x + clipped.width / 2;
    const centerY = clipped.y + clipped.height / 2;
    const byKey = new Map<VirtualTileKey, VirtualTileRequest>();
    const add = (address: VirtualTileAddress, reason: TileRequestReason) => {
      const tileCenterX = address.documentRect.x + address.documentRect.width / 2;
      const tileCenterY = address.documentRect.y + address.documentRect.height / 2;
      const distance = Math.hypot(tileCenterX - centerX, tileCenterY - centerY);
      const normalizedDistance = distance / Math.max(address.documentRect.width, address.documentRect.height, 1);
      const reasonPriority = reason === "visible" ? 300_000 : reason === "fallback" ? 200_000 : 100_000;
      const request: VirtualTileRequest = {
        key: address.key,
        address,
        reason,
        priority: reasonPriority - Math.round(normalizedDistance * 100) - address.level,
        distanceToViewportCenter: distance,
      };
      const previous = byKey.get(address.key);
      if (!previous || request.priority > previous.priority) byKey.set(address.key, request);
    };

    let sourceTruncated = false;
    const visibleTiles = this.pyramid.tilesIntersectingNearest(level, clipped, maxRequests + 1);
    sourceTruncated ||= visibleTiles.truncated;
    for (const tile of visibleTiles.tiles) add(tile, "visible");

    const tileSpan = this.pyramid.tileSize * 2 ** level;
    const expanded = {
      x: clipped.x - prefetchMarginTiles * tileSpan,
      y: clipped.y - prefetchMarginTiles * tileSpan,
      width: clipped.width + prefetchMarginTiles * tileSpan * 2,
      height: clipped.height + prefetchMarginTiles * tileSpan * 2,
    };
    const prefetchTiles = this.pyramid.tilesIntersectingNearest(level, expanded, maxRequests + 1);
    sourceTruncated ||= prefetchTiles.truncated;
    for (const tile of prefetchTiles.tiles) {
      if (!byKey.has(tile.key)) add(tile, "prefetch");
    }

    const lastFallbackLevel = Math.min(this.pyramid.maxLevel, level + fallbackLevels);
    for (let fallbackLevel = level + 1; fallbackLevel <= lastFallbackLevel; fallbackLevel += 1) {
      const fallbackTiles = this.pyramid.tilesIntersectingNearest(fallbackLevel, clipped, maxRequests + 1);
      sourceTruncated ||= fallbackTiles.truncated;
      for (const tile of fallbackTiles.tiles) add(tile, "fallback");
    }

    const allRequests = [...byKey.values()].sort(compareRequests);
    const requests = allRequests.slice(0, maxRequests);
    let fallbackTileCount = 0;
    let prefetchTileCount = 0;
    let visibleTileCount = 0;
    for (const request of requests) {
      if (request.reason === "visible") visibleTileCount += 1;
      else if (request.reason === "fallback") fallbackTileCount += 1;
      else prefetchTileCount += 1;
    }
    return {
      level,
      viewport: clipped,
      requests,
      visibleTileCount,
      fallbackTileCount,
      prefetchTileCount,
      truncated: sourceTruncated || requests.length < allRequests.length,
    };
  }
}

export type DirtyPyramidTile = {
  key: VirtualTileKey;
  address: VirtualTileAddress;
  revision: number;
};

/** Propagates full-resolution edit regions to every dependent mip level. */
export class PyramidDirtyTracker {
  private readonly dirty = new Map<VirtualTileKey, DirtyPyramidTile>();
  private readonly wholeLevelRevisions = new Map<number, number>();
  private revision = 0;

  constructor(
    readonly pyramid: VirtualCanvasPyramid,
    readonly maxTrackedTilesPerLevel = 65_536,
  ) {
    assertFiniteInteger(maxTrackedTilesPerLevel, "maxTrackedTilesPerLevel", 1, 1_000_000);
  }

  invalidate(documentRect: PixelRect, borderPixels = 0) {
    if (!Number.isFinite(borderPixels) || borderPixels < 0) {
      throw new Error("borderPixels must be a non-negative finite number");
    }
    const expanded = {
      x: documentRect.x - borderPixels,
      y: documentRect.y - borderPixels,
      width: documentRect.width + borderPixels * 2,
      height: documentRect.height + borderPixels * 2,
    };
    this.revision += 1;
    let touched = 0;
    const broadLevels: number[] = [];
    for (let level = 0; level <= this.pyramid.maxLevel; level += 1) {
      const range = this.pyramid.tileRangeIntersecting(level, expanded);
      if (!range) continue;
      if (range.totalTiles > this.maxTrackedTilesPerLevel) {
        this.wholeLevelRevisions.set(level, this.revision);
        broadLevels.push(level);
        for (const entry of this.dirty.values()) {
          if (entry.address.level === level) this.dirty.delete(entry.key);
        }
        continue;
      }
      for (const address of this.pyramid.tilesIntersecting(level, expanded)) {
        this.dirty.set(address.key, { key: address.key, address, revision: this.revision });
        touched += 1;
      }
    }
    return { revision: this.revision, touched, broadLevels };
  }

  /** Constant-memory invalidation used by full-document transforms and mode changes. */
  invalidateAll() {
    this.revision += 1;
    this.dirty.clear();
    for (let level = 0; level <= this.pyramid.maxLevel; level += 1) {
      this.wholeLevelRevisions.set(level, this.revision);
    }
    return this.revision;
  }

  invalidateTile(key: string, borderPixels = 0) {
    return this.invalidate(this.pyramid.parseKey(key).documentRect, borderPixels);
  }

  peek(level?: number) {
    if (level !== undefined) this.pyramid.level(level);
    return [...this.dirty.values()]
      .filter((entry) => level === undefined || entry.address.level === level)
      .sort((a, b) => a.address.level - b.address.level ||
        a.address.row - b.address.row || a.address.column - b.address.column);
  }

  drain(level?: number) {
    const result = this.peek(level);
    for (const entry of result) this.dirty.delete(entry.key);
    return result;
  }

  /** Revision a cached tile must have been built against to remain valid. */
  revisionFor(key: string) {
    const address = this.pyramid.parseKey(key);
    return Math.max(
      this.wholeLevelRevisions.get(address.level) ?? 0,
      this.dirty.get(address.key)?.revision ?? 0,
    );
  }

  stats() {
    const byLevel: Record<number, number> = {};
    for (const entry of this.dirty.values()) {
      byLevel[entry.address.level] = (byLevel[entry.address.level] ?? 0) + 1;
    }
    return {
      revision: this.revision,
      dirtyTiles: this.dirty.size,
      byLevel,
      broadLevels: Object.fromEntries(
        [...this.wholeLevelRevisions.entries()].sort(([a], [b]) => a - b),
      ) as Record<number, number>,
    };
  }
}
