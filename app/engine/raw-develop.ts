import { WorkingColorSpace, xyzToLinearRgb } from "./color";

export type Matrix3 = readonly [
  number, number, number,
  number, number, number,
  number, number, number,
];

export type CfaColor = 0 | 1 | 2;

export type RawDevelopSettings = {
  whiteBalance: "as-shot" | "daylight" | "custom";
  customWhiteBalance: readonly [number, number, number];
  exposureEV: number;
  highlightRecovery: number;
  workingSpace: WorkingColorSpace;
};

export type SensorNormalization = {
  width: number;
  height: number;
  blackLevel: readonly number[];
  blackLevelRepeatDim: readonly [number, number];
  blackLevelDeltaH?: readonly number[];
  blackLevelDeltaV?: readonly number[];
  whiteLevel: readonly number[];
};

export const DEFAULT_RAW_DEVELOP_SETTINGS: RawDevelopSettings = {
  whiteBalance: "as-shot",
  customWhiteBalance: [1, 1, 1],
  exposureEV: 0,
  highlightRecovery: 0.35,
  workingSpace: "srgb",
};

function finitePositive(value: number | undefined, fallback: number) {
  return Number.isFinite(value) && value! > 0 ? value! : fallback;
}

export function sanitizeRawDevelopSettings(
  settings: Partial<RawDevelopSettings> = {},
): RawDevelopSettings {
  const wb = settings.customWhiteBalance ?? DEFAULT_RAW_DEVELOP_SETTINGS.customWhiteBalance;
  return {
    whiteBalance: settings.whiteBalance === "daylight" || settings.whiteBalance === "custom"
      ? settings.whiteBalance
      : "as-shot",
    customWhiteBalance: [
      Math.min(16, finitePositive(wb[0], 1)),
      Math.min(16, finitePositive(wb[1], 1)),
      Math.min(16, finitePositive(wb[2], 1)),
    ],
    exposureEV: Math.max(-10, Math.min(10, Number.isFinite(settings.exposureEV) ? settings.exposureEV! : 0)),
    highlightRecovery: Math.max(0, Math.min(1, Number.isFinite(settings.highlightRecovery)
      ? settings.highlightRecovery!
      : DEFAULT_RAW_DEVELOP_SETTINGS.highlightRecovery)),
    workingSpace: settings.workingSpace === "display-p3" || settings.workingSpace === "linear-srgb"
      ? settings.workingSpace
      : "srgb",
  };
}

/** Normalize sensor codes without clipping values above the declared white level. */
export function normalizeSensorMosaic(samples: ArrayLike<number>, metadata: SensorNormalization) {
  const { width, height } = metadata;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || samples.length < width * height) {
    throw new RangeError("Sensor mosaic dimensions do not match its sample buffer");
  }
  const [repeatRows, repeatCols] = metadata.blackLevelRepeatDim;
  const rows = Math.max(1, Math.floor(repeatRows));
  const cols = Math.max(1, Math.floor(repeatCols));
  const black = metadata.blackLevel.length ? metadata.blackLevel : [0];
  const white = metadata.whiteLevel.length ? metadata.whiteLevel : [65535];
  const output = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const site = (y % rows) * cols + (x % cols);
      const floor = (black[site % black.length] ?? black[0] ?? 0)
        + (metadata.blackLevelDeltaH?.[x] ?? 0)
        + (metadata.blackLevelDeltaV?.[y] ?? 0);
      const ceiling = white[site % white.length] ?? white[0] ?? 65535;
      output[index] = Math.max(0, (Number(samples[index]) - floor) / Math.max(1e-9, ceiling - floor));
    }
  }
  return output;
}

function cfaAt(pattern: readonly CfaColor[], dim: readonly [number, number], x: number, y: number) {
  const [rows, cols] = dim;
  const xx = ((x % cols) + cols) % cols;
  const yy = ((y % rows) + rows) % rows;
  return pattern[yy * cols + xx];
}

function mirrorCoordinate(value: number, size: number) {
  if (size <= 1) return 0;
  let mirrored = value;
  while (mirrored < 0 || mirrored >= size) {
    mirrored = mirrored < 0 ? -mirrored : 2 * (size - 1) - mirrored;
  }
  return mirrored;
}

/**
 * Edge-directed Bayer demosaic. Green uses a Hamilton/Adams-style directional
 * estimate; red and blue use local color differences. Non-Bayer mosaics are
 * rejected rather than silently producing incorrect color.
 */
