import {
  D50_WHITE,
  IDENTITY_MATRIX_3,
  chromaticAdaptationMatrix,
  invertColorMatrix,
  multiplyColorMatrices,
  multiplyMatrixVector,
  type ColorMatrix3,
  type ColorVector3,
} from "./color-math";

export type RenderingIntent =
  | "perceptual"
  | "relative-colorimetric"
  | "saturation"
  | "absolute-colorimetric";

export type ToneCurve =
  | { readonly kind: "identity" }
  | { readonly kind: "gamma"; readonly gamma: number }
  | {
    readonly kind: "parametric";
    readonly functionType: 0 | 1 | 2 | 3 | 4;
    readonly parameters: readonly number[];
  }
  | { readonly kind: "sampled"; readonly samples: readonly number[] };

export const IDENTITY_TONE_CURVE: ToneCurve = { kind: "identity" };

export type IccTagInfo = {
  readonly signature: string;
  readonly type: string;
  readonly offset: number;
  readonly size: number;
};

export type ColorProfileCapabilities = {
  readonly model: "matrix-trc" | "unsupported-lut" | "metadata-only";
  readonly canTransform: boolean;
  readonly canUseAsSource: boolean;
  readonly canUseAsDestination: boolean;
  readonly renderingIntents: Readonly<Record<RenderingIntent, "native" | "approximate" | "fallback-relative" | "unsupported">>;
  readonly blackPointCompensation: "heuristic" | "unavailable";
  readonly extendedRange: "linear-extrapolated" | "unavailable";
  readonly fallback: null | {
    readonly reason: string;
    readonly suggestedEngine: "LittleCMS/WASM" | "OpenColorIO/WASM";
  };
};

export type ColorProfile = {
  readonly id: string;
  readonly name: string;
  readonly source: "icc" | "builtin" | "registered";
  readonly description?: string;
  readonly version?: string;
  readonly deviceClass: string;
  readonly colorSpace: string;
  readonly connectionSpace: "XYZ" | "Lab" | "unknown";
  /** Matrix from decoded RGB to D50 ICC PCS XYZ. */
  readonly matrixToPcs: ColorMatrix3 | null;
  readonly matrixFromPcs: ColorMatrix3 | null;
  readonly trc: readonly [ToneCurve, ToneCurve, ToneCurve] | null;
  readonly mediaWhitePoint: ColorVector3;
  readonly mediaBlackPoint: ColorVector3;
  readonly chromaticAdaptationMatrix?: ColorMatrix3;
  readonly defaultRenderingIntent: RenderingIntent;
  readonly tags: Readonly<Record<string, IccTagInfo>>;
  readonly profileId?: string;
  readonly warnings: readonly string[];
  readonly capabilities: ColorProfileCapabilities;
};

export class IccProfileParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IccProfileParseError";
  }
}

const CURVE_PARAMETER_COUNTS = [1, 3, 4, 5, 7] as const;
const INTENTS: readonly RenderingIntent[] = [
  "perceptual",
  "relative-colorimetric",
  "saturation",
  "absolute-colorimetric",
];

export function evaluateToneCurve(curve: ToneCurve, value: number) {
  if (!Number.isFinite(value)) return value;
  if (curve.kind === "identity") return value;
  if (value < 0) return curveEndpoint(curve, 0) + value * curveEndpointSlope(curve, 0);
  if (value > 1) return curveEndpoint(curve, 1) + (value - 1) * curveEndpointSlope(curve, 1);
  return evaluateToneCurveUnit(curve, value);
}

export function invertToneCurve(curve: ToneCurve, value: number) {
  if (!Number.isFinite(value)) return value;
  if (curve.kind === "identity") return value;
  const lower = curveEndpoint(curve, 0);
  const upper = curveEndpoint(curve, 1);
  if (value < lower) return (value - lower) / curveEndpointSlope(curve, 0);
  if (value > upper) return 1 + (value - upper) / curveEndpointSlope(curve, 1);
  return invertToneCurveUnit(curve, value);
}

export function isToneCurveInvertible(curve: ToneCurve) {
  let previous = evaluateToneCurveUnit(curve, 0);
  if (!Number.isFinite(previous)) return false;
  for (let index = 1; index <= 256; index += 1) {
    const current = evaluateToneCurveUnit(curve, index / 256);
    if (!Number.isFinite(current) || current + 1e-10 < previous) return false;
    previous = current;
  }
  return curveEndpointSlope(curve, 0) > 0 && curveEndpointSlope(curve, 1) > 0;
}

