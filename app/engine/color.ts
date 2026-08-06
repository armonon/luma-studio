export type WorkingColorSpace = "srgb" | "display-p3" | "linear-srgb";

export type Rgb = readonly [number, number, number];

type Matrix3 = readonly [
  number, number, number,
  number, number, number,
  number, number, number,
];

const SRGB_TO_XYZ: Matrix3 = [
  0.4124564, 0.3575761, 0.1804375,
  0.2126729, 0.7151522, 0.072175,
  0.0193339, 0.119192, 0.9503041,
];

const XYZ_TO_SRGB: Matrix3 = [
  3.2404542, -1.5371385, -0.4985314,
  -0.969266, 1.8760108, 0.041556,
  0.0556434, -0.2040259, 1.0572252,
];

const P3_TO_XYZ: Matrix3 = [
  0.48657095, 0.26566769, 0.19821729,
  0.22897456, 0.69173852, 0.07928691,
  0, 0.04511338, 1.04394437,
];

const XYZ_TO_P3: Matrix3 = [
  2.49349691, -0.93138362, -0.40271078,
  -0.82948897, 1.76266406, 0.02362469,
  0.03584583, -0.07617239, 0.95688452,
];

function multiply(matrix: Matrix3, [r, g, b]: Rgb): [number, number, number] {
  return [
    matrix[0] * r + matrix[1] * g + matrix[2] * b,
    matrix[3] * r + matrix[4] * g + matrix[5] * b,
    matrix[6] * r + matrix[7] * g + matrix[8] * b,
  ];
}

/** IEC 61966-2-1 transfer function. Values above one remain unclipped for HDR. */
export function decodeSrgb(value: number) {
  const sign = value < 0 ? -1 : 1;
  const magnitude = Math.abs(value);
  return sign * (magnitude <= 0.04045
    ? magnitude / 12.92
    : ((magnitude + 0.055) / 1.055) ** 2.4);
}

export function encodeSrgb(value: number) {
  const sign = value < 0 ? -1 : 1;
  const magnitude = Math.abs(value);
  return sign * (magnitude <= 0.0031308
    ? magnitude * 12.92
    : 1.055 * magnitude ** (1 / 2.4) - 0.055);
}

/** Convert display-sRGB canvas values into the document's linear working space. */
export function displaySrgbToWorking(rgb: Rgb, space: WorkingColorSpace): [number, number, number] {
  const linear: Rgb = [decodeSrgb(rgb[0]), decodeSrgb(rgb[1]), decodeSrgb(rgb[2])];
  if (space !== "display-p3") return [...linear];
  return multiply(XYZ_TO_P3, multiply(SRGB_TO_XYZ, linear));
}

/** Convert linear working-space values into display-sRGB canvas values. */
export function workingToDisplaySrgb(rgb: Rgb, space: WorkingColorSpace): [number, number, number] {
  const linearSrgb = space === "display-p3"
    ? multiply(XYZ_TO_SRGB, multiply(P3_TO_XYZ, rgb))
    : [...rgb] as [number, number, number];
  return [encodeSrgb(linearSrgb[0]), encodeSrgb(linearSrgb[1]), encodeSrgb(linearSrgb[2])];
}

export function convertWorkingColor(rgb: Rgb, from: WorkingColorSpace, to: WorkingColorSpace) {
  if (from === to || (from !== "display-p3" && to !== "display-p3")) return [...rgb] as [number, number, number];
  const xyz = from === "display-p3" ? multiply(P3_TO_XYZ, rgb) : multiply(SRGB_TO_XYZ, rgb);
  return to === "display-p3" ? multiply(XYZ_TO_P3, xyz) : multiply(XYZ_TO_SRGB, xyz);
}

export function linearRgbToXyz(rgb: Rgb, space: WorkingColorSpace = "srgb") {
  return multiply(space === "display-p3" ? P3_TO_XYZ : SRGB_TO_XYZ, rgb);
}

