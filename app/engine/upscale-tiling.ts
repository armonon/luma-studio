// Pure tiling math for on-device Upscale. Kept free of canvas/ONNX so it can
// run (and be tested) in plain Node: given an image size, a tile size and an
// overlap, it plans a grid of overlapping source crops to feed the model and
// the non-overlapping destination rect each crop's centre contributes to the
// final upscaled image. Tiling exists so a 20-megapixel photo doesn't have to
// go through the model in one shot and blow the tab's memory budget.

export type Rect = { x: number; y: number; width: number; height: number };

export type UpscaleTilePlan = {
  /** Index of this tile, in row-major order — stable, useful for progress text. */
  index: number;
  /** Source pixel rect to crop and feed the model, padded by the overlap and clamped to the image. */
  source: Rect;
  /** Where this tile's kept (non-overlapping) contribution lands in the final upscaled image. */
  dest: Rect;
  /** Offset inside the tile's scaled model output where the kept region begins. */
  trim: { x: number; y: number };
};

/**
 * Plan a grid of overlapping tiles covering a `width`×`height` source image
 * for a model that scales every pixel by `scale`. `tileSize` and `overlap`
 * are measured in source pixels. The overlap is fed to the model (so the
 * model sees context past the tile's own edge and the seam doesn't band) but
 * trimmed back out before the tile's output is pasted into the final image,
 * so `dest` rects exactly tile the output with no gaps or double-painted
 * pixels.
 */
export function planUpscaleTiles(
  width: number,
  height: number,
  scale: number,
  tileSize = 256,
  overlap = 16,
): UpscaleTilePlan[] {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw new Error("Upscale tiling requires a positive image size");
  }
  if (!Number.isInteger(scale) || scale < 1 || scale > 8) {
    throw new Error("Upscale scale must be an integer between 1 and 8");
  }
  if (!Number.isInteger(tileSize) || tileSize < 32) {
    throw new Error("Upscale tile size must be an integer of at least 32 pixels");
  }
  if (!Number.isInteger(overlap) || overlap < 0 || overlap * 2 >= tileSize) {
    throw new Error("Upscale overlap must be a non-negative integer smaller than half the tile size");
  }

  const plans: UpscaleTilePlan[] = [];
  let index = 0;
  for (let y = 0; y < height; y += tileSize) {
    const keepHeight = Math.min(tileSize, height - y);
    for (let x = 0; x < width; x += tileSize) {
      const keepWidth = Math.min(tileSize, width - x);
      const sx = Math.max(0, x - overlap);
      const sy = Math.max(0, y - overlap);
      const ex = Math.min(width, x + keepWidth + overlap);
      const ey = Math.min(height, y + keepHeight + overlap);
      plans.push({
        index: index++,
        source: { x: sx, y: sy, width: ex - sx, height: ey - sy },
        dest: { x: x * scale, y: y * scale, width: keepWidth * scale, height: keepHeight * scale },
        trim: { x: (x - sx) * scale, y: (y - sy) * scale },
      });
    }
  }
  return plans;
}

/** A single tile's model output is too small to contain its own trim+dest window. */
export function validateTileOutput(plan: UpscaleTilePlan, outputWidth: number, outputHeight: number): boolean {
  return (
    plan.trim.x >= 0 && plan.trim.y >= 0 &&
    plan.trim.x + plan.dest.width <= outputWidth &&
    plan.trim.y + plan.dest.height <= outputHeight
  );
}
