import {
  D50_WHITE,
  D65_WHITE,
  deltaE76,
  multiplyColorMatrices,
  multiplyMatrixVector,
  rgbPrimariesToXyzMatrix,
  type ColorMatrix3,
  type ColorVector3,
  type ColorVector4,
} from "./color-math";
import {
  IDENTITY_TONE_CURVE,
  ICC_XYZ_LUT_SCALE,
  createMatrixTrcProfile,
  evaluateIccLut,
  evaluateToneCurve,
  iccLabNormalizedToXyz,
  invertToneCurve,
  xyzToIccLabNormalized,
  type ColorProfile,
  type IccLut3D,
  type RenderingIntent,
  type ToneCurve,
} from "./icc-profile";
import type { WorkingColorSpace } from "./color";

export type ColorTransformOptions = {
  readonly renderingIntent?: RenderingIntent;
  readonly blackPointCompensation?: boolean;
};

export type ColorTransformMetadata = {
  readonly sourceProfileId: string;
  readonly destinationProfileId: string;
  readonly requestedIntent: RenderingIntent;
  readonly effectiveIntent: RenderingIntent | "mixed";
  readonly intentFallback: null | string;
  readonly blackPointCompensation: "disabled" | "heuristic";
  readonly extendedRange: "linear-extrapolated" | "clamped";
  readonly alpha: "preserved-straight";
};

export type ColorTransform = {
  readonly metadata: ColorTransformMetadata;
  applyRgb(rgb: ColorVector3): [number, number, number];
  applyRgba(rgba: ColorVector4): [number, number, number, number];
  applyRgbaBuffer(input: Float32Array, output?: Float32Array): Float32Array;
  toPcs(rgb: ColorVector3): [number, number, number];
  fromPcs(xyz: ColorVector3): [number, number, number];
};

export type GpuColorTransformCompilation = {
  readonly supported: true;
  readonly matrix: ColorMatrix3;
  /** RGB-interleaved 1D tables over [0, 1]. */
  readonly sourceDecodeLut: Float32Array;
  readonly destinationEncodeLut: Float32Array;
  readonly lutSize: number;
  readonly metadata: {
    readonly interpolation: "linear";
    readonly extendedRange: "linear-endpoint-extrapolation";
    readonly alpha: "preserve-unmodified";
    readonly requestedIntent: RenderingIntent;
    readonly effectiveIntent: "relative-colorimetric" | "absolute-colorimetric";
  };
} | {
  readonly supported: false;
  readonly reason: string;
};

export class UnsupportedColorProfileError extends Error {
  readonly profile: ColorProfile;

  constructor(profile: ColorProfile) {
    super(profile.capabilities.fallback?.reason ?? `Profile ${profile.name} cannot be transformed.`);
    this.name = "UnsupportedColorProfileError";
    this.profile = profile;
  }
}

