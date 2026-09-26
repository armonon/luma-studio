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
  repairOffsets?: ReadonlyArray<readonly [number, number] | null>;
};

/** Bounded local patch search. Compare the clean ring, then copy texture rather
 * than replacing every pixel with a neighborhood average. Computed once per
 * stroke replay and shared across tiles; never samples the edited destination. */
export function planRepairOffsets(dabs: ReadonlyArray<BrushDab>, sample: RetouchSample) {
  return dabs.map((dab): readonly [number, number] | null => {
    const radius = Math.max(2, dab.size * .65);
    const ring = [[-radius, 0], [radius, 0], [0, -radius], [0, radius]] as const;
    const target = ring.map(([x, y]) => sample(dab.x + x, dab.y + y));
    let best = Infinity;
    let offset: readonly [number, number] | null = null;
    for (const distance of [2.5, 4]) for (let direction = 0; direction < 8; direction++) {
      const angle = direction * Math.PI / 4;
      const dx = Math.round(Math.cos(angle) * radius * distance), dy = Math.round(Math.sin(angle) * radius * distance);
      if (sample(dab.x + dx, dab.y + dy)[3] < .95) continue;
      let score = 0;
      for (let i = 0; i < ring.length; i++) {
        const source = sample(dab.x + dx + ring[i][0], dab.y + dy + ring[i][1]);
        if (source[3] < .95) { score = Infinity; break; }
        for (let c = 0; c < 3; c++) score += (source[c] - target[i][c]) ** 2;
      }
      if (score < best) { best = score; offset = [dx, dy]; }
    }
    return offset;
  });
}

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
  // A local fallback must not start sampling pixels this replay already wrote.
  const original = operation.sample ? surface.data : surface.data.slice();
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
      const top = original[(y0 * surface.width + x0) * 4 + channel] * (1 - fx)
        + original[(y0 * surface.width + x1) * 4 + channel] * fx;
      const bottom = original[(y1 * surface.width + x0) * 4 + channel] * (1 - fx)
        + original[(y1 * surface.width + x1) * 4 + channel] * fx;
      result[channel] = top * (1 - fy) + bottom * fy;
    }
    return result as [number, number, number, number];
  };
  const sample = operation.sample ?? sampleLocal;
  const repair = operation.mode === "remove" || operation.mode === "spot-heal";
  const offsets = repair ? operation.repairOffsets ?? planRepairOffsets(operation.dabs, sample) : null;
  const owner = repair ? new Int32Array(surface.width * surface.height).fill(-1) : null;
  const ownerStrength = repair ? new Float32Array(surface.width * surface.height) : null;
  const coverage = new Float32Array(surface.width * surface.height);
  for (let dabIndex = 0; dabIndex < operation.dabs.length; dabIndex++) {
    const dab = operation.dabs[dabIndex];
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
        if (owner && ownerStrength && alpha > ownerStrength[index]) { owner[index] = dabIndex; ownerStrength[index] = alpha; }
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
    } else if (repair) {
      const offset = offsets?.[owner![pixel]];
      source = offset ? sample(x + offset[0], y + offset[1]) : sampledAround(x, y, Math.max(3, operation.params.size));
    } else if (operation.mode === "blur" || operation.mode === "sharpen") {
      const average = sampledAround(x, y, 3);
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