function evaluateToneCurveUnit(curve: ToneCurve, value: number) {
  if (curve.kind === "identity") return value;
  if (curve.kind === "gamma") return value ** curve.gamma;
  if (curve.kind === "sampled") {
    if (curve.samples.length === 0) return value;
    if (curve.samples.length === 1) return value ** curve.samples[0];
    const position = value * (curve.samples.length - 1);
    const left = Math.min(curve.samples.length - 1, Math.floor(position));
    const right = Math.min(curve.samples.length - 1, left + 1);
    const fraction = position - left;
    return curve.samples[left] * (1 - fraction) + curve.samples[right] * fraction;
  }

  const [g, a = 1, b = 0, c = 0, d = 0, e = 0, f = 0] = curve.parameters;
  switch (curve.functionType) {
    case 0:
      return value ** g;
    case 1:
      return value >= -b / a ? (a * value + b) ** g : 0;
    case 2:
      return value >= -b / a ? (a * value + b) ** g + c : c;
    case 3:
      return value >= d ? (a * value + b) ** g : c * value;
    case 4:
      return value >= d ? (a * value + b) ** g + e : c * value + f;
  }
}

function invertToneCurveUnit(curve: ToneCurve, value: number) {
  if (curve.kind === "identity") return value;
  if (curve.kind === "gamma") return value ** (1 / curve.gamma);
  if (curve.kind === "sampled") {
    if (curve.samples.length === 0) return value;
    if (curve.samples.length === 1) return value ** (1 / curve.samples[0]);
    let low = 0;
    let high = curve.samples.length - 1;
    while (high - low > 1) {
      const middle = (low + high) >> 1;
      if (curve.samples[middle] < value) low = middle;
      else high = middle;
    }
    const span = curve.samples[high] - curve.samples[low];
    const fraction = span > 1e-12 ? (value - curve.samples[low]) / span : 0;
    return (low + fraction) / (curve.samples.length - 1);
  }

  const [g, a = 1, b = 0, c = 0, d = 0, e = 0, f = 0] = curve.parameters;
  switch (curve.functionType) {
    case 0:
      return value ** (1 / g);
    case 1:
      return (value ** (1 / g) - b) / a;
    case 2:
      return ((value - c) ** (1 / g) - b) / a;
    case 3:
      return value < c * d ? value / c : (value ** (1 / g) - b) / a;
    case 4:
      return value < c * d + f ? (value - f) / c : ((value - e) ** (1 / g) - b) / a;
  }
}

function curveEndpoint(curve: ToneCurve, endpoint: 0 | 1) {
  return evaluateToneCurveUnit(curve, endpoint);
}

function curveEndpointSlope(curve: ToneCurve, endpoint: 0 | 1) {
  const epsilon = 1 / 65535;
  const raw = endpoint === 0
    ? (evaluateToneCurveUnit(curve, epsilon) - evaluateToneCurveUnit(curve, 0)) / epsilon
    : (evaluateToneCurveUnit(curve, 1) - evaluateToneCurveUnit(curve, 1 - epsilon)) / epsilon;
  return Number.isFinite(raw) && raw > 1e-7 ? raw : 1e-7;
}

export type MatrixTrcProfileDefinition = {
  readonly id: string;
  readonly name: string;
  readonly source?: "builtin" | "registered";
  readonly description?: string;
  /** Matrix from decoded RGB to XYZ relative to referenceWhite. */
  readonly matrixToXyz: ColorMatrix3;
  readonly referenceWhite: ColorVector3;
  readonly trc: ToneCurve | readonly [ToneCurve, ToneCurve, ToneCurve];
  readonly mediaWhitePoint?: ColorVector3;
  readonly mediaBlackPoint?: ColorVector3;
};