export function createColorTransform(
  source: ColorProfile,
  destination: ColorProfile,
  options: ColorTransformOptions = {},
): ColorTransform {
  assertSourceTransformable(source);
  assertDestinationTransformable(destination);
  const requestedIntent = options.renderingIntent ?? source.defaultRenderingIntent;
  const absolute = requestedIntent === "absolute-colorimetric";
  const sourceLut = selectIntentLut(source.lutToPcs, requestedIntent, Boolean(source.matrixToPcs && source.trc));
  const destinationLut = selectIntentLut(destination.lutFromPcs, requestedIntent, Boolean(destination.matrixFromPcs && destination.trc));
  const sourceNativeIntent = requestedIntent === "relative-colorimetric"
    ? sourceLut.intent === "relative-colorimetric" || !sourceLut.lut
    : sourceLut.intent === requestedIntent;
  const destinationNativeIntent = requestedIntent === "relative-colorimetric"
    ? destinationLut.intent === "relative-colorimetric" || !destinationLut.lut
    : destinationLut.intent === requestedIntent;
  const nativeRequestedIntent = sourceNativeIntent && destinationNativeIntent;
  const effectiveIntent: RenderingIntent | "mixed" = absolute
    ? "absolute-colorimetric"
    : nativeRequestedIntent
      ? requestedIntent
      : sourceNativeIntent || destinationNativeIntent
        ? "mixed"
      : "relative-colorimetric";
  const fallbackReasons: string[] = [];
  if ((requestedIntent === "perceptual" || requestedIntent === "saturation") && !nativeRequestedIntent) {
    const missing = !sourceNativeIntent && !destinationNativeIntent
      ? "source and destination profiles"
      : !sourceNativeIntent ? "source profile" : "destination profile";
    fallbackReasons.push(`The ${missing} lacked native ${requestedIntent} tables; those stages used media-relative colorimetric processing.`);
  }
  if (sourceLut.lut && sourceLut.intent !== (absolute ? "relative-colorimetric" : requestedIntent)) {
    fallbackReasons.push(`The source profile used its ${sourceLut.intent} table.`);
  }
  if (destinationLut.lut && destinationLut.intent !== (absolute ? "relative-colorimetric" : requestedIntent)) {
    fallbackReasons.push(`The destination profile used its ${destinationLut.intent} table.`);
  }
  if (absolute) fallbackReasons.push("Absolute colorimetry is derived from media-relative data using profile white points.");
  const intentFallback = fallbackReasons.length ? fallbackReasons.join(" ") : null;
  const useBpc = Boolean(options.blackPointCompensation && !absolute);

  const toPcs = (rgb: ColorVector3) => {
    if (sourceLut.lut) {
      const encoded = evaluateIccLut(sourceLut.lut, rgb);
      return source.connectionSpace === "Lab"
        ? iccLabNormalizedToXyz(encoded)
        : encoded.map((value) => value * ICC_XYZ_LUT_SCALE) as [number, number, number];
    }
    return multiplyMatrixVector(source.matrixToPcs!, [
      evaluateToneCurve(source.trc![0], rgb[0]),
      evaluateToneCurve(source.trc![1], rgb[1]),
      evaluateToneCurve(source.trc![2], rgb[2]),
    ]);
  };
  const fromPcs = (xyz: ColorVector3) => {
    if (destinationLut.lut) {
      return evaluateIccLut(
        destinationLut.lut,
        destination.connectionSpace === "Lab"
          ? xyzToIccLabNormalized(xyz)
          : xyz.map((value) => value / ICC_XYZ_LUT_SCALE) as [number, number, number],
      );
    }
    const linear = multiplyMatrixVector(destination.matrixFromPcs!, xyz);
    return [
      invertToneCurve(destination.trc![0], linear[0]),
      invertToneCurve(destination.trc![1], linear[1]),
      invertToneCurve(destination.trc![2], linear[2]),
    ] as [number, number, number];
  };
  const applyRgb = (rgb: ColorVector3) => {
    let pcs = toPcs(rgb);
    if (absolute) pcs = applyAbsoluteWhiteScaling(pcs, source.mediaWhitePoint, destination.mediaWhitePoint);
    else if (useBpc) pcs = applyBlackPointCompensation(pcs, source.mediaBlackPoint, destination.mediaBlackPoint);
    return fromPcs(pcs);
  };

  return {
    metadata: {
      sourceProfileId: source.id,
      destinationProfileId: destination.id,
      requestedIntent,
      effectiveIntent,
      intentFallback,
      blackPointCompensation: useBpc ? "heuristic" : "disabled",
      extendedRange: sourceLut.lut || destinationLut.lut ? "clamped" : "linear-extrapolated",
      alpha: "preserved-straight",
    },
    applyRgb,
    applyRgba: (rgba) => {
      const rgb = applyRgb([rgba[0], rgba[1], rgba[2]]);
      return [rgb[0], rgb[1], rgb[2], rgba[3]];
    },
    applyRgbaBuffer: (input, output = new Float32Array(input.length)) => {
      if (input.length % 4 !== 0) throw new Error("RGBA color buffers must contain a multiple of four values.");
      if (output.length < input.length) throw new Error("Destination color buffer is too small.");
      for (let offset = 0; offset < input.length; offset += 4) {
        const converted = applyRgb([input[offset], input[offset + 1], input[offset + 2]]);
        output[offset] = converted[0];
        output[offset + 1] = converted[1];
        output[offset + 2] = converted[2];
        output[offset + 3] = input[offset + 3];
      }
      return output;
    },
    toPcs,
    fromPcs,
  };
}

