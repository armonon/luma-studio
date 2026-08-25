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
  readonly model: "matrix-trc" | "lut" | "unsupported-lut" | "metadata-only";
  readonly canTransform: boolean;
  readonly canUseAsSource: boolean;
  readonly canUseAsDestination: boolean;
  readonly renderingIntents: Readonly<Record<RenderingIntent, "native" | "approximate" | "fallback-relative" | "unsupported">>;
  readonly blackPointCompensation: "heuristic" | "unavailable";
  readonly extendedRange: "linear-extrapolated" | "clamped" | "unavailable";
  readonly fallback: null | {
    readonly reason: string;
    readonly suggestedEngine: "LittleCMS/WASM" | "OpenColorIO/WASM";
  };
};

export type IccClassicLut3D = {
  readonly type: "mft1" | "mft2";
  readonly inputChannels: 3;
  readonly outputChannels: 3;
  readonly gridPoints: number;
  readonly matrix: ColorMatrix3;
  readonly inputTables: readonly [Float32Array, Float32Array, Float32Array];
  readonly clut: Float32Array;
  readonly outputTables: readonly [Float32Array, Float32Array, Float32Array];
};

export type IccMultiFunctionLut3D = {
  readonly type: "mAB" | "mBA";
  readonly inputChannels: 3;
  readonly outputChannels: 3;
  readonly gridPoints: number | null;
  readonly aCurves: readonly [ToneCurve, ToneCurve, ToneCurve] | null;
  readonly bCurves: readonly [ToneCurve, ToneCurve, ToneCurve];
  readonly mCurves: readonly [ToneCurve, ToneCurve, ToneCurve] | null;
  readonly matrix: null | {
    readonly coefficients: ColorMatrix3;
    readonly offset: ColorVector3;
  };
  readonly clut: null | {
    readonly gridPoints: readonly [number, number, number];
    readonly precision: 1 | 2;
    readonly values: Float32Array;
  };
};

export type IccLut3D = IccClassicLut3D | IccMultiFunctionLut3D;

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
  /** Classic ICC AToB LUTs keyed by their native rendering intent. */
  readonly lutToPcs: Readonly<Partial<Record<RenderingIntent, IccLut3D>>>;
  /** Classic ICC BToA LUTs keyed by their native rendering intent. */
  readonly lutFromPcs: Readonly<Partial<Record<RenderingIntent, IccLut3D>>>;
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
    lutToPcs: {},
    lutFromPcs: {},
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

  const deviceClassSignature = readSignature(bytes, 12);
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

  const multiProcessSignatures = [
    "D2B0", "D2B1", "D2B2", "D2B3", "B2D0", "B2D1", "B2D2", "B2D3",
  ] as const;
  const hasMultiProcess = multiProcessSignatures.some((signature) => tags[signature]);
  const hasLut = [
    "A2B0", "A2B1", "A2B2", "B2A0", "B2A1", "B2A2",
    ...multiProcessSignatures,
  ]
    .some((signature) => tags[signature]);
  const isDeviceLink = deviceClassSignature === "link";
  // Lab table encoding changed between ICC v2 and v4. The lightweight path is
  // exact for v4; older Lab LUTs stay on the explicit CMM fallback rather than
  // being interpreted with the wrong neutral point.
  const supportedThreeChannelPcs = pcsSignature === "XYZ " || (pcsSignature === "Lab " && bytes[8] >= 4);
  const lutToPcs = supportedThreeChannelPcs && !isDeviceLink
    ? parseIntentLuts(view, tags, "A2B", warnings)
    : {};
  const lutFromPcs = supportedThreeChannelPcs && !isDeviceLink
    ? parseIntentLuts(view, tags, "B2A", warnings)
    : {};
  const hasParsedLut = Object.keys(lutToPcs).length > 0 || Object.keys(lutFromPcs).length > 0;
  const hasMatrixTransform = !isDeviceLink && Boolean(matrix && matrixFromPcs && trc && curvesInvertible);
  const unsupportedModel: "unsupported-lut" | "metadata-only" = hasLut ? "unsupported-lut" : "metadata-only";
  if (hasMultiProcess) {
    warnings.push("Float DToB/BToD multi-process elements are not evaluated; ICC fallback precedence uses supported AToB/BToA or matrix/TRC data when present.");
  }
  if (hasLut && !hasParsedLut && !hasMatrixTransform) {
    warnings.push(isDeviceLink
      ? "Device-link transforms connect two device encodings directly and cannot be treated as PCS transforms."
      : "No supported three-channel RGB-to-PCS LUT transform could be decoded; unsupported profiles still require a full ICC CMM.");
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
    deviceClass: signatureName(deviceClassSignature),
    colorSpace: signatureName(colorSpaceSignature),
    connectionSpace: isDeviceLink ? "unknown" : connectionSpaceName(pcsSignature),
    matrixToPcs: hasMatrixTransform ? matrix : null,
    matrixFromPcs: hasMatrixTransform ? matrixFromPcs : null,
    trc: hasMatrixTransform ? trc : null,
    lutToPcs,
    lutFromPcs,
    mediaWhitePoint,
    mediaBlackPoint,
    chromaticAdaptationMatrix: chad,
    defaultRenderingIntent: renderingIntent,
    tags,
    profileId,
    warnings,
    capabilities: hasParsedLut
      ? lutCapabilities(lutToPcs, lutFromPcs, hasMatrixTransform)
      : hasMatrixTransform
        ? matrixTrcCapabilities()
      : unsupportedCapabilities(unsupportedModel, deviceClassSignature, colorSpaceSignature, pcsSignature, hasLut),
  };
}