export function xyzToLinearRgb(xyz: Rgb, space: WorkingColorSpace = "srgb") {
  return multiply(space === "display-p3" ? XYZ_TO_P3 : XYZ_TO_SRGB, xyz);
}

const D65: Rgb = [0.95047, 1, 1.08883];

export function xyzToLab([x, y, z]: Rgb): [number, number, number] {
  const f = (value: number) => value > 216 / 24389 ? Math.cbrt(value) : (841 / 108) * value + 4 / 29;
  const fx = f(x / D65[0]);
  const fy = f(y / D65[1]);
  const fz = f(z / D65[2]);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function labToXyz([l, a, b]: Rgb): [number, number, number] {
  const fy = (l + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const inverse = (value: number) => value ** 3 > 216 / 24389
    ? value ** 3
    : (108 / 841) * (value - 4 / 29);
  return [D65[0] * inverse(fx), D65[1] * inverse(fy), D65[2] * inverse(fz)];
}

/** Device-independent fallback CMYK conversion; ICC profiles can replace this boundary. */
export function rgbToCmyk([r, g, b]: Rgb): [number, number, number, number] {
  const k = 1 - Math.max(r, g, b);
  if (k >= 1) return [0, 0, 0, 1];
  return [(1 - r - k) / (1 - k), (1 - g - k) / (1 - k), (1 - b - k) / (1 - k), k];
}

export function cmykToRgb([c, m, y, k]: readonly [number, number, number, number]): [number, number, number] {
  return [(1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)];
}

export type SoftProofProfile = "none" | "srgb" | "display-p3" | "cmyk-generic";
export type SoftProofIntent = "perceptual" | "relative-colorimetric" | "absolute-colorimetric" | "saturation";

/** Deterministic generic proof boundary; replaceable by an ICC transform without changing callers. */
export function softProofDisplayRgb(
  rgb: Rgb,
  profile: SoftProofProfile,
  intent: SoftProofIntent,
  blackPointCompensation = true,
) {
  const clipped = rgb.map(clampUnit) as [number, number, number];
  if (profile === "none" || profile === "display-p3") {
    return { rgb: clipped, outOfGamut: rgb.some((value) => value < 0 || value > 1) };
  }
  if (profile === "srgb") {
    return { rgb: clipped, outOfGamut: rgb.some((value) => value < 0 || value > 1) };
  }

  let [c, m, y, k] = rgbToCmyk(clipped);
  const totalInk = c + m + y + k;
  if (totalInk > 2.8) {
    const scale = Math.max(0, (2.8 - k) / Math.max(0.0001, c + m + y));
    c *= scale;
    m *= scale;
    y *= scale;
  }
  // Generic coated-paper dot gain and paper/black simulation.
  c = c ** 0.9;
  m = m ** 0.9;
  y = y ** 0.9;
  k = k ** 0.82;
  let proofed = cmykToRgb([c, m, y, k]);
  if (intent === "perceptual") proofed = proofed.map((value) => 0.02 + value * 0.94) as [number, number, number];
  if (intent === "saturation") {
    const luma = proofed[0] * 0.2126 + proofed[1] * 0.7152 + proofed[2] * 0.0722;
    proofed = proofed.map((value) => clampUnit(luma + (value - luma) * 1.08)) as [number, number, number];
  }
  const black = blackPointCompensation ? 0.025 : 0.055;
  const paper: Rgb = intent === "absolute-colorimetric" ? [0.94, 0.93, 0.89] : [1, 1, 1];
  proofed = proofed.map((value, index) => black + value * (paper[index] - black)) as [number, number, number];
  const distance = Math.hypot(proofed[0] - clipped[0], proofed[1] - clipped[1], proofed[2] - clipped[2]);
  return { rgb: proofed.map(clampUnit) as [number, number, number], outOfGamut: distance > 0.085 };
}

function clampUnit(value: number) {
  return Math.max(0, Math.min(1, value));
}