/** Creates an OCIO-style named matrix/TRC color space and adapts it to ICC D50 PCS. */
export function createMatrixTrcProfile(definition: MatrixTrcProfileDefinition): ColorProfile {
  const adaptation = chromaticAdaptationMatrix(definition.referenceWhite, D50_WHITE);
  const matrixToPcs = multiplyColorMatrices(adaptation, definition.matrixToXyz);
  const curves: readonly [ToneCurve, ToneCurve, ToneCurve] = "kind" in definition.trc
    ? [definition.trc, definition.trc, definition.trc]
    : definition.trc;
  validateMatrixTrc(matrixToPcs, curves);
  return {
    id: definition.id,
    name: definition.name,
    source: definition.source ?? "registered",
    description: definition.description,
    deviceClass: "named-color-space",
    colorSpace: "RGB",
    connectionSpace: "XYZ",
    matrixToPcs,
    matrixFromPcs: invertColorMatrix(matrixToPcs),
    trc: curves,
    mediaWhitePoint: definition.mediaWhitePoint ?? D50_WHITE,
    mediaBlackPoint: definition.mediaBlackPoint ?? [0, 0, 0],
    chromaticAdaptationMatrix: adaptation,
    defaultRenderingIntent: "relative-colorimetric",
    tags: {},
    warnings: [],
    capabilities: matrixTrcCapabilities(),
  };
}

