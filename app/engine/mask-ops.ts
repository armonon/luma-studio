// Pure per-layer mask mutations. Each returns whether it did anything; the
// caller (Studio) handles snapshotting and history commit around these.

import { Layer, ensureMask } from "./document";
import { bumpBitmapVersion } from "./gl-renderer";

/** Invert the alpha channel of the layer's mask in place. Allocates the mask
 *  if the layer doesn't have one yet. Returns the mask canvas. */
export function invertMaskInPlace(
  layer: Layer,
  docWidth: number,
  docHeight: number,
): HTMLCanvasElement {
  ensureMask(layer, docWidth, docHeight);
  const mask = layer.mask!;
  const ctx = mask.getContext("2d")!;
  const img = ctx.getImageData(0, 0, mask.width, mask.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) d[i + 3] = 255 - d[i + 3];
  ctx.putImageData(img, 0, 0);
  bumpBitmapVersion(mask);
  return mask;
}

/** Reset the layer's mask to fully opaque black (reveal all). No-op if the
 *  layer has no mask. */
export function clearMaskInPlace(
  layer: Layer,
  docWidth: number,
  docHeight: number,
): HTMLCanvasElement | null {
  if (!layer.mask) return null;
  const ctx = layer.mask.getContext("2d")!;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "rgba(0,0,0,1)";
  ctx.fillRect(0, 0, docWidth, docHeight);
  ctx.restore();
  bumpBitmapVersion(layer.mask);
  return layer.mask;
}

/** Fast luma-threshold subject mask. Computes mean luminance and builds a soft
 *  step around it. Cheap, deterministic, and honest — the "AI" moniker belongs
 *  to the neural version; this is a plain image-processing fallback. */
export function autoLumaMaskInPlace(
  layer: Layer,
  docWidth: number,
  docHeight: number,
): HTMLCanvasElement | null {
  if (layer.kind !== "raster" || !layer.bitmap) return null;
  ensureMask(layer, docWidth, docHeight);
  const src = layer.bitmap.getContext("2d")!;
  const img = src.getImageData(0, 0, layer.bitmap.width, layer.bitmap.height);
  const d = img.data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) {
    sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
  }
  const mean = sum / (d.length / 4);
  const mask = layer.mask!;
  const mctx = mask.getContext("2d")!;
  const mimg = mctx.createImageData(mask.width, mask.height);
  const m = mimg.data;
  for (let i = 0, j = 0; i < d.length; i += 4, j += 4) {
    const luma = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    const t = Math.max(0, Math.min(1, (luma - (mean - 40)) / 80));
    m[j] = 255;
    m[j + 1] = 255;
    m[j + 2] = 255;
    m[j + 3] = Math.round(t * 255);
  }
  mctx.putImageData(mimg, 0, 0);
  bumpBitmapVersion(mask);
  return mask;
}