/** Compiles a matrix plus paired 1D TRC textures for a GPU compositor. */
export function compileGpuColorTransform(
  source: ColorProfile,
  destination: ColorProfile,
  options: ColorTransformOptions = {},
  lutSize = 4096,
): GpuColorTransformCompilation {
  if (!source.matrixToPcs || !source.trc || !destination.matrixFromPcs || !destination.trc) {
    return {
      supported: false,
      reason: "Classic ICC 3D LUT profiles require a 3D texture pipeline; this GPU descriptor supports matrix/TRC transforms only.",
    };
  }
  if (!Number.isInteger(lutSize) || lutSize < 2 || lutSize > 65536) {
    throw new Error("GPU color transform LUT size must be an integer from 2 through 65536.");
  }
  const requestedIntent = options.renderingIntent ?? source.defaultRenderingIntent;
  const absolute = requestedIntent === "absolute-colorimetric";
  const sourceBlackY = source.mediaBlackPoint[1];
  const destinationBlackY = destination.mediaBlackPoint[1];
  if (options.blackPointCompensation && !absolute && Math.abs(sourceBlackY - destinationBlackY) > 1e-9) {
    return {
      supported: false,
      reason: "The matrix/1D-LUT GPU descriptor cannot represent luminance-dependent black-point compensation.",
    };
  }

  let connectionAdjustment: ColorMatrix3 = [
    1, 0, 0,
    0, 1, 0,
    0, 0, 1,
  ];
  if (absolute) {
    connectionAdjustment = [
      source.mediaWhitePoint[0] / Math.max(1e-9, destination.mediaWhitePoint[0]), 0, 0,
      0, source.mediaWhitePoint[1] / Math.max(1e-9, destination.mediaWhitePoint[1]), 0,
      0, 0, source.mediaWhitePoint[2] / Math.max(1e-9, destination.mediaWhitePoint[2]),
    ];
  }
  const matrix = multiplyColorMatrices(
    destination.matrixFromPcs!,
    multiplyColorMatrices(connectionAdjustment, source.matrixToPcs!),
  );
  const sourceDecodeLut = new Float32Array(lutSize * 3);
  const destinationEncodeLut = new Float32Array(lutSize * 3);
  for (let index = 0; index < lutSize; index += 1) {
    const value = index / (lutSize - 1);
    for (let channel = 0; channel < 3; channel += 1) {
      sourceDecodeLut[index * 3 + channel] = evaluateToneCurve(source.trc![channel], value);
      destinationEncodeLut[index * 3 + channel] = invertToneCurve(destination.trc![channel], value);
    }
  }
  return {
    supported: true,
    matrix,
    sourceDecodeLut,
    destinationEncodeLut,
    lutSize,
    metadata: {
      interpolation: "linear",
      extendedRange: "linear-endpoint-extrapolation",
      alpha: "preserve-unmodified",
      requestedIntent,
      effectiveIntent: absolute ? "absolute-colorimetric" : "relative-colorimetric",
    },
  };
}

function assertSourceTransformable(profile: ColorProfile) {
  if (!profile.capabilities.canUseAsSource || (!profile.matrixToPcs || !profile.trc) && Object.keys(profile.lutToPcs).length === 0) {
    throw new UnsupportedColorProfileError(profile);
  }
}

function assertDestinationTransformable(profile: ColorProfile) {
  if (!profile.capabilities.canUseAsDestination || (!profile.matrixFromPcs || !profile.trc) && Object.keys(profile.lutFromPcs).length === 0) {
    throw new UnsupportedColorProfileError(profile);
  }
}