const LUT_INTENT_TAGS = {
  A2B: {
    perceptual: "A2B0",
    "relative-colorimetric": "A2B1",
    saturation: "A2B2",
  },
  B2A: {
    perceptual: "B2A0",
    "relative-colorimetric": "B2A1",
    saturation: "B2A2",
  },
} as const;

function parseIntentLuts(
  view: DataView,
  tags: Readonly<Record<string, IccTagInfo>>,
  direction: keyof typeof LUT_INTENT_TAGS,
  warnings: string[],
) {
  const result: Partial<Record<RenderingIntent, IccLut3D>> = {};
  for (const [intent, signature] of Object.entries(LUT_INTENT_TAGS[direction])) {
    const tag = tags[signature];
    if (!tag) continue;
    const lut = parseLutTransform(view, tag, direction, warnings);
    if (lut) result[intent as RenderingIntent] = lut;
  }
  return result;
}

function parseLutTransform(
  view: DataView,
  tag: IccTagInfo,
  direction: keyof typeof LUT_INTENT_TAGS,
  warnings: string[],
): IccLut3D | null {
  if (tag.type === "mAB " || tag.type === "mBA ") {
    const expected = direction === "A2B" ? "mAB " : "mBA ";
    if (tag.type !== expected) {
      warnings.push(`LUT tag ${tag.signature} uses ${tag.type.trim()} but ${direction} requires ${expected.trim()}.`);
      return null;
    }
    return parseMultiFunctionLut(view, tag, warnings);
  }
  return parseClassicLut(view, tag, warnings);
}

