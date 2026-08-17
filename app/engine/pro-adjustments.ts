export type ProAdjustmentKind =
  | "black-white"
  | "color-balance"
  | "photo-filter"
  | "channel-mixer"
  | "color-lookup"
  | "gradient-map"
  | "relight-field"
  | "threshold"
  | "posterize"
  | "invert";

export type RgbOffset = [number, number, number];
export type ChannelMixerMatrix = [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
];

export type ProAdjustmentParams =
  | { kind: "black-white"; amount: number; tint: string; tintAmount: number }
  | { kind: "color-balance"; shadows: RgbOffset; midtones: RgbOffset; highlights: RgbOffset; preserveLuminosity: boolean }
  | { kind: "photo-filter"; color: string; density: number; preserveLuminosity: boolean }
  | { kind: "channel-mixer"; matrix: ChannelMixerMatrix }
  | { kind: "color-lookup"; preset: "cinematic" | "teal-orange" | "film" | "chrome"; intensity: number }
  | { kind: "gradient-map"; shadow: string; highlight: string; reverse: boolean; smoothness: number }
  | { kind: "relight-field"; centerX: number; centerY: number; radius: number; intensity: number; angle: number; temperature: number; falloff: number }
  | { kind: "threshold"; level: number }
  | { kind: "posterize"; levels: number }
  | { kind: "invert" };

export const PRO_ADJUSTMENT_LABELS: Record<ProAdjustmentKind, string> = {
  "black-white": "Black & White",
  "color-balance": "Color Balance",
  "photo-filter": "Photo Filter",
  "channel-mixer": "Channel Mixer",
  "color-lookup": "Color Lookup",
  "gradient-map": "Gradient Map",
  "relight-field": "Relight Field",
  threshold: "Threshold",
  posterize: "Posterize",
  invert: "Invert",
};

export const PRO_ADJUSTMENT_KINDS = Object.keys(PRO_ADJUSTMENT_LABELS) as ProAdjustmentKind[];

export function defaultProAdjustment(kind: ProAdjustmentKind): ProAdjustmentParams {
  switch (kind) {
    case "black-white": return { kind, amount: 1, tint: "#d8b68b", tintAmount: 0 };
    case "color-balance": return { kind, shadows: [0, 0, 0], midtones: [0, 0, 0], highlights: [0, 0, 0], preserveLuminosity: true };
    case "photo-filter": return { kind, color: "#ec8a32", density: 0.25, preserveLuminosity: true };
    case "channel-mixer": return { kind, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0] };
    case "color-lookup": return { kind, preset: "cinematic", intensity: 0.65 };
    case "gradient-map": return { kind, shadow: "#0b1020", highlight: "#f3d6a4", reverse: false, smoothness: 1 };
    case "relight-field": return { kind, centerX: 0.5, centerY: 0.5, radius: 0.42, intensity: 0.65, angle: -35, temperature: 0.18, falloff: 1.8 };
    case "threshold": return { kind, level: 0.5 };
    case "posterize": return { kind, levels: 4 };
    case "invert": return { kind };
  }
}

export function cloneProAdjustment(params: ProAdjustmentParams): ProAdjustmentParams {
  switch (params.kind) {
    case "color-balance": return {
      ...params,
      shadows: [...params.shadows],
      midtones: [...params.midtones],
      highlights: [...params.highlights],
    };
    case "channel-mixer": return { ...params, matrix: [...params.matrix] };
    default: return { ...params };
  }
}

function clamp01(value: number) { return Math.max(0, Math.min(1, value)); }
function luma(r: number, g: number, b: number) { return r * 0.2126 + g * 0.7152 + b * 0.0722; }