function selectIntentLut(
  tables: Readonly<Partial<Record<RenderingIntent, IccLut3D>>>,
  requested: RenderingIntent,
  hasMatrixFallback: boolean,
): { lut: IccLut3D | null; intent: RenderingIntent | null } {
  const desired = requested === "absolute-colorimetric" ? "relative-colorimetric" : requested;
  if (tables[desired]) return { lut: tables[desired]!, intent: desired };
  if (hasMatrixFallback) return { lut: null, intent: null };
  for (const fallback of ["relative-colorimetric", "perceptual", "saturation"] as const) {
    if (tables[fallback]) return { lut: tables[fallback]!, intent: fallback };
  }
  return { lut: null, intent: null };
}

function applyAbsoluteWhiteScaling(
  pcs: ColorVector3,
  sourceMediaWhite: ColorVector3,
  destinationMediaWhite: ColorVector3,
): [number, number, number] {
  return pcs.map((value, index) => {
    const sourceAbsolute = value * sourceMediaWhite[index] / D50_WHITE[index];
    return sourceAbsolute * D50_WHITE[index] / Math.max(1e-9, destinationMediaWhite[index]);
  }) as [number, number, number];
}

/**
 * A conservative luminance-only BPC primitive for matrix/TRC transforms.
 * Full ICC black-point compensation requires a CMM and profile intent tables.
 */
function applyBlackPointCompensation(
  pcs: ColorVector3,
  sourceBlack: ColorVector3,
  destinationBlack: ColorVector3,
): [number, number, number] {
  const sourceY = Math.max(0, Math.min(0.999999, sourceBlack[1]));
  const destinationY = Math.max(0, Math.min(0.999999, destinationBlack[1]));
  if (Math.abs(sourceY - destinationY) < 1e-9) return [...pcs];
  const normalized = (pcs[1] - sourceY) / (1 - sourceY);
  const mappedY = destinationY + normalized * (1 - destinationY);
  if (Math.abs(pcs[1]) < 1e-12) return [pcs[0], mappedY, pcs[2]];
  const luminanceScale = mappedY / pcs[1];
  return [pcs[0] * luminanceScale, mappedY, pcs[2] * luminanceScale];
}

export class ColorTransformCache {
  readonly #entries = new Map<string, ColorTransform>();
  #hits = 0;
  #misses = 0;

  get(
    source: ColorProfile,
    destination: ColorProfile,
    options: ColorTransformOptions = {},
  ) {
    const key = transformCacheKey(source, destination, options);
    const cached = this.#entries.get(key);
    if (cached) {
      this.#hits += 1;
      return cached;
    }
    this.#misses += 1;
    const transform = createColorTransform(source, destination, options);
    this.#entries.set(key, transform);
    return transform;
  }

  clear() {
    this.#entries.clear();
    this.#hits = 0;
    this.#misses = 0;
  }

  get stats() {
    return { size: this.#entries.size, hits: this.#hits, misses: this.#misses } as const;
  }
}

function transformCacheKey(source: ColorProfile, destination: ColorProfile, options: ColorTransformOptions) {
  return [
    source.id,
    destination.id,
    options.renderingIntent ?? source.defaultRenderingIntent,
    options.blackPointCompensation ? "bpc" : "no-bpc",
  ].join("\u0000");
}

export class ColorProfileRegistry {
  readonly #profiles = new Map<string, ColorProfile>();
  readonly transforms = new ColorTransformCache();

  constructor(profiles: readonly ColorProfile[] = BUILTIN_COLOR_PROFILES) {
    for (const profile of profiles) this.#profiles.set(profile.id, profile);
  }

  register(profile: ColorProfile, options: { replace?: boolean } = {}) {
    if (this.#profiles.has(profile.id) && !options.replace) {
      throw new Error(`Color profile '${profile.id}' is already registered.`);
    }
    this.#profiles.set(profile.id, profile);
    this.transforms.clear();
    return profile;
  }

  unregister(profileId: string) {
    const deleted = this.#profiles.delete(profileId);
    if (deleted) this.transforms.clear();
    return deleted;
  }