function parseClassicLut(view: DataView, tag: IccTagInfo, warnings: string[]): IccClassicLut3D | null {
  if (tag.type !== "mft1" && tag.type !== "mft2") {
    warnings.push(`LUT tag ${tag.signature} uses unsupported type ${tag.type}.`);
    return null;
  }
  const headerSize = tag.type === "mft1" ? 48 : 52;
  if (tag.size < headerSize) {
    warnings.push(`LUT tag ${tag.signature} is truncated.`);
    return null;
  }
  const inputChannels = view.getUint8(tag.offset + 8);
  const outputChannels = view.getUint8(tag.offset + 9);
  const gridPoints = view.getUint8(tag.offset + 10);
  if (inputChannels !== 3 || outputChannels !== 3 || gridPoints < 2 || gridPoints > 65) {
    warnings.push(`LUT tag ${tag.signature} must be a 3-channel RGB/XYZ table with 2–65 grid points.`);
    return null;
  }
  const matrix = Array.from(
    { length: 9 },
    (_, index) => readS15Fixed16(view, tag.offset + 12 + index * 4),
  ) as unknown as ColorMatrix3;
  const inputEntries = tag.type === "mft1" ? 256 : view.getUint16(tag.offset + 48, false);
  const outputEntries = tag.type === "mft1" ? 256 : view.getUint16(tag.offset + 50, false);
  if (inputEntries < 2 || outputEntries < 2 || inputEntries > 65_536 || outputEntries > 65_536) {
    warnings.push(`LUT tag ${tag.signature} has invalid one-dimensional table sizes.`);
    return null;
  }
  const bytesPerEntry = tag.type === "mft1" ? 1 : 2;
  const clutEntries = gridPoints ** inputChannels * outputChannels;
  const tableEntries = inputChannels * inputEntries + clutEntries + outputChannels * outputEntries;
  if (tableEntries > 20_000_000 || headerSize + tableEntries * bytesPerEntry > tag.size) {
    warnings.push(`LUT tag ${tag.signature} is truncated or exceeds the safe table limit.`);
    return null;
  }
  let offset = tag.offset + headerSize;
  const readTable = (count: number) => {
    const table = new Float32Array(count);
    for (let index = 0; index < count; index += 1) {
      table[index] = tag.type === "mft1"
        ? view.getUint8(offset++) / 255
        : view.getUint16(offset + index * 2, false) / 65535;
    }
    if (tag.type === "mft2") offset += count * 2;
    return table;
  };
  const inputTables = [readTable(inputEntries), readTable(inputEntries), readTable(inputEntries)] as const;
  const clut = readTable(clutEntries);
  const outputTables = [readTable(outputEntries), readTable(outputEntries), readTable(outputEntries)] as const;
  return {
    type: tag.type,
    inputChannels: 3,
    outputChannels: 3,
    gridPoints,
    matrix,
    inputTables,
    clut,
    outputTables,
  };
}

function parseMultiFunctionLut(
  view: DataView,
  tag: IccTagInfo,
  warnings: string[],
): IccMultiFunctionLut3D | null {
  if (tag.size < 32) {
    warnings.push(`LUT tag ${tag.signature} is shorter than its v4 multi-function header.`);
    return null;
  }
  const inputChannels = view.getUint8(tag.offset + 8);
  const outputChannels = view.getUint8(tag.offset + 9);
  if (inputChannels !== 3 || outputChannels !== 3) {
    warnings.push(`LUT tag ${tag.signature} uses ${inputChannels}→${outputChannels} channels; the lightweight evaluator supports only 3→3 pipelines.`);
    return null;
  }
  const relativeOffsets = {
    b: view.getUint32(tag.offset + 12, false),
    matrix: view.getUint32(tag.offset + 16, false),
    m: view.getUint32(tag.offset + 20, false),
    clut: view.getUint32(tag.offset + 24, false),
    a: view.getUint32(tag.offset + 28, false),
  };
  for (const [name, offset] of Object.entries(relativeOffsets)) {
    if (offset !== 0 && (offset < 32 || offset % 4 !== 0 || offset >= tag.size)) {
      warnings.push(`LUT tag ${tag.signature} has an invalid ${name} element offset.`);
      return null;
    }
  }

  const aCurves = relativeOffsets.a
    ? parseEmbeddedCurveSet(view, tag, relativeOffsets.a, 3, "A", warnings)
    : null;
  const bCurves = relativeOffsets.b
    ? parseEmbeddedCurveSet(view, tag, relativeOffsets.b, 3, "B", warnings)
    : null;
  const mCurves = relativeOffsets.m
    ? parseEmbeddedCurveSet(view, tag, relativeOffsets.m, 3, "M", warnings)
    : null;
  const matrix = relativeOffsets.matrix
    ? parseMultiFunctionMatrix(view, tag, relativeOffsets.matrix, warnings)
    : null;
  const clut = relativeOffsets.clut
    ? parseMultiFunctionClut(view, tag, relativeOffsets.clut, warnings)
    : null;
  if (!relativeOffsets.b) {
    warnings.push(`LUT tag ${tag.signature} omits the required B curve set.`);
    return null;
  }
  if ((relativeOffsets.a && !aCurves) || !bCurves || (relativeOffsets.m && !mCurves)
    || (relativeOffsets.matrix && !matrix) || (relativeOffsets.clut && !clut)) return null;

  const hasA = Boolean(aCurves);
  const hasM = Boolean(mCurves);
  const hasMatrix = Boolean(matrix);
  const hasClut = Boolean(clut);
  const validCombination = (
    (!hasA && !hasClut && !hasM && !hasMatrix)
    || (!hasA && !hasClut && hasM && hasMatrix)
    || (hasA && hasClut && !hasM && !hasMatrix)
    || (hasA && hasClut && hasM && hasMatrix)
  );
  if (!validCombination) {
    warnings.push(`LUT tag ${tag.signature} uses a processing-element combination forbidden by ICC.1.`);
    return null;
  }
  return {
    type: tag.type === "mAB " ? "mAB" : "mBA",
    inputChannels: 3,
    outputChannels: 3,
    gridPoints: clut ? Math.max(...clut.gridPoints) : null,
    aCurves,
    bCurves,
    mCurves,
    matrix,
    clut,
  };
}

