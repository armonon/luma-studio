import { Layer } from "./document";
import { SparseAlphaSurface } from "./alpha-surface";
import { alphaSurfaceFromCanvas, alphaSurfaceRegionCanvas } from "./selection";
import type { PixelRect } from "./tile-store";

export function hasLayerMask(layer: Pick<Layer, "mask" | "maskSurface">) {
  return Boolean(layer.maskSurface || layer.mask);
}

export function layerMaskSurface(
  layer: Layer,
  documentWidth: number,
  documentHeight: number,
  create = false,
) {
  if (!layer.maskSurface && layer.mask) {
    layer.maskSurface = alphaSurfaceFromCanvas(layer.mask, documentWidth, documentHeight);
    layer.mask = undefined;
  }
  if (!layer.maskSurface && create) {
    // Photoshop layer masks start as Reveal All. A uniform reveal-all mask is
    // represented by the default byte and consumes no resident tiles.
    layer.maskSurface = new SparseAlphaSurface(documentWidth, documentHeight, { defaultAlpha: 255 });
  }
  return layer.maskSurface ?? null;
}

export function layerMaskRegionCanvas(
  layer: Layer,
  documentWidth: number,
  documentHeight: number,
  rect: PixelRect,
) {
  const surface = layerMaskSurface(layer, documentWidth, documentHeight);
  return surface ? alphaSurfaceRegionCanvas(surface, rect) : null;
}

export function removeLayerMask(layer: Layer) {
  const existed = hasLayerMask(layer);
  layer.mask = undefined;
  layer.maskSurface = undefined;
  return existed;
}

export function setLayerMaskFromCanvas(
  layer: Layer,
  mask: HTMLCanvasElement,
  documentWidth: number,
  documentHeight: number,
  offsetX = 0,
  offsetY = 0,
  defaultAlpha = 0,
) {
  const surface = new SparseAlphaSurface(documentWidth, documentHeight, { defaultAlpha });
  for (const address of surface.grid.tilesIntersecting({
    x: offsetX,
    y: offsetY,
    width: mask.width,
    height: mask.height,
  })) {
    const left = Math.max(address.x, offsetX);
    const top = Math.max(address.y, offsetY);
    const right = Math.min(address.x + address.width, offsetX + mask.width);
    const bottom = Math.min(address.y + address.height, offsetY + mask.height);
    const width = right - left;
    const height = bottom - top;
    if (width <= 0 || height <= 0) continue;
    const image = mask.getContext("2d")!.getImageData(left - offsetX, top - offsetY, width, height).data;
    const alpha = surface.readTile(address.key);
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      alpha[(top - address.y + y) * address.width + left - address.x + x] = image[(y * width + x) * 4 + 3];
    }
    surface.writeTile(address.key, alpha);
  }
  layer.mask = undefined;
  layer.maskSurface = surface;
  return surface;
}