export function demosaicBayer(
  mosaic: Float32Array,
  width: number,
  height: number,
  pattern: readonly CfaColor[],
  patternDim: readonly [number, number] = [2, 2],
) {
  if (width * height !== mosaic.length) throw new RangeError("Bayer dimensions do not match its sample buffer");
  if (patternDim[0] !== 2 || patternDim[1] !== 2 || pattern.length !== 4 ||
      pattern.filter((value) => value === 1).length !== 2 || !pattern.includes(0) || !pattern.includes(2)) {
    throw new RangeError("Only 2x2 RGB Bayer CFA patterns are supported");
  }
  const sample = (x: number, y: number) => mosaic[mirrorCoordinate(y, height) * width + mirrorCoordinate(x, width)];
  const green = new Float32Array(width * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (cfaAt(pattern, patternDim, x, y) === 1) {
        green[index] = mosaic[index];
        continue;
      }
      const center = mosaic[index];
      const left = sample(x - 1, y);
      const right = sample(x + 1, y);
      const up = sample(x, y - 1);
      const down = sample(x, y + 1);
      const left2 = sample(x - 2, y);
      const right2 = sample(x + 2, y);
      const up2 = sample(x, y - 2);
      const down2 = sample(x, y + 2);
      const horizontalGradient = Math.abs(left - right) + Math.abs(2 * center - left2 - right2);
      const verticalGradient = Math.abs(up - down) + Math.abs(2 * center - up2 - down2);
      const horizontal = (left + right) * 0.5 + (2 * center - left2 - right2) * 0.25;
      const vertical = (up + down) * 0.5 + (2 * center - up2 - down2) * 0.25;
      green[index] = Math.max(0, horizontalGradient < verticalGradient
        ? horizontal
        : verticalGradient < horizontalGradient
          ? vertical
          : (horizontal + vertical) * 0.5);
    }
  }

  const output = new Float32Array(width * height * 3);
  const greenAt = (x: number, y: number) => green[mirrorCoordinate(y, height) * width + mirrorCoordinate(x, width)];
  const estimateColor = (x: number, y: number, target: CfaColor) => {
    const candidates: Array<{ distance: number; difference: number }> = [];
    for (let oy = -2; oy <= 2; oy += 1) {
      for (let ox = -2; ox <= 2; ox += 1) {
        if (ox === 0 && oy === 0) continue;
        const xx = mirrorCoordinate(x + ox, width);
        const yy = mirrorCoordinate(y + oy, height);
        if (cfaAt(pattern, patternDim, xx, yy) !== target) continue;
        candidates.push({
          distance: ox * ox + oy * oy,
          difference: sample(xx, yy) - greenAt(xx, yy),
        });
      }
    }
    if (!candidates.length) return greenAt(x, y);
    const nearest = Math.min(...candidates.map((candidate) => candidate.distance));
    const selected = candidates.filter((candidate) => candidate.distance === nearest);
    return Math.max(0, greenAt(x, y) + selected.reduce((sum, candidate) => sum + candidate.difference, 0) / selected.length);
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      const known = cfaAt(pattern, patternDim, x, y);
      output[pixel * 3] = known === 0 ? mosaic[pixel] : estimateColor(x, y, 0);
      output[pixel * 3 + 1] = green[pixel];
      output[pixel * 3 + 2] = known === 2 ? mosaic[pixel] : estimateColor(x, y, 2);
    }
  }
  return output;
}

export function multiplyMatrix3(matrix: Matrix3, vector: readonly [number, number, number]): [number, number, number] {
  return [
    matrix[0] * vector[0] + matrix[1] * vector[1] + matrix[2] * vector[2],
    matrix[3] * vector[0] + matrix[4] * vector[1] + matrix[5] * vector[2],
    matrix[6] * vector[0] + matrix[7] * vector[1] + matrix[8] * vector[2],
  ];
}

export function multiplyMatrices3(left: Matrix3, right: Matrix3): Matrix3 {
  const output = new Array<number>(9);
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      output[row * 3 + column] = left[row * 3] * right[column]
        + left[row * 3 + 1] * right[column + 3]
        + left[row * 3 + 2] * right[column + 6];
    }
  }
  return output as unknown as Matrix3;
}

export function invertMatrix3(matrix: Matrix3): Matrix3 | null {
  const [a, b, c, d, e, f, g, h, i] = matrix;
  const A = e * i - f * h;
  const B = c * h - b * i;
  const C = b * f - c * e;
  const D = f * g - d * i;
  const E = a * i - c * g;
  const F = c * d - a * f;
  const G = d * h - e * g;
  const H = b * g - a * h;
  const I = a * e - b * d;
  const determinant = a * A + b * D + c * G;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) return null;
  return [A, B, C, D, E, F, G, H, I].map((value) => value / determinant) as unknown as Matrix3;
}