export function parseIccProfile(input: ArrayBuffer | ArrayBufferView): ColorProfile {
  const bytes = input instanceof ArrayBuffer
    ? new Uint8Array(input)
    : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  if (bytes.byteLength < 132) throw new IccProfileParseError("ICC profile is shorter than its 132-byte minimum structure.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const declaredSize = view.getUint32(0, false);
  if (declaredSize < 132 || declaredSize > bytes.byteLength) {
    throw new IccProfileParseError("ICC profile size is invalid or truncated.");
  }
  if (readSignature(bytes, 36) !== "acsp") throw new IccProfileParseError("ICC profile signature 'acsp' is missing.");

  const warnings: string[] = [];
  if (declaredSize < bytes.byteLength) warnings.push("Trailing bytes after the declared ICC profile were ignored.");
  const tagCount = view.getUint32(128, false);
  if (tagCount > 4096 || 132 + tagCount * 12 > declaredSize) {
    throw new IccProfileParseError("ICC tag table is invalid or truncated.");
  }

  const tags: Record<string, IccTagInfo> = {};
  for (let index = 0; index < tagCount; index += 1) {
    const tableOffset = 132 + index * 12;
    const signature = readSignature(bytes, tableOffset);
    const offset = view.getUint32(tableOffset + 4, false);
    const size = view.getUint32(tableOffset + 8, false);
    if (offset > declaredSize || size > declaredSize - offset || size < 8) {
      warnings.push(`Tag ${signature} was ignored because its payload is out of bounds.`);
      continue;
    }
    const type = readSignature(bytes, offset);
    tags[signature] ??= { signature, type, offset, size };
  }

  const colorSpaceSignature = readSignature(bytes, 16);
  const pcsSignature = readSignature(bytes, 20);
  const matrix = colorSpaceSignature === "RGB " && pcsSignature === "XYZ "
    ? parseRgbMatrix(view, tags)
    : null;
  const trc = colorSpaceSignature === "RGB " ? parseRgbTrc(view, tags, warnings) : null;
  let matrixFromPcs: ColorMatrix3 | null = null;
  if (matrix) {
    try {
      matrixFromPcs = invertColorMatrix(matrix);
    } catch {
      warnings.push("RGB colorant matrix is singular.");
    }
  }
  const curvesInvertible = trc?.every(isToneCurveInvertible) ?? false;
  if (trc && !curvesInvertible) warnings.push("At least one TRC is not monotonically invertible.");

  const hasLut = ["A2B0", "A2B1", "A2B2", "B2A0", "B2A1", "B2A2", "D2B0", "B2D0"]
    .some((signature) => tags[signature]);
  const canTransform = Boolean(matrix && matrixFromPcs && trc && curvesInvertible);
  const unsupportedModel: "unsupported-lut" | "metadata-only" = hasLut ? "unsupported-lut" : "metadata-only";
  if (hasLut && !canTransform) {
    warnings.push("LUT/multi-process ICC transforms are recognized but require a full ICC CMM.");
  }

  const headerProfileId = Array.from(bytes.subarray(84, 100), (value) => value.toString(16).padStart(2, "0")).join("");
  const profileId = /^0+$/.test(headerProfileId) ? undefined : headerProfileId;
  const fingerprint = profileId ?? fnv1a(bytes.subarray(0, declaredSize));
  const description = parseDescription(bytes, view, tags.desc) ?? parseDescription(bytes, view, tags.dscm);
  const mediaWhitePoint = parseXyzTag(view, tags.wtpt) ?? D50_WHITE;
  const mediaBlackPoint = parseXyzTag(view, tags.bkpt) ?? [0, 0, 0];
  const chad = parseSf32Matrix(view, tags.chad);
  const renderingIntent = intentFromNumber(view.getUint32(64, false));
  const major = bytes[8];
  const minor = bytes[9] >> 4;
  const bugfix = bytes[9] & 0x0f;

  return {
    id: `icc:${fingerprint}`,
    name: description ?? `ICC ${fingerprint.slice(0, 8)}`,
    source: "icc",
    description,
    version: `${major}.${minor}.${bugfix}`,
    deviceClass: signatureName(readSignature(bytes, 12)),
    colorSpace: signatureName(colorSpaceSignature),
    connectionSpace: connectionSpaceName(pcsSignature),
    matrixToPcs: canTransform ? matrix : null,
    matrixFromPcs: canTransform ? matrixFromPcs : null,
    trc: canTransform ? trc : null,
    mediaWhitePoint,
    mediaBlackPoint,
    chromaticAdaptationMatrix: chad,
    defaultRenderingIntent: renderingIntent,
    tags,
    profileId,
    warnings,
    capabilities: canTransform
      ? matrixTrcCapabilities()
      : unsupportedCapabilities(unsupportedModel, colorSpaceSignature, pcsSignature, hasLut),
  };
}

function parseRgbMatrix(view: DataView, tags: Readonly<Record<string, IccTagInfo>>): ColorMatrix3 | null {
  const red = parseXyzTag(view, tags.rXYZ);
  const green = parseXyzTag(view, tags.gXYZ);
  const blue = parseXyzTag(view, tags.bXYZ);
  if (!red || !green || !blue) return null;
  return [
    red[0], green[0], blue[0],
    red[1], green[1], blue[1],
    red[2], green[2], blue[2],
  ];
}

function parseRgbTrc(
  view: DataView,
  tags: Readonly<Record<string, IccTagInfo>>,
  warnings: string[],
): readonly [ToneCurve, ToneCurve, ToneCurve] | null {
  const curves = [tags.rTRC, tags.gTRC, tags.bTRC].map((tag) => parseToneCurveTag(view, tag, warnings));
  return curves.every(Boolean) ? curves as [ToneCurve, ToneCurve, ToneCurve] : null;
}

function parseToneCurveTag(view: DataView, tag: IccTagInfo | undefined, warnings: string[]): ToneCurve | null {
  if (!tag) return null;
  if (tag.type === "curv") {
    if (tag.size < 12) return null;
    const count = view.getUint32(tag.offset + 8, false);
    if (count === 0) return IDENTITY_TONE_CURVE;
    if (count === 1) {
      if (tag.size < 14) return null;
      const gamma = view.getUint16(tag.offset + 12, false) / 256;
      return gamma > 0 ? { kind: "gamma", gamma } : null;
    }
    if (count > 1_048_576 || 12 + count * 2 > tag.size) {
      warnings.push(`Curve tag ${tag.signature} has an invalid sample count.`);
      return null;
    }
    const samples = Array.from({ length: count }, (_, index) => (
      view.getUint16(tag.offset + 12 + index * 2, false) / 65535
    ));
    return { kind: "sampled", samples };
  }
  if (tag.type === "para") {
    if (tag.size < 12) return null;
    const functionType = view.getUint16(tag.offset + 8, false);
    if (functionType > 4) {
      warnings.push(`Parametric curve ${tag.signature} uses unsupported function type ${functionType}.`);
      return null;
    }
    const count = CURVE_PARAMETER_COUNTS[functionType];
    if (12 + count * 4 > tag.size) return null;
    const parameters = Array.from({ length: count }, (_, index) => readS15Fixed16(view, tag.offset + 12 + index * 4));
    return { kind: "parametric", functionType: functionType as 0 | 1 | 2 | 3 | 4, parameters };
  }
  warnings.push(`TRC tag ${tag.signature} uses unsupported type ${tag.type}.`);
  return null;
}

function parseXyzTag(view: DataView, tag: IccTagInfo | undefined): [number, number, number] | null {
  if (!tag || tag.type !== "XYZ " || tag.size < 20) return null;
  return [
    readS15Fixed16(view, tag.offset + 8),
    readS15Fixed16(view, tag.offset + 12),
    readS15Fixed16(view, tag.offset + 16),
  ];
}

function parseSf32Matrix(view: DataView, tag: IccTagInfo | undefined): ColorMatrix3 | undefined {
  if (!tag || tag.type !== "sf32" || tag.size < 44) return undefined;
  return Array.from({ length: 9 }, (_, index) => readS15Fixed16(view, tag.offset + 8 + index * 4)) as unknown as ColorMatrix3;
}

function parseDescription(bytes: Uint8Array, view: DataView, tag: IccTagInfo | undefined) {
  if (!tag) return undefined;
  if (tag.type === "desc" && tag.size >= 12) {
    const length = Math.min(view.getUint32(tag.offset + 8, false), tag.size - 12);
    return ascii(bytes.subarray(tag.offset + 12, tag.offset + 12 + Math.max(0, length - 1))).trim() || undefined;
  }
  if (tag.type === "mluc" && tag.size >= 28) {
    const count = view.getUint32(tag.offset + 8, false);
    const recordSize = view.getUint32(tag.offset + 12, false);
    if (count === 0 || recordSize < 12 || 16 + count * recordSize > tag.size) return undefined;
    const record = tag.offset + 16;
    const length = view.getUint32(record + 4, false);
    const relativeOffset = view.getUint32(record + 8, false);
    if (relativeOffset > tag.size || length > tag.size - relativeOffset) return undefined;
    const value = bytes.subarray(tag.offset + relativeOffset, tag.offset + relativeOffset + length);
    return decodeUtf16Be(value).trim() || undefined;
  }
  return undefined;
}

function decodeUtf16Be(bytes: Uint8Array) {
  let result = "";
  for (let index = 0; index + 1 < bytes.length; index += 2) {
    result += String.fromCharCode((bytes[index] << 8) | bytes[index + 1]);
  }
  return result;
}

function validateMatrixTrc(matrix: ColorMatrix3, curves: readonly [ToneCurve, ToneCurve, ToneCurve]) {
  invertColorMatrix(matrix);
  if (!curves.every(isToneCurveInvertible)) throw new Error("Every profile tone curve must be monotonically invertible.");
}

function matrixTrcCapabilities(): ColorProfileCapabilities {
  return {
    model: "matrix-trc",
    canTransform: true,
    canUseAsSource: true,
    canUseAsDestination: true,
    renderingIntents: {
      perceptual: "fallback-relative",
      "relative-colorimetric": "native",
      saturation: "fallback-relative",
      "absolute-colorimetric": "approximate",
    },
    blackPointCompensation: "heuristic",
    extendedRange: "linear-extrapolated",
    fallback: null,
  };
}

function unsupportedCapabilities(
  model: "unsupported-lut" | "metadata-only",
  colorSpace: string,
  pcs: string,
  hasLut: boolean,
): ColorProfileCapabilities {
  const reason = hasLut
    ? "This profile requires ICC LUT or multi-process element evaluation, which is not implemented by the native matrix/TRC engine."
    : `Only invertible RGB-to-XYZ matrix/TRC profiles are transformable; profile uses ${signatureName(colorSpace)} to ${signatureName(pcs)}.`;
  return {
    model,
    canTransform: false,
    canUseAsSource: false,
    canUseAsDestination: false,
    renderingIntents: Object.fromEntries(INTENTS.map((intent) => [intent, "unsupported"])) as Record<RenderingIntent, "unsupported">,
    blackPointCompensation: "unavailable",
    extendedRange: "unavailable",
    fallback: { reason, suggestedEngine: "LittleCMS/WASM" },
  };
}

function intentFromNumber(value: number): RenderingIntent {
  return INTENTS[value] ?? "perceptual";
}

function readSignature(bytes: Uint8Array, offset: number) {
  return ascii(bytes.subarray(offset, offset + 4));
}

function signatureName(signature: string) {
  return signature.trim() || "unknown";
}

function connectionSpaceName(signature: string): "XYZ" | "Lab" | "unknown" {
  if (signature === "XYZ ") return "XYZ";
  if (signature === "Lab ") return "Lab";
  return "unknown";
}

function ascii(bytes: Uint8Array) {
  return String.fromCharCode(...bytes);
}

function readS15Fixed16(view: DataView, offset: number) {
  return view.getInt32(offset, false) / 65536;
}

function fnv1a(bytes: Uint8Array) {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Decodes an ICC chad tag back to its implied source white when available. */
export function inferNativeWhitePoint(profile: ColorProfile): ColorVector3 {
  if (!profile.chromaticAdaptationMatrix) return profile.mediaWhitePoint;
  try {
    return multiplyMatrixVector(invertColorMatrix(profile.chromaticAdaptationMatrix), D50_WHITE);
  } catch {
    return profile.mediaWhitePoint;
  }
}

export { IDENTITY_MATRIX_3 };