function parseHex(color: string): [number, number, number] {
  const match = /^#([\da-f]{6})$/i.exec(color);
  if (!match) return [1, 1, 1];
  const value = Number.parseInt(match[1], 16);
  return [(value >> 16) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

function mix(a: number, b: number, amount: number) { return a + (b - a) * amount; }

function lookupColor(preset: Extract<ProAdjustmentParams, { kind: "color-lookup" }>["preset"], r: number, g: number, b: number) {
  switch (preset) {
    case "teal-orange": return [
      clamp01(r * 1.08 + g * 0.03 - b * 0.08),
      clamp01(g * 0.97 + b * 0.05),
      clamp01(b * 0.9 + (1 - r) * 0.08),
    ] as const;
    case "film": return [
      clamp01(Math.pow(r, 0.94) * 0.96 + 0.025),
      clamp01(Math.pow(g, 0.98) * 0.94 + 0.02),
      clamp01(Math.pow(b, 1.04) * 0.9 + 0.035),
    ] as const;
    case "chrome": return [
      clamp01((r - 0.5) * 1.28 + 0.5),
      clamp01((g - 0.5) * 1.2 + 0.5),
      clamp01((b - 0.5) * 1.3 + 0.5),
    ] as const;
    default: return [
      clamp01(r * 0.96 + b * 0.04),
      clamp01(g * 0.98 + r * 0.015),
      clamp01(b * 1.08 - r * 0.025),
    ] as const;
  }
}

/**
 * Apply a professional adjustment in-place. The function is deterministic,
 * alpha preserving and independent of canvas APIs, so tile and full-document
 * renders share the same math.
 */
export type ProAdjustmentSpatialContext = {
  originX: number;
  originY: number;
  scaleX: number;
  scaleY: number;
  documentWidth: number;
  documentHeight: number;
};

export function applyProAdjustmentToImageData(
  image: ImageData,
  params: ProAdjustmentParams,
  spatial?: ProAdjustmentSpatialContext,
) {
  const data = image.data;
  const tint = params.kind === "black-white" ? parseHex(params.tint)
    : params.kind === "photo-filter" ? parseHex(params.color)
    : params.kind === "gradient-map" ? [parseHex(params.shadow), parseHex(params.highlight)] as const
    : null;
  for (let offset = 0; offset < data.length; offset += 4) {
    let r = data[offset] / 255;
    let g = data[offset + 1] / 255;
    let b = data[offset + 2] / 255;
    const originalLuma = luma(r, g, b);

    switch (params.kind) {
      case "black-white": {
        const gray = originalLuma;
        const tinted = tint as [number, number, number];
        const tintAmount = clamp01(params.tintAmount);
        r = mix(r, mix(gray, tinted[0] * gray * 1.15, tintAmount), clamp01(params.amount));
        g = mix(g, mix(gray, tinted[1] * gray * 1.15, tintAmount), clamp01(params.amount));
        b = mix(b, mix(gray, tinted[2] * gray * 1.15, tintAmount), clamp01(params.amount));
        break;
      }
      case "color-balance": {
        const shadowWeight = Math.pow(1 - originalLuma, 2);
        const highlightWeight = Math.pow(originalLuma, 2);
        const midtoneWeight = Math.max(0, 1 - shadowWeight - highlightWeight);
        const channels = [r, g, b];
        for (let channel = 0; channel < 3; channel += 1) {
          channels[channel] = clamp01(channels[channel]
            + params.shadows[channel] * shadowWeight
            + params.midtones[channel] * midtoneWeight
            + params.highlights[channel] * highlightWeight);
        }
        [r, g, b] = channels;
        if (params.preserveLuminosity) {
          const delta = originalLuma - luma(r, g, b);
          r = clamp01(r + delta); g = clamp01(g + delta); b = clamp01(b + delta);
        }
        break;
      }
      case "photo-filter": {
        const filter = tint as [number, number, number];
        const density = clamp01(params.density);
        const filterLuma = Math.max(0.001, luma(filter[0], filter[1], filter[2]));
        const scale = params.preserveLuminosity ? 1 / filterLuma : 1;
        r = clamp01(mix(r, r * filter[0] * scale, density));
        g = clamp01(mix(g, g * filter[1] * scale, density));
        b = clamp01(mix(b, b * filter[2] * scale, density));
        break;
      }
      case "channel-mixer": {
        const matrix = params.matrix;
        [r, g, b] = [
          clamp01(matrix[0] * r + matrix[1] * g + matrix[2] * b + matrix[3]),
          clamp01(matrix[4] * r + matrix[5] * g + matrix[6] * b + matrix[7]),
          clamp01(matrix[8] * r + matrix[9] * g + matrix[10] * b + matrix[11]),
        ];
        break;
      }
      case "color-lookup": {
        const mapped = lookupColor(params.preset, r, g, b);
        const amount = clamp01(params.intensity);
        r = mix(r, mapped[0], amount); g = mix(g, mapped[1], amount); b = mix(b, mapped[2], amount);
        break;
      }
      case "gradient-map": {
        const [shadow, highlight] = tint as readonly [[number, number, number], [number, number, number]];
        let position = params.reverse ? 1 - originalLuma : originalLuma;
        const smoothness = clamp01(params.smoothness);
        position = mix(position, position * position * (3 - 2 * position), smoothness);
        r = mix(shadow[0], highlight[0], position);
        g = mix(shadow[1], highlight[1], position);
        b = mix(shadow[2], highlight[2], position);
        break;
      }
      case "relight-field": {
        if (!spatial) break;
        const pixel = offset / 4;
        const px = pixel % image.width;
        const py = Math.floor(pixel / image.width);
        const nx = (spatial.originX + (px + 0.5) / spatial.scaleX) / Math.max(1, spatial.documentWidth);
        const ny = (spatial.originY + (py + 0.5) / spatial.scaleY) / Math.max(1, spatial.documentHeight);
        const aspect = spatial.documentWidth / Math.max(1, spatial.documentHeight);
        const dx = (nx - clamp01(params.centerX)) * aspect;
        const dy = ny - clamp01(params.centerY);
        const radius = Math.max(0.01, params.radius);
        const distance = Math.hypot(dx, dy) / radius;
        const radial = Math.pow(clamp01(1 - distance), Math.max(0.2, params.falloff));
        const radians = params.angle * Math.PI / 180;
        const directional = clamp01(0.78 + (dx * Math.cos(radians) + dy * Math.sin(radians)) / radius * 0.22);
        const light = radial * directional * Math.max(-1, Math.min(1, params.intensity));
        const exposure = Math.pow(2, light * 1.65);
        const warmth = Math.max(-1, Math.min(1, params.temperature)) * radial;
        r = clamp01(r * exposure * (1 + warmth * 0.18));
        g = clamp01(g * exposure * (1 + warmth * 0.025));
        b = clamp01(b * exposure * (1 - warmth * 0.2));
        break;
      }
      case "threshold": r = g = b = originalLuma >= clamp01(params.level) ? 1 : 0; break;
      case "posterize": {
        const levels = Math.max(2, Math.min(255, Math.round(params.levels)));
        const steps = levels - 1;
        r = Math.round(r * steps) / steps; g = Math.round(g * steps) / steps; b = Math.round(b * steps) / steps;
        break;
      }
      case "invert": r = 1 - r; g = 1 - g; b = 1 - b; break;
    }

    data[offset] = Math.round(clamp01(r) * 255);
    data[offset + 1] = Math.round(clamp01(g) * 255);
    data[offset + 2] = Math.round(clamp01(b) * 255);
  }
  return image;
}