function parseEmbeddedCurveSet(
  view: DataView,
  tag: IccTagInfo,
  relativeOffset: number,
  count: number,
  label: string,
  warnings: string[],
): readonly [ToneCurve, ToneCurve, ToneCurve] | null {
  const curves: ToneCurve[] = [];
  let offset = tag.offset + relativeOffset;
  const end = tag.offset + tag.size;
  for (let index = 0; index < count; index += 1) {
    if (offset + 12 > end) {
      warnings.push(`LUT tag ${tag.signature} has a truncated ${label} curve set.`);
      return null;
    }
    const type = readViewSignature(view, offset);
    let size: number;
    if (type === "curv") {
      const entries = view.getUint32(offset + 8, false);
      if (entries > 1_048_576) {
        warnings.push(`LUT tag ${tag.signature} has an oversized embedded curve.`);
        return null;
      }
      size = 12 + entries * 2;
    } else if (type === "para") {
      const functionType = view.getUint16(offset + 8, false);
      if (functionType > 4) {
        warnings.push(`LUT tag ${tag.signature} has an unsupported embedded parametric curve.`);
        return null;
      }
      size = 12 + CURVE_PARAMETER_COUNTS[functionType] * 4;
    } else {
      warnings.push(`LUT tag ${tag.signature} ${label} curve ${index + 1} uses unsupported type ${type}.`);
      return null;
    }
    if (size > end - offset) {
      warnings.push(`LUT tag ${tag.signature} has a truncated ${label} curve set.`);
      return null;
    }
    const curve = parseToneCurveTag(view, {
      signature: `${label}${index + 1}`,
      type,
      offset,
      size,
    }, warnings);
    if (!curve) return null;
    curves.push(curve);
    offset = (offset + size + 3) & ~3;
  }
  return curves as [ToneCurve, ToneCurve, ToneCurve];
}

function parseMultiFunctionMatrix(
  view: DataView,
  tag: IccTagInfo,
  relativeOffset: number,
  warnings: string[],
) {
  const offset = tag.offset + relativeOffset;
  if (offset + 48 > tag.offset + tag.size) {
    warnings.push(`LUT tag ${tag.signature} has a truncated 3×4 matrix.`);
    return null;
  }
  const values = Array.from({ length: 12 }, (_, index) => readS15Fixed16(view, offset + index * 4));
  return {
    coefficients: values.slice(0, 9) as unknown as ColorMatrix3,
    offset: values.slice(9, 12) as [number, number, number],
  };
}

function parseMultiFunctionClut(
  view: DataView,
  tag: IccTagInfo,
  relativeOffset: number,
  warnings: string[],
) {
  const offset = tag.offset + relativeOffset;
  const end = tag.offset + tag.size;
  if (offset + 20 > end) {
    warnings.push(`LUT tag ${tag.signature} has a truncated CLUT header.`);
    return null;
  }
  const gridPoints = [view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2)] as const;
  if (gridPoints.some((points) => points < 2)) {
    warnings.push(`LUT tag ${tag.signature} CLUT dimensions require at least two grid points.`);
    return null;
  }
  const precision = view.getUint8(offset + 16);
  if (precision !== 1 && precision !== 2) {
    warnings.push(`LUT tag ${tag.signature} CLUT precision must be one or two bytes.`);
    return null;
  }
  const entries = gridPoints[0] * gridPoints[1] * gridPoints[2] * 3;
  if (entries > 20_000_000 || offset + 20 + entries * precision > end) {
    warnings.push(`LUT tag ${tag.signature} CLUT is truncated or exceeds the safe table limit.`);
    return null;
  }
  const values = new Float32Array(entries);
  for (let index = 0; index < entries; index += 1) {
    values[index] = precision === 1
      ? view.getUint8(offset + 20 + index) / 255
      : view.getUint16(offset + 20 + index * 2, false) / 65535;
  }
  return { gridPoints, precision: precision as 1 | 2, values };
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

