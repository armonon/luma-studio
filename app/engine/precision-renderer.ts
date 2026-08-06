import { Layer, drawLayerContent, newCanvas } from "./document";
import { PrecisionTileSurface } from "./tile-store";

type PreviewEntry = {
  revision: number;
  canvas: HTMLCanvasElement;
  lastUsed: number;
};

type SurfacePreviewCache = {
  tiles: Map<string, PreviewEntry>;
};

const MAX_PREVIEW_TILES_PER_SURFACE = 96;
const surfaceCaches = new WeakMap<PrecisionTileSurface, SurfacePreviewCache>();
let clock = 0;
let previewHits = 0;
let previewMisses = 0;
let previewEvictions = 0;

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
  cache.tiles.set(key, { revision, canvas, lastUsed: clock });

  if (cache.tiles.size > MAX_PREVIEW_TILES_PER_SURFACE) {
    let oldestKey = "";
    let oldestUse = Infinity;
    for (const [candidateKey, entry] of cache.tiles) {
      if (candidateKey === key || entry.lastUsed >= oldestUse) continue;
      oldestKey = candidateKey;
      oldestUse = entry.lastUsed;
    }
    if (oldestKey) {
      cache.tiles.delete(oldestKey);
      previewEvictions += 1;
    }
  }
  return canvas;
}

/** Draw raster masters tile-by-tile; vector layers retain their native path. */
export function drawLayerContentManaged(ctx: CanvasRenderingContext2D, layer: Layer) {
  if ((layer.kind !== "raster" && layer.kind !== "smart-object") || !layer.surface) {
    drawLayerContent(ctx, layer);
    return;
  }
  const t = layer.transform;
  const cos = Math.cos(t.rotation);
  const sin = Math.sin(t.rotation);
  ctx.save();
  ctx.setTransform(cos * t.sx, sin * t.sx, -sin * t.sy, cos * t.sy, t.tx, t.ty);
  for (const { key } of layer.surface.store.entries()) {
    const address = layer.surface.grid.parseKey(key);
    ctx.drawImage(previewTile(layer.surface, key), address.x, address.y);
  }
  ctx.restore();
}

export function precisionPreviewCacheStats() {
  return { hits: previewHits, misses: previewMisses, evictions: previewEvictions, maxTilesPerSurface: MAX_PREVIEW_TILES_PER_SURFACE };
}
