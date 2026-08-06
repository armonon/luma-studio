export type ColorVector3 = readonly [number, number, number];
export type ColorVector4 = readonly [number, number, number, number];

export type ColorMatrix3 = readonly [
  number, number, number,
  number, number, number,
  number, number, number,
];

export const IDENTITY_MATRIX_3: ColorMatrix3 = [
  1, 0, 0,
  0, 1, 0,
  0, 0, 1,
];

/** ICC PCS reference white (D50, normalized to Y=1). */
export const D50_WHITE: ColorVector3 = [0.96422, 1, 0.82521];

/** sRGB/Display-P3 reference white (D65, normalized to Y=1). */
export const D65_WHITE: ColorVector3 = [0.95047, 1, 1.08883];

export function multiplyMatrixVector(
  matrix: ColorMatrix3,
  [x, y, z]: ColorVector3,
): [number, number, number] {
  return [
    matrix[0] * x + matrix[1] * y + matrix[2] * z,
    matrix[3] * x + matrix[4] * y + matrix[5] * z,
    matrix[6] * x + matrix[7] * y + matrix[8] * z,
  ];
}

export function multiplyColorMatrices(a: ColorMatrix3, b: ColorMatrix3): ColorMatrix3 {
  const value = (row: number, column: number) => (
    a[row * 3] * b[column]
    + a[row * 3 + 1] * b[column + 3]
    + a[row * 3 + 2] * b[column + 6]
  );
  return [
    value(0, 0), value(0, 1), value(0, 2),
    value(1, 0), value(1, 1), value(1, 2),
    value(2, 0), value(2, 1), value(2, 2),
  ];
}

export function invertColorMatrix(matrix: ColorMatrix3): ColorMatrix3 {
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
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) {
    throw new Error("Color matrix is singular and cannot be inverted.");
  }
  const scale = 1 / determinant;
  return [
    A * scale, B * scale, C * scale,
    D * scale, E * scale, F * scale,
    G * scale, H * scale, I * scale,
  ];
}

const BRADFORD: ColorMatrix3 = [
  0.8951, 0.2664, -0.1614,
  -0.7502, 1.7135, 0.0367,
  0.0389, -0.0685, 1.0296,
];

const INVERSE_BRADFORD = invertColorMatrix(BRADFORD);

/** Linear Bradford adaptation between normalized XYZ reference whites. */
export function chromaticAdaptationMatrix(
  sourceWhite: ColorVector3,
  destinationWhite: ColorVector3,
): ColorMatrix3 {
  const sourceCone = multiplyMatrixVector(BRADFORD, sourceWhite);
  const destinationCone = multiplyMatrixVector(BRADFORD, destinationWhite);
  if (sourceCone.some((value) => Math.abs(value) < 1e-12)) {
    throw new Error("Source white cannot be chromatically adapted.");
  }
  const scale: ColorMatrix3 = [
    destinationCone[0] / sourceCone[0], 0, 0,
    0, destinationCone[1] / sourceCone[1], 0,
    0, 0, destinationCone[2] / sourceCone[2],
  ];
  return multiplyColorMatrices(INVERSE_BRADFORD, multiplyColorMatrices(scale, BRADFORD));
}

export function adaptXyz(
  xyz: ColorVector3,
  sourceWhite: ColorVector3,
  destinationWhite: ColorVector3,
): [number, number, number] {
  return multiplyMatrixVector(chromaticAdaptationMatrix(sourceWhite, destinationWhite), xyz);
}

export type Chromaticity = readonly [x: number, y: number];

export function chromaticityToXyz([x, y]: Chromaticity): [number, number, number] {
  if (!(y > 0)) throw new Error("Chromaticity y must be greater than zero.");
  return [x / y, 1, (1 - x - y) / y];
}

/** Builds the linear RGB-to-XYZ matrix whose columns are the scaled primaries. */
export function rgbPrimariesToXyzMatrix(
  red: Chromaticity,
  green: Chromaticity,
  blue: Chromaticity,
  whitePoint: ColorVector3,
): ColorMatrix3 {
  const r = chromaticityToXyz(red);
  const g = chromaticityToXyz(green);
  const b = chromaticityToXyz(blue);
  const primaries: ColorMatrix3 = [
    r[0], g[0], b[0],
    r[1], g[1], b[1],
    r[2], g[2], b[2],
  ];
  const scale = multiplyMatrixVector(invertColorMatrix(primaries), whitePoint);
  return [
    primaries[0] * scale[0], primaries[1] * scale[1], primaries[2] * scale[2],
    primaries[3] * scale[0], primaries[4] * scale[1], primaries[5] * scale[2],
    primaries[6] * scale[0], primaries[7] * scale[1], primaries[8] * scale[2],
  ];
}

export function xyzD50ToLab([x, y, z]: ColorVector3): [number, number, number] {
  const epsilon = 216 / 24389;
  const kappa = 24389 / 27;
  const f = (value: number) => value > epsilon
    ? Math.cbrt(value)
    : (kappa * value + 16) / 116;
  const fx = f(x / D50_WHITE[0]);
  const fy = f(y / D50_WHITE[1]);
  const fz = f(z / D50_WHITE[2]);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function deltaE76(a: ColorVector3, b: ColorVector3) {
  const left = xyzD50ToLab(a);
  const right = xyzD50ToLab(b);
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
}

export function approximatelyEqualVector(
  left: ColorVector3,
  right: ColorVector3,
  tolerance = 1e-7,
) {
  return left.every((value, index) => Math.abs(value - right[index]) <= tolerance);
}