  get(profileId: string) {
    return this.#profiles.get(profileId);
  }

  require(profileId: string) {
    const profile = this.get(profileId);
    if (!profile) throw new Error(`Unknown color profile '${profileId}'.`);
    return profile;
  }

  list() {
    return [...this.#profiles.values()];
  }

  createTransform(sourceId: string, destinationId: string, options: ColorTransformOptions = {}) {
    return this.transforms.get(this.require(sourceId), this.require(destinationId), options);
  }
}

export type ProofingOptions = ColorTransformOptions & {
  readonly gamutTolerance?: number;
};

export type ProofingResult = {
  readonly rgba: [number, number, number, number];
  readonly proofDeviceRgb: [number, number, number];
  readonly outOfGamut: boolean;
  readonly deltaE76: number;
};

export type ProofingTransform = {
  readonly metadata: {
    readonly sourceProfileId: string;
    readonly proofProfileId: string;
    readonly displayProfileId: string;
    readonly renderingIntent: RenderingIntent;
    readonly gamutCheck: "proof-device-domain-and-deltaE76";
    readonly clipping: "proof-simulation-only";
  };
  applyRgba(rgba: ColorVector4): ProofingResult;
};

/** Creates a non-destructive proof transform; clipping occurs only inside the simulated proof device. */
export function createProofingTransform(
  source: ColorProfile,
  proof: ColorProfile,
  display: ColorProfile,
  options: ProofingOptions = {},
): ProofingTransform {
  const intent = options.renderingIntent ?? "relative-colorimetric";
  const toProof = createColorTransform(source, proof, { ...options, renderingIntent: intent });
  const proofToDisplay = createColorTransform(proof, display, { renderingIntent: "relative-colorimetric" });
  const gamutTolerance = options.gamutTolerance ?? 1e-7;
  return {
    metadata: {
      sourceProfileId: source.id,
      proofProfileId: proof.id,
      displayProfileId: display.id,
      renderingIntent: intent,
      gamutCheck: "proof-device-domain-and-deltaE76",
      clipping: "proof-simulation-only",
    },
    applyRgba: (rgba) => {
      const sourceRgb: ColorVector3 = [rgba[0], rgba[1], rgba[2]];
      const proofDeviceRgb = toProof.applyRgb(sourceRgb);
      const intendedPcs = proofToDisplay.toPcs(proofDeviceRgb);
      const outOfDomain = proofDeviceRgb.some((value) => value < -gamutTolerance || value > 1 + gamutTolerance);
      const clippedProof = proofDeviceRgb.map(clampUnit) as [number, number, number];
      const simulatedPcs = proofToDisplay.toPcs(clippedProof);
      const displayRgb = proofToDisplay.applyRgb(clippedProof);
      const difference = deltaE76(intendedPcs, simulatedPcs);
      return {
        rgba: [displayRgb[0], displayRgb[1], displayRgb[2], rgba[3]],
        proofDeviceRgb,
        outOfGamut: outOfDomain || difference > gamutTolerance,
        deltaE76: difference,
      };
    },
  };
}

function clampUnit(value: number) {
  return Math.min(1, Math.max(0, value));
}

const SRGB_TRC: ToneCurve = {
  kind: "parametric",
  functionType: 4,
  parameters: [2.4, 1 / 1.055, 0.055 / 1.055, 1 / 12.92, 0.04045, 0, 0],
};

const REC2020_ALPHA = 1.09929682680944;
const REC2020_BETA = 0.018053968510807;
const REC2020_TRC: ToneCurve = {
  kind: "parametric",
  functionType: 4,
  parameters: [
    1 / 0.45,
    1 / REC2020_ALPHA,
    (REC2020_ALPHA - 1) / REC2020_ALPHA,
    1 / 4.5,
    REC2020_BETA * 4.5,
    0,
    0,
  ],
};

const PROPHOTO_TRC: ToneCurve = {
  kind: "parametric",
  functionType: 3,
  parameters: [1.8, 1, 0, 1 / 16, 1 / 32],
};

export const SRGB_PROFILE = createMatrixTrcProfile({
  id: "builtin:srgb",
  name: "sRGB IEC 61966-2-1",
  source: "builtin",
  description: "D65 sRGB primaries and transfer function, adapted to D50 PCS.",
  matrixToXyz: rgbPrimariesToXyzMatrix([0.64, 0.33], [0.3, 0.6], [0.15, 0.06], D65_WHITE),
  referenceWhite: D65_WHITE,
  trc: SRGB_TRC,
});

export const LINEAR_SRGB_PROFILE = createMatrixTrcProfile({
  id: "builtin:linear-srgb",
  name: "Linear sRGB",
  source: "builtin",
  matrixToXyz: rgbPrimariesToXyzMatrix([0.64, 0.33], [0.3, 0.6], [0.15, 0.06], D65_WHITE),
  referenceWhite: D65_WHITE,
  trc: IDENTITY_TONE_CURVE,
});

export const DISPLAY_P3_PROFILE = createMatrixTrcProfile({
  id: "builtin:display-p3",
  name: "Display P3",
  source: "builtin",
  description: "Display-P3 D65 primaries with the sRGB transfer function, adapted to D50 PCS.",
  matrixToXyz: rgbPrimariesToXyzMatrix([0.68, 0.32], [0.265, 0.69], [0.15, 0.06], D65_WHITE),
  referenceWhite: D65_WHITE,
  trc: SRGB_TRC,
});

export const LINEAR_DISPLAY_P3_PROFILE = createMatrixTrcProfile({
  id: "builtin:linear-display-p3",
  name: "Linear Display P3",
  source: "builtin",
  description: "Linear-light Display-P3 working space, adapted to D50 PCS.",
  matrixToXyz: rgbPrimariesToXyzMatrix([0.68, 0.32], [0.265, 0.69], [0.15, 0.06], D65_WHITE),
  referenceWhite: D65_WHITE,
  trc: IDENTITY_TONE_CURVE,
});

export const ADOBE_RGB_1998_PROFILE = createMatrixTrcProfile({
  id: "builtin:adobe-rgb-1998",
  name: "Adobe RGB (1998)",
  source: "builtin",
  matrixToXyz: rgbPrimariesToXyzMatrix([0.64, 0.33], [0.21, 0.71], [0.15, 0.06], D65_WHITE),
  referenceWhite: D65_WHITE,
  trc: { kind: "gamma", gamma: 563 / 256 },
});

export const REC2020_PROFILE = createMatrixTrcProfile({
  id: "builtin:rec2020",
  name: "ITU-R BT.2020",
  source: "builtin",
  matrixToXyz: rgbPrimariesToXyzMatrix([0.708, 0.292], [0.17, 0.797], [0.131, 0.046], D65_WHITE),
  referenceWhite: D65_WHITE,
  trc: REC2020_TRC,
});

export const PROPHOTO_RGB_PROFILE = createMatrixTrcProfile({
  id: "builtin:prophoto-rgb",
  name: "ProPhoto RGB",
  source: "builtin",
  matrixToXyz: rgbPrimariesToXyzMatrix([0.7347, 0.2653], [0.1596, 0.8404], [0.0366, 0.0001], D50_WHITE),
  referenceWhite: D50_WHITE,
  trc: PROPHOTO_TRC,
});

export const BUILTIN_COLOR_PROFILES = [
  SRGB_PROFILE,
  LINEAR_SRGB_PROFILE,
  DISPLAY_P3_PROFILE,
  LINEAR_DISPLAY_P3_PROFILE,
  ADOBE_RGB_1998_PROFILE,
  REC2020_PROFILE,
  PROPHOTO_RGB_PROFILE,
] as const;

export const defaultColorProfileRegistry = new ColorProfileRegistry();

/** Maps Luma's linear-light tile labels onto destination profiles for ingestion transforms. */
export function profileForWorkingColorSpace(space: WorkingColorSpace) {
  return space === "display-p3" ? LINEAR_DISPLAY_P3_PROFILE : LINEAR_SRGB_PROFILE;
}
