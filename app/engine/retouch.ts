import {
  brushDabOpacityAt,
  parseBrushColor,
  type BrushDab,
  type BrushParams,
  type FloatRgbaSurface,
} from "./brush";

export type RetouchMode =
  | "clone"
  | "heal"
  | "spot-heal"
  | "patch"
  | "remove"
  | "dodge"
  | "burn"
  | "blur"
  | "sharpen"
  | "smudge"
  | "sponge"
  | "mixer"
  | "liquify";

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
  if ((operation.mode === "clone" || operation.mode === "heal" || operation.mode === "patch") && !operation.sample) {
    throw new Error(`${operation.mode} retouch requires a source sampler`);
  }
  const sampleLocal: RetouchSample = (documentX, documentY) => {
    const localX = Math.max(0, Math.min(surface.width - 1, documentX - (surface.originX ?? 0) - 0.5));
    const localY = Math.max(0, Math.min(surface.height - 1, documentY - (surface.originY ?? 0) - 0.5));
    const x0 = Math.floor(localX);
    const y0 = Math.floor(localY);
    const x1 = Math.min(surface.width - 1, x0 + 1);
    const y1 = Math.min(surface.height - 1, y0 + 1);
    const fx = localX - x0;
    const fy = localY - y0;
    const result = [0, 0, 0, 0];
    for (let channel = 0; channel < 4; channel += 1) {
      const top = surface.data[(y0 * surface.width + x0) * 4 + channel] * (1 - fx)
        + surface.data[(y0 * surface.width + x1) * 4 + channel] * fx;
      const bottom = surface.data[(y1 * surface.width + x0) * 4 + channel] * (1 - fx)
        + surface.data[(y1 * surface.width + x1) * 4 + channel] * fx;
      result[channel] = top * (1 - fy) + bottom * fy;
    }
    return result as [number, number, number, number];
  };
  const sample = operation.sample ?? sampleLocal;
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
  const brushColor = parseBrushColor(operation.params.color);
  const sampledAround = (x: number, y: number, radius: number) => {
    const points = [
      sample(x - radius, y), sample(x + radius, y), sample(x, y - radius), sample(x, y + radius),
      sample(x - radius * 0.7, y - radius * 0.7), sample(x + radius * 0.7, y - radius * 0.7),
      sample(x - radius * 0.7, y + radius * 0.7), sample(x + radius * 0.7, y + radius * 0.7),
    ];
    return [0, 1, 2, 3].map((channel) => points.reduce((sum, point) => sum + point[channel], 0) / points.length);
  };
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
    } else if (operation.mode === "blur" || operation.mode === "sharpen" || operation.mode === "spot-heal" || operation.mode === "remove") {
      const average = sampledAround(x, y, operation.mode === "remove" ? 12 : 3);
      source = operation.mode === "sharpen"
        ? destination.map((channel, index) => channel + (channel - average[index]) * (0.5 + strength))
        : average;
    } else if (operation.mode === "smudge" || operation.mode === "liquify") {
      source = sample(
        x + (operation.sourceOffsetX ?? 0) * (operation.mode === "liquify" ? 1.5 : 1),
        y + (operation.sourceOffsetY ?? 0) * (operation.mode === "liquify" ? 1.5 : 1),
      );
    } else if (operation.mode === "sponge") {
      const gray = luma(destination);
      source = destination.map((channel) => gray + (channel - gray) * (1 + strength * 1.5));
    } else if (operation.mode === "mixer") {
      source = [brushColor[0] / 255, brushColor[1] / 255, brushColor[2] / 255];
    } else {
      const sampled = sample(
        x + (operation.sourceOffsetX ?? 0),
        y + (operation.sourceOffsetY ?? 0),
      );
      if (operation.mode === "heal" || operation.mode === "patch") {
        const correction = (luma(destination) - luma(sampled)) * 0.65;
        source = [sampled[0] + correction, sampled[1] + correction, sampled[2] + correction];
      } else {
        source = sampled;
      }
    }
    for (let channel = 0; channel < 3; channel += 1) {
      surface.data[offset + channel] = destination[channel] * (1 - amount) + source[channel] * amount;
    }
    if (["clone", "heal", "patch", "spot-heal", "remove", "smudge", "liquify"].includes(operation.mode)) {
      const sampledAlpha = sample(
        x + (operation.sourceOffsetX ?? 0),
        y + (operation.sourceOffsetY ?? 0),
      )[3];
      surface.data[offset + 3] = clamp01(surface.data[offset + 3] * (1 - amount) + sampledAlpha * amount);
    }
  }
  return { affectedPixels };
}
