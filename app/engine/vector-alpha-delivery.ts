import { newCanvas, type Layer } from "./document";
import { TileGrid, type PixelRect } from "./tile-store";

/** Output admission is aggregate across the document, not one allowance per mask. */
export const VECTOR_ALPHA_LIMITS = { records: 4096, bytes: 16 * 1024 * 1024, tileEdge: 256, encodedCharacters: 64 * 1024 * 1024 } as const;
export type AlphaDelivery = {
  width: number; height: number; defaultAlpha: number; records: number; bytes: number;
  tiles: () => Generator<PixelRect & { alpha: number | Uint8Array }>;
};

/** Read only: do not migrate legacy masks or expand sparse reveal-all surfaces. */
export function planAlphaDelivery(layer: Layer, width: number, height: number): AlphaDelivery | undefined {
  const surface = layer.maskSurface;
  if (surface) {
    const stats = surface.stats();
    if (surface.width !== width || surface.height !== height) throw new Error("Mask dimensions do not match the document");
    if (stats.residentTiles > VECTOR_ALPHA_LIMITS.records || stats.residentBytes > VECTOR_ALPHA_LIMITS.bytes || surface.tileSize > VECTOR_ALPHA_LIMITS.tileEdge) throw new Error("Mask exceeds bounded vector-delivery tile storage (4,096 records, 16 MiB, 256px tiles)");
    const keys = surface.keys(), revision = surface.revision;
    return { width, height, defaultAlpha: surface.defaultAlpha, records: keys.length, bytes: stats.residentBytes,
      *tiles() {
        for (const key of keys) {
          if (surface.revision !== revision) throw new Error("Mask changed during vector delivery");
          const alpha = surface.record(key);
          if (alpha !== null) yield { ...surface.grid.parseKey(key), alpha };
        }
      } };
  }
  const mask = layer.mask;
  if (!mask) return undefined;
  if (mask.width !== width || mask.height !== height) throw new Error("Mask dimensions do not match the document");
  const grid = new TileGrid(width, height, VECTOR_ALPHA_LIMITS.tileEdge);
  if (grid.totalTiles > VECTOR_ALPHA_LIMITS.records || width * height > VECTOR_ALPHA_LIMITS.bytes) throw new Error("Legacy mask exceeds bounded vector-delivery storage; use a sparse mask or a separate raster delivery copy");
  return { width, height, defaultAlpha: 0, records: grid.totalTiles, bytes: width * height,
    *tiles() {
      const context = mask.getContext("2d"); if (!context) throw new Error("Mask pixels are unavailable");
      for (let row = 0; row < grid.rows; row++) for (let col = 0; col < grid.columns; col++) {
        const tile = grid.address(col, row), rgba = context.getImageData(tile.x, tile.y, tile.width, tile.height).data;
        const alpha = new Uint8Array(tile.width * tile.height); let uniform = true;
        for (let i = 0; i < alpha.length; i++) { alpha[i] = rgba[i * 4 + 3]; if (alpha[i] !== rgba[3]) uniform = false; }
        yield { ...tile, alpha: uniform ? alpha[0] : alpha };
      }
    } };
}

/** Opaque grayscale encodes alpha as luminance, so a zero tile REPLACES a white default. */
export function alphaTilePng(tile: PixelRect & { alpha: Uint8Array }) {
  const canvas = newCanvas(tile.width, tile.height);
  try {
    const context = canvas.getContext("2d")!, pixels = context.createImageData(tile.width, tile.height);
    for (let i = 0; i < tile.alpha.length; i++) {
      pixels.data[4*i] = pixels.data[4*i+1] = pixels.data[4*i+2] = tile.alpha[i]; pixels.data[4*i+3] = 255;
    }
    context.putImageData(pixels, 0, 0);
    return canvas.toDataURL("image/png");
  } finally { canvas.width = 1; canvas.height = 1; }
}
