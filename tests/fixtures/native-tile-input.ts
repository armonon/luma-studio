import type { NativeTileRequest } from "../../app/engine/native-core.ts";

/**
 * The document encoded into `native-tile.bin`. Two pixels, two layers, chosen
 * so the result differs per pixel and exercises a non-trivial blend mode,
 * fractional opacity, and the bottom-up ordering (index 0 is topmost).
 */
export const NATIVE_TILE_FIXTURE: NativeTileRequest = {
  width: 2,
  height: 1,
  layers: [
    {
      // Top: 50% grey/white at half opacity, multiplied.
      mode: "multiply",
      opacity: 0.5,
      pixels: new Float32Array([0.5, 0.5, 0.5, 1, 1, 1, 1, 1]),
    },
    {
      // Bottom: opaque red, then opaque blue.
      mode: "source-over",
      opacity: 1,
      pixels: new Float32Array([1, 0, 0, 1, 0, 0, 1, 1]),
    },
  ],
};

/**
 * Expected composite, derived by hand from the Porter-Duff + multiply maths:
 *   px0: base (1,0,0) x src (0.5,0.5,0.5) -> blended (0.5,0,0)
 *        out = 0.5*base + 0.5*blended = (0.75, 0, 0)
 *   px1: base (0,0,1) x src (1,1,1)     -> blended (0,0,1)
 *        out = 0.5*base + 0.5*blended = (0, 0, 1)
 */
export const NATIVE_TILE_EXPECTED = [0.75, 0, 0, 1, 0, 0, 1, 1];