function lutCapabilities(
  toPcs: Readonly<Partial<Record<RenderingIntent, IccLut3D>>>,
  fromPcs: Readonly<Partial<Record<RenderingIntent, IccLut3D>>>,
  hasMatrixFallback: boolean,
): ColorProfileCapabilities {
  const has = (intent: RenderingIntent) => Boolean(toPcs[intent] || fromPcs[intent]);
  const canUseAsSource = hasMatrixFallback || Object.keys(toPcs).length > 0;
  const canUseAsDestination = hasMatrixFallback || Object.keys(fromPcs).length > 0;
  return {
    model: "lut",
    canTransform: canUseAsSource || canUseAsDestination,
    canUseAsSource,
    canUseAsDestination,
    renderingIntents: {
      perceptual: has("perceptual") ? "native" : "fallback-relative",
      "relative-colorimetric": has("relative-colorimetric") || hasMatrixFallback ? "native" : "unsupported",
      saturation: has("saturation") ? "native" : "fallback-relative",
      "absolute-colorimetric": has("relative-colorimetric") || hasMatrixFallback ? "approximate" : "unsupported",
    },
    blackPointCompensation: "heuristic",
    extendedRange: "clamped",
    fallback: null,
  };
}

function unsupportedCapabilities(
  model: "unsupported-lut" | "metadata-only",
  deviceClass: string,
  colorSpace: string,
  pcs: string,
  hasLut: boolean,
): ColorProfileCapabilities {
  const reason = deviceClass === "link"
    ? "Device-link profiles transform directly between two device encodings and cannot be inserted as a PCS source or destination profile."
    : hasLut
    ? "This profile requires an ICC LUT or multi-process model outside the lightweight ICC evaluator's supported subset."
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

function readViewSignature(view: DataView, offset: number) {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
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

export const ICC_XYZ_LUT_SCALE = 65535 / 32768;

/** ICC normalized Lab encoding: L-star maps 0..100 to 0..1 and a-star/b-star map
 * -128..127 to 0..1. Values outside the PCS gamut are clipped by LUT tables. */
export function iccLabNormalizedToXyz(encoded: ColorVector3): [number, number, number] {
  const lightness = clampUnit(encoded[0]) * 100;
  const a = clampUnit(encoded[1]) * 255 - 128;
  const b = clampUnit(encoded[2]) * 255 - 128;
  const fy = (lightness + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const delta = 6 / 29;
  const inverse = (value: number) => value > delta ? value ** 3 : 3 * delta * delta * (value - 4 / 29);
  return [
    D50_WHITE[0] * inverse(fx),
    D50_WHITE[1] * inverse(fy),
    D50_WHITE[2] * inverse(fz),
  ];
}

export function xyzToIccLabNormalized(xyz: ColorVector3): [number, number, number] {
  const delta = 6 / 29;
  const forward = (value: number) => value > delta ** 3 ? Math.cbrt(value) : value / (3 * delta * delta) + 4 / 29;
  const fx = forward(xyz[0] / D50_WHITE[0]);
  const fy = forward(xyz[1] / D50_WHITE[1]);
  const fz = forward(xyz[2] / D50_WHITE[2]);
  const lightness = 116 * fy - 16;
  const a = 500 * (fx - fy);
  const b = 200 * (fy - fz);
  return [
    clampUnit(lightness / 100),
    clampUnit((a + 128) / 255),
    clampUnit((b + 128) / 255),
  ];
}

/** Evaluates a decoded ICC LUT in normalized table coordinates. */
export function evaluateIccLut(lut: IccLut3D, input: ColorVector3): [number, number, number] {
  if (lut.type === "mAB" || lut.type === "mBA") return evaluateMultiFunctionLut(lut, input);
  const classic = lut as IccClassicLut3D;
  // ICC.1 lut8Type/lut16Type processing order is matrix, input tables, CLUT, output tables.
  const transformed = multiplyMatrixVector(classic.matrix, input).map(clampUnit) as [number, number, number];
  const tabled = transformed.map((value, channel) => sampleTable(classic.inputTables[channel], value)) as [number, number, number];
  const clutValue = sampleClut3D(
    classic.clut,
    [classic.gridPoints, classic.gridPoints, classic.gridPoints],
    tabled,
  );
  return clutValue.map((value, channel) => sampleTable(classic.outputTables[channel], value)) as [number, number, number];
}

function evaluateMultiFunctionLut(
  lut: IccMultiFunctionLut3D,
  input: ColorVector3,
): [number, number, number] {
  let value = input.map(clampUnit) as [number, number, number];
  if (lut.type === "mAB") {
    if (lut.aCurves) value = applyCurveSet(lut.aCurves, value);
    if (lut.clut) value = sampleClut3D(lut.clut.values, lut.clut.gridPoints, value);
    if (lut.mCurves) value = applyCurveSet(lut.mCurves, value);
    if (lut.matrix) value = applyMultiFunctionMatrix(lut.matrix, value);
    return applyCurveSet(lut.bCurves, value);
  }
  value = applyCurveSet(lut.bCurves, value);
  if (lut.matrix) value = applyMultiFunctionMatrix(lut.matrix, value);
  if (lut.mCurves) value = applyCurveSet(lut.mCurves, value);
  if (lut.clut) value = sampleClut3D(lut.clut.values, lut.clut.gridPoints, value);
  if (lut.aCurves) value = applyCurveSet(lut.aCurves, value);
  return value;
}

function applyCurveSet(
  curves: readonly [ToneCurve, ToneCurve, ToneCurve],
  input: ColorVector3,
): [number, number, number] {
  return input.map((value, channel) => clampUnit(evaluateToneCurve(curves[channel], clampUnit(value)))) as [number, number, number];
}

function applyMultiFunctionMatrix(
  matrix: NonNullable<IccMultiFunctionLut3D["matrix"]>,
  input: ColorVector3,
): [number, number, number] {
  const transformed = multiplyMatrixVector(matrix.coefficients, input);
  return transformed.map((value, channel) => clampUnit(value + matrix.offset[channel])) as [number, number, number];
}

function sampleClut3D(
  clut: Float32Array,
  gridPoints: readonly [number, number, number],
  input: ColorVector3,
): [number, number, number] {
  const positions = input.map((value, channel) => clampUnit(value) * (gridPoints[channel] - 1));
  const lower = positions.map((value, channel) => Math.min(gridPoints[channel] - 1, Math.floor(value)));
  const upper = lower.map((value, channel) => Math.min(gridPoints[channel] - 1, value + 1));
  const fractions = positions.map((value, channel) => value - lower[channel]);
  const clutValue = [0, 0, 0];
  for (let redSide = 0; redSide <= 1; redSide += 1) {
    const red = redSide ? upper[0] : lower[0];
    const redWeight = redSide ? fractions[0] : 1 - fractions[0];
    for (let greenSide = 0; greenSide <= 1; greenSide += 1) {
      const green = greenSide ? upper[1] : lower[1];
      const greenWeight = greenSide ? fractions[1] : 1 - fractions[1];
      for (let blueSide = 0; blueSide <= 1; blueSide += 1) {
        const blue = blueSide ? upper[2] : lower[2];
        const weight = redWeight * greenWeight * (blueSide ? fractions[2] : 1 - fractions[2]);
        const offset = ((red * gridPoints[1] + green) * gridPoints[2] + blue) * 3;
        for (let channel = 0; channel < 3; channel += 1) clutValue[channel] += clut[offset + channel] * weight;
      }
    }
  }
  return clutValue as [number, number, number];
}

function sampleTable(table: Float32Array, value: number) {
  const position = clampUnit(value) * (table.length - 1);
  const lower = Math.floor(position);
  const upper = Math.min(table.length - 1, lower + 1);
  const fraction = position - lower;
  return table[lower] * (1 - fraction) + table[upper] * fraction;
}

function clampUnit(value: number) {
  return Math.max(0, Math.min(1, value));
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
