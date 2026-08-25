// Pure per-layer mask mutations. Each returns whether it did anything; the
// caller (Studio) handles snapshotting and history commit around these.

import { Layer } from "./document";
import { hasLayerMask, layerMaskSurface } from "./layer-mask";
import { SparseAlphaSurface } from "./alpha-surface";
import { featherAlphaSurface } from "./selection";

/** Invert the alpha channel of the layer's mask in place. Allocates the mask
 *  if the layer doesn't have one yet. Returns the mask canvas. */
export function invertMaskInPlace(
  layer: Layer,
  docWidth: number,
  docHeight: number,
): SparseAlphaSurface {
  const mask = layerMaskSurface(layer, docWidth, docHeight, true)!;
  layer.maskSurface = mask.inverted();
  return layer.maskSurface;
}

/** Reset the layer's mask to fully opaque black (reveal all). No-op if the
 *  layer has no mask. */
export function clearMaskInPlace(
  layer: Layer,
  docWidth: number,
  docHeight: number,
): SparseAlphaSurface | null {
  if (!hasLayerMask(layer)) return null;
  const mask = layerMaskSurface(layer, docWidth, docHeight)!;
  mask.reset(255);
  return mask;
}

export function featherMaskInPlace(
  layer: Layer,
  docWidth: number,
  docHeight: number,
  radius: number,
) {
  const mask = layerMaskSurface(layer, docWidth, docHeight, true)!;
  layer.maskSurface = featherAlphaSurface(mask, mask.bounds(), radius);
  return layer.maskSurface;
}

/** Fast luma-threshold subject mask. Computes mean luminance and builds a soft
 *  step around it. Cheap, deterministic, and honest — the "AI" moniker belongs
 *  to the neural version; this is a plain image-processing fallback. */
export function autoLumaMaskInPlace(
  layer: Layer,
  docWidth: number,
  docHeight: number,
): SparseAlphaSurface | null {
  if (layer.kind !== "raster" || !layer.bitmap) return null;
  const src = layer.bitmap.getContext("2d")!;
  let sum = 0;
  let pixels = 0;
  const surface = new SparseAlphaSurface(docWidth, docHeight);
  const imageWidth = Math.min(docWidth, layer.bitmap.width);
  const imageHeight = Math.min(docHeight, layer.bitmap.height);
  for (const address of surface.grid.tilesIntersecting({ x: 0, y: 0, width: imageWidth, height: imageHeight })) {
    const width = Math.min(address.width, imageWidth - address.x);
    const height = Math.min(address.height, imageHeight - address.y);
    if (width <= 0 || height <= 0) continue;
    const data = src.getImageData(address.x, address.y, width, height).data;
    for (let i = 0; i < data.length; i += 4) {
      sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      pixels += 1;
    }
  }
  if (!pixels) return null;
  const mean = sum / pixels;
  for (const address of surface.grid.tilesIntersecting({ x: 0, y: 0, width: imageWidth, height: imageHeight })) {
    const width = Math.min(address.width, imageWidth - address.x);
    const height = Math.min(address.height, imageHeight - address.y);
    if (width <= 0 || height <= 0) continue;
    const data = src.getImageData(address.x, address.y, width, height).data;
    const alpha = surface.readTile(address.key);
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const sourceOffset = (y * width + x) * 4;
      const luma = 0.2126 * data[sourceOffset] + 0.7152 * data[sourceOffset + 1] + 0.0722 * data[sourceOffset + 2];
      const t = Math.max(0, Math.min(1, (luma - (mean - 40)) / 80));
      alpha[y * address.width + x] = Math.round(t * 255);
    }
    surface.writeTile(address.key, alpha);
  }
  layer.mask = undefined;
  layer.maskSurface = surface;
  return surface;
}
