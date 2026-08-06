import {
  brushDabOpacityAt,
  type BrushDab,
  type BrushParams,
  type FloatRgbaSurface,
} from "./brush";

export type RetouchMode = "clone" | "heal" | "dodge" | "burn";

export type RetouchSample = (x: number, y: number) => readonly [number, number, number, number];

export type RetouchOperation = {
  mode: RetouchMode;
  dabs: ReadonlyArray<BrushDab>;
  params: BrushParams;
  sourceOffsetX?: number;
  sourceOffsetY?: number;
  sample?: RetouchSample;
  strength?: number;
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const luma = (rgb: readonly number[]) => 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];

/**
 * Tile-local, float-native clone/heal/dodge/burn replay. Sampling coordinates
 * remain in full document space, so the same stroke produces identical pixels
 * regardless of tile boundaries.
 */
export function replayRetouch(surface: FloatRgbaSurface, operation: RetouchOperation) {
  if (surface.data.length !== surface.width * surface.height * 4) {
    throw new Error("Retouch surface payload does not match its dimensions");
  }
  if ((operation.mode === "clone" || operation.mode === "heal") && !operation.sample) {
    throw new Error(`${operation.mode} retouch requires a source sampler`);
  }
  const coverage = new Float32Array(surface.width * surface.height);
  for (const dab of operation.dabs) {
    const radius = dab.size / 2 + 1;
    const left = Math.max(0, Math.floor(dab.x - (surface.originX ?? 0) - radius));
    const top = Math.max(0, Math.floor(dab.y - (surface.originY ?? 0) - radius));
    const right = Math.min(surface.width, Math.ceil(dab.x - (surface.originX ?? 0) + radius));
    const bottom = Math.min(surface.height, Math.ceil(dab.y - (surface.originY ?? 0) + radius));
    for (let y = top; y < bottom; y += 1) {
      for (let x = left; x < right; x += 1) {
        const documentX = x + (surface.originX ?? 0) + 0.5;
        const documentY = y + (surface.originY ?? 0) + 0.5;
        const alpha = brushDabOpacityAt(dab, documentX, documentY, operation.params);
        const index = y * surface.width + x;
        coverage[index] = operation.params.buildUp === false
          ? Math.max(coverage[index], alpha)
          : 1 - (1 - coverage[index]) * (1 - alpha);
      }
    }
  }

  const finalOpacity = operation.params.flow === undefined ? 1 : clamp01(operation.params.opacity);
  const strength = clamp01(operation.strength ?? 0.25);
  let affectedPixels = 0;
  for (let pixel = 0; pixel < coverage.length; pixel += 1) {
    const amount = clamp01(coverage[pixel] * finalOpacity);
    if (amount <= 0) continue;
    affectedPixels += 1;
    const offset = pixel * 4;
    const x = pixel % surface.width + (surface.originX ?? 0) + 0.5;
    const y = Math.floor(pixel / surface.width) + (surface.originY ?? 0) + 0.5;
    const destination = [
      surface.data[offset],
      surface.data[offset + 1],
      surface.data[offset + 2],
    ];
    let source: readonly number[];
    if (operation.mode === "dodge" || operation.mode === "burn") {
      const exposure = operation.mode === "dodge" ? 1 + strength : 1 / (1 + strength);
      source = destination.map((channel) => channel * exposure);
    } else {
      const sampled = operation.sample!(
        x + (operation.sourceOffsetX ?? 0),
        y + (operation.sourceOffsetY ?? 0),
      );
      if (operation.mode === "heal") {
        const correction = (luma(destination) - luma(sampled)) * 0.65;
        source = [sampled[0] + correction, sampled[1] + correction, sampled[2] + correction];
      } else {
        source = sampled;
      }
    }
    for (let channel = 0; channel < 3; channel += 1) {
      surface.data[offset + channel] = destination[channel] * (1 - amount) + source[channel] * amount;
    }
    if (operation.mode === "clone" || operation.mode === "heal") {
      const sampledAlpha = operation.sample!(
        x + (operation.sourceOffsetX ?? 0),
        y + (operation.sourceOffsetY ?? 0),
      )[3];
      surface.data[offset + 3] = clamp01(surface.data[offset + 3] * (1 - amount) + sampledAlpha * amount);
    }
  }
  return { affectedPixels };
}
