import { Layer, drawLayerContent, newCanvas, affineForLayerTransform } from "./document";
import { PrecisionTileSurface } from "./tile-store";

type PreviewEntry = {
  revision: number;
  canvas: HTMLCanvasElement;
  lastUsed: number;
  bytes: number;
  owner: WeakRef<SurfacePreviewCache>;
  key: string;
};

type SurfacePreviewCache = {
  tiles: Map<string, PreviewEntry>;
};

const MAX_PREVIEW_TILES_PER_SURFACE = 96;
const MAX_PREVIEW_BYTES = 32 * 1024 * 1024;
const residentPreviews = new Set<PreviewEntry>();
let residentPreviewBytes = 0;
const surfaceCaches = new WeakMap<PrecisionTileSurface, SurfacePreviewCache>();
let clock = 0;
let previewHits = 0;
let previewMisses = 0;
let previewEvictions = 0;

function evict(entry: PreviewEntry) {
  entry.owner.deref()?.tiles.delete(entry.key);
  residentPreviews.delete(entry);
  residentPreviewBytes -= entry.bytes;
  entry.canvas.width = 1; entry.canvas.height = 1;
  previewEvictions += 1;
}

function previewTile(surface: PrecisionTileSurface, key: string) {
  let cache = surfaceCaches.get(surface);
  if (!cache) {
    cache = { tiles: new Map() };
    surfaceCaches.set(surface, cache);
  }
  const revision = surface.store.revisionFor(key);
  const existing = cache.tiles.get(key);
  clock += 1;
  if (existing?.revision === revision) {
    existing.lastUsed = clock;
    previewHits += 1;
    return existing.canvas;
  }
  previewMisses += 1;
  const pixels = surface.tileToRgba8(key);
  const canvas = existing?.canvas ?? newCanvas(pixels.width, pixels.height);
  if (canvas.width !== pixels.width) canvas.width = pixels.width;
  if (canvas.height !== pixels.height) canvas.height = pixels.height;
  const context = canvas.getContext("2d")!;
  const image = context.createImageData(pixels.width, pixels.height);
  image.data.set(pixels.data);
  context.putImageData(image, 0, 0);
  if (existing) { residentPreviews.delete(existing); residentPreviewBytes -= existing.bytes; }
  const next: PreviewEntry = { revision, canvas, lastUsed: clock, bytes: pixels.width * pixels.height * 4, owner: new WeakRef(cache), key };
  cache.tiles.set(key, next);
  residentPreviews.add(next); residentPreviewBytes += next.bytes;

  if (cache.tiles.size > MAX_PREVIEW_TILES_PER_SURFACE) {
    let oldestKey = "";
    let oldestUse = Infinity;
    for (const [candidateKey, entry] of cache.tiles) {
      if (candidateKey === key || entry.lastUsed >= oldestUse) continue;
      oldestKey = candidateKey;
      oldestUse = entry.lastUsed;
    }
    if (oldestKey) {
      evict(cache.tiles.get(oldestKey)!);
    }
  }
  while (residentPreviewBytes > MAX_PREVIEW_BYTES) {
    let oldest: PreviewEntry | undefined;
    for (const entry of residentPreviews) if (entry !== next && (!oldest || entry.lastUsed < oldest.lastUsed)) oldest = entry;
    if (!oldest) break;
    evict(oldest);
  }
  return canvas;
}

/** Draw raster masters tile-by-tile; vector layers retain their native path. */
export function drawLayerContentManaged(
  ctx: CanvasRenderingContext2D,
  layer: Layer,
  projection?: { a: number; b: number; c: number; d: number; e: number; f: number },
) {
  if ((layer.kind !== "raster" && layer.kind !== "smart-object") || !layer.surface) {
    drawLayerContent(ctx, layer, projection);
    return;
  }
  const t = layer.transform;
  ctx.save();
  const { a, b, c, d } = affineForLayerTransform(t);
  if (projection) {
    ctx.setTransform(
      projection.a * a + projection.c * b,
      projection.b * a + projection.d * b,
      projection.a * c + projection.c * d,
      projection.b * c + projection.d * d,
      projection.a * t.tx + projection.c * t.ty + projection.e,
      projection.b * t.tx + projection.d * t.ty + projection.f,
    );
  } else {
    ctx.setTransform(a, b, c, d, t.tx, t.ty);
  }
  const matrix = typeof ctx.getTransform === "function" ? ctx.getTransform() : null;
  for (const key of layer.surface.store.keys()) {
    const address = layer.surface.grid.parseKey(key);
    if (matrix) {
      const corners = [[address.x, address.y], [address.x + address.width, address.y], [address.x, address.y + address.height], [address.x + address.width, address.y + address.height]];
      const xs = corners.map(([x, y]) => matrix.a * x + matrix.c * y + matrix.e);
      const ys = corners.map(([x, y]) => matrix.b * x + matrix.d * y + matrix.f);
      if (Math.max(...xs) < -1 || Math.max(...ys) < -1 || Math.min(...xs) > ctx.canvas.width + 1 || Math.min(...ys) > ctx.canvas.height + 1) continue;
    }
    ctx.drawImage(previewTile(layer.surface, key), address.x, address.y);
  }
  ctx.restore();
}

export function precisionPreviewCacheStats() {
  return { hits: previewHits, misses: previewMisses, evictions: previewEvictions, maxTilesPerSurface: MAX_PREVIEW_TILES_PER_SURFACE, residentBytes: residentPreviewBytes, maxBytes: MAX_PREVIEW_BYTES };
}