export function whiteBalanceMultipliers(
  mode: RawDevelopSettings["whiteBalance"],
  asShotNeutral: readonly number[] | undefined,
  custom: readonly [number, number, number],
): [number, number, number] {
  if (mode === "custom") return [...custom];
  if (mode === "daylight" || !asShotNeutral || asShotNeutral.length < 3) return [2, 1, 1.5];
  const inverse: [number, number, number] = [
    1 / finitePositive(asShotNeutral[0], 1),
    1 / finitePositive(asShotNeutral[1], 1),
    1 / finitePositive(asShotNeutral[2], 1),
  ];
  const scale = inverse[1] || Math.min(...inverse);
  return inverse.map((value) => value / scale) as [number, number, number];
}

/**
 * Reconstruct a clipped camera channel from nearby unclipped color ratios.
 * This can restore chroma in isolated sensor clipping; fully clipped regions
 * intentionally remain clipped because no local measurement can recover them.
 */
export function recoverClippedHighlights(
  cameraRgb: Float32Array,
  width: number,
  height: number,
  amount: number,
) {
  if (cameraRgb.length !== width * height * 3) throw new RangeError("Highlight recovery dimensions do not match camera RGB");
  const strength = Math.max(0, Math.min(1, amount));
  if (!strength) return cameraRgb.slice();
  const output = cameraRgb.slice();
  const reference = (pixel: number, channel: number) => channel === 1
    ? (cameraRgb[pixel * 3] + cameraRgb[pixel * 3 + 2]) * 0.5
    : cameraRgb[pixel * 3 + 1];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      for (let channel = 0; channel < 3; channel += 1) {
        const measured = cameraRgb[pixel * 3 + channel];
        if (measured < 0.995) continue;
        const ratios: number[] = [];
        for (let oy = -3; oy <= 3; oy += 1) {
          for (let ox = -3; ox <= 3; ox += 1) {
            if (!ox && !oy) continue;
            const xx = x + ox;
            const yy = y + oy;
            if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
            const neighbor = yy * width + xx;
            const value = cameraRgb[neighbor * 3 + channel];
            const neighborReference = reference(neighbor, channel);
            if (value > 0.02 && value < 0.98 && neighborReference > 0.02 && neighborReference < 0.98) {
              ratios.push(value / neighborReference);
            }
          }
        }
        if (ratios.length < 2) continue;
        ratios.sort((left, right) => left - right);
        const ratio = ratios[Math.floor(ratios.length / 2)];
        const estimate = reference(pixel, channel) * ratio;
        if (Number.isFinite(estimate) && estimate > measured) {
          output[pixel * 3 + channel] = measured + (estimate - measured) * strength;
        }
      }
    }
  }
  return output;
}

function highlightShoulder(value: number, amount: number) {
  if (amount <= 0 || value <= 0.75) return value;
  const compressed = 0.75 + 0.25 * (1 - Math.exp(-(value - 0.75) / 0.25));
  return value + (compressed - value) * amount;
}

/** Develop demosaiced camera RGB into an unclipped linear working-space RGBA buffer. */
export function developCameraRgb(
  cameraRgb: Float32Array,
  settingsInput: Partial<RawDevelopSettings>,
  options: {
    asShotNeutral?: readonly number[];
    cameraToXyz?: Matrix3;
  } = {},
) {
  if (cameraRgb.length % 3) throw new RangeError("Camera RGB buffer must contain complete pixels");
  const settings = sanitizeRawDevelopSettings(settingsInput);
  const wb = whiteBalanceMultipliers(settings.whiteBalance, options.asShotNeutral, settings.customWhiteBalance);
  const exposure = 2 ** settings.exposureEV;
  const output = new Float32Array(cameraRgb.length / 3 * 4);
  for (let pixel = 0; pixel < cameraRgb.length / 3; pixel += 1) {
    let camera: [number, number, number] = [
      cameraRgb[pixel * 3] * wb[0],
      cameraRgb[pixel * 3 + 1] * wb[1],
      cameraRgb[pixel * 3 + 2] * wb[2],
    ];
    camera = camera.map((value) => highlightShoulder(value, settings.highlightRecovery)) as [number, number, number];
    const working = options.cameraToXyz
      ? xyzToLinearRgb(multiplyMatrix3(options.cameraToXyz, camera), settings.workingSpace)
      : camera;
    output[pixel * 4] = working[0] * exposure;
    output[pixel * 4 + 1] = working[1] * exposure;
    output[pixel * 4 + 2] = working[2] * exposure;
    output[pixel * 4 + 3] = 1;
  }
  return { pixels: output, settings, whiteBalanceMultipliers: wb };
}
