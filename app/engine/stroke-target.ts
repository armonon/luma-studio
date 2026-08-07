import { Layer, ensureMask } from "./document";
import type { BrushParams } from "./brush";

// Picks the destination canvas for a stroke based on brush mode. Mask brushes
// paint into (and lazily allocate) the layer mask; every other mode paints
// into the raster bitmap. Returns null if the target doesn't exist and can't
// be created for this mode.
export function paintTarget(
  layer: Layer,
  params: BrushParams,
  width: number,
  height: number,
): HTMLCanvasElement | null {
  if (params.mode === "mask-add" || params.mode === "mask-remove") {
    return ensureMask(layer, width, height);
  }
  return layer.bitmap ?? null;
}
