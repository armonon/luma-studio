export type BrushPoint = {
  x: number;
  y: number;
  p: number;
  /** Monotonic pointer timestamp in milliseconds, used only by live smoothing. */
  time?: number;
  /** Pointer tilt in degrees, normally -90..90. */
  tiltX?: number;
  tiltY?: number;
  /** Stylus azimuth in radians. Derived from tilt when omitted. */
  azimuth?: number;
};

export type PressureCurvePoint = { input: number; output: number };

export type BrushSymmetry = {
  centerX: number;
  centerY: number;
  horizontal?: boolean;
  vertical?: boolean;
  radialSegments?: number;
  mirrorAlternating?: boolean;
};

export type BrushTexture = {
  strength: number;
  scale: number;
  seed?: number;
};

export type ImageBrushMode = "color" | "tint" | "stencil" | "material";

/** Immutable sampled image used as a full-colour or colorized brush tip. */
export type ImageBrushTip = {
  id: string;
  name: string;
  width: number;
  height: number;
  data: Uint8ClampedArray;
  /** Optional copy converted into the current document's linear working space. */
  workingData?: Float32Array;
  mode: ImageBrushMode;
};

export type BrushBlendMode = "normal" | "multiply" | "screen" | "overlay";

export type BrushParams = {
  size: number;
  hardness: number;
  /** Maximum opacity of the completed stroke when `flow` is supplied. */
  opacity: number;
  /** Paint deposited by each dab. Omit for legacy opacity-as-flow behavior. */
  flow?: number;
  color: string;
  spacing?: number;
  roundness?: number;
  angle?: number;
  pressureSize?: boolean;
  pressureOpacity?: boolean;
  pressureCurve?: number | ReadonlyArray<PressureCurvePoint>;
  minimumPressureSize?: number;
  smoothing?: number;
  tiltInfluence?: number;
  scatter?: number;
  texture?: BrushTexture;
  imageTip?: ImageBrushTip;
  symmetry?: BrushSymmetry;
  blendMode?: BrushBlendMode;
  /** False makes overlapping dabs behave like an airbrush-disabled solid stroke. */
  buildUp?: boolean;
  seed?: number;
  mode: "paint" | "erase" | "mask-add" | "mask-remove";
};

export type Stroke = {
  layerId: string;
  params: BrushParams;
  points: BrushPoint[];
  seed?: number;
};

export type BrushDab = {
  x: number;
  y: number;
  size: number;
  hardness: number;
  roundness: number;
  rotation: number;
  opacity: number;
  pressure: number;
  index: number;
  textureSeed: number;
};

export type RgbaSurface = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  /** Full-document origin, allowing the replay engine to target one tile. */
  originX?: number;
  originY?: number;
};

export type FloatRgbaSurface = {
  width: number;
  height: number;
  data: Float32Array;
  originX?: number;
  originY?: number;
};

/** Per-tile stroke coverage; retained only for the active stroke, never history. */
export type BrushCoverageCache = {
  coverage?: Float32Array;
  alpha?: Float32Array;
  premultiplied?: Float32Array;
};

/** Bound both the event's work list and its sparse tile fan-out before painting. */
export function brushTileBatches(dabs: readonly BrushDab[], grid: {
  tilesIntersecting(rect: { x: number; y: number; width: number; height: number }): Array<{ key: string }>;
}) {
  const batches = new Map<string, BrushDab[]>();
  let references = 0;
  for (const dab of dabs) {
    const radius = dab.size / 2 + 2;
    for (const tile of grid.tilesIntersecting({ x: dab.x - radius, y: dab.y - radius, width: radius * 2, height: radius * 2 })) {
      if (++references > 131_072) throw new Error("Brush sample exceeds its tile-work limit; reduce brush size or symmetry");
      const batch = batches.get(tile.key);
      if (batch) batch.push(dab); else batches.set(tile.key, [dab]);
    }
  }
  return batches;
}

export function validBrushPoint(point: BrushPoint) {
  return Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.p);
}

/** Mouse/touch have no usable force; pen zero must remain zero, not half pressure. */
export function brushPointerPressure(pointer: { pointerType?: string; pressure?: number }) {
  if (pointer.pointerType === "mouse" || pointer.pointerType === "touch") return 1;
  return Number.isFinite(pointer.pressure) ? Math.max(0, Math.min(1, pointer.pressure!)) : 1;
}

export function smoothBrushPoint(previous: BrushPoint, point: BrushPoint, amount = 0): BrushPoint {
  const smoothing = Math.max(0, Math.min(0.95, Number.isFinite(amount) ? amount : 0));
  if (!smoothing) return point;
  const elapsed = point.time !== undefined && previous.time !== undefined && point.time > previous.time
    ? Math.min(100, point.time - previous.time) : 1000 / 60;
  const response = 1 - Math.pow(smoothing * 0.9, elapsed / (1000 / 60));
  return { ...point,
    x: previous.x + (point.x - previous.x) * response,
    y: previous.y + (point.y - previous.y) * response,
    // Pressure stays independent: spatial stabilization must not erase pen dynamics.
    azimuth: interpolateAngle(previous.azimuth, point.azimuth, response),
  };
}

const TAU = Math.PI * 2;

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.max(minimum, Math.min(maximum, value));
}

function finite(value: number, fallback: number) {
  return Number.isFinite(value) ? value : fallback;
}

function hash32(value: number) {
  let hash = value >>> 0;
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

function randomAt(seed: number, index: number, channel: number) {
  return hash32((seed >>> 0) ^ Math.imul(index + 1, 0x9e3779b1) ^ Math.imul(channel + 1, 0x85ebca6b)) /
    0x1_0000_0000;
}

export function evaluatePressureCurve(
  pressure: number,
  curve: BrushParams["pressureCurve"],
) {
  const input = clamp(finite(pressure, 0.5));
  if (typeof curve === "number") return input ** clamp(finite(curve, 1), 0.05, 8);
  if (!curve?.length) return input;
  const points = curve
    .map((point) => ({ input: clamp(point.input), output: clamp(point.output) }))
    .sort((a, b) => a.input - b.input);
  if (input <= points[0].input) return points[0].output;
  for (let i = 1; i < points.length; i += 1) {
    const right = points[i];
    const left = points[i - 1];
    if (input <= right.input) {
      const width = right.input - left.input;
      if (width <= 0) return right.output;
      const t = (input - left.input) / width;
      return left.output + (right.output - left.output) * t;
    }
  }
  return points[points.length - 1].output;
}

function baseDab(point: BrushPoint, params: BrushParams, index: number): BrushDab {
  const pressure = evaluatePressureCurve(point.p, params.pressureCurve);
  const minimumSize = clamp(finite(params.minimumPressureSize ?? 0.1, 0.1), 0.01, 1);
  const sizePressure = params.pressureSize === false ? 1 : minimumSize + (1 - minimumSize) * pressure;
  const opacityPressure = params.pressureOpacity === false ? 1 : pressure;
  const flow = clamp(finite(params.flow ?? params.opacity, 1));
  const tiltX = clamp(finite(point.tiltX ?? 0, 0), -90, 90);
  const tiltY = clamp(finite(point.tiltY ?? 0, 0), -90, 90);
  const tilt = clamp(Math.hypot(tiltX, tiltY) / 90);
  const tiltInfluence = clamp(finite(params.tiltInfluence ?? 0, 0));
  const azimuth = Number.isFinite(point.azimuth) ? point.azimuth! : Math.atan2(tiltY, tiltX);
  const seed = params.seed ?? 0;
  const size = Math.max(0.01, finite(params.size, 1) * sizePressure);
  const scatter = Math.max(0, finite(params.scatter ?? 0, 0)) * size;
  const angle = finite(params.angle ?? 0, 0) * Math.PI / 180 + azimuth * tiltInfluence;
  const normalOffset = (randomAt(seed, index, 0) * 2 - 1) * scatter;
  const tangentOffset = (randomAt(seed, index, 1) * 2 - 1) * scatter * 0.25;
  return {
    x: point.x + Math.cos(angle + Math.PI / 2) * normalOffset + Math.cos(angle) * tangentOffset,
    y: point.y + Math.sin(angle + Math.PI / 2) * normalOffset + Math.sin(angle) * tangentOffset,
    size,
    hardness: clamp(finite(params.hardness, 1)),
    roundness: clamp(
      finite(params.roundness ?? 1, 1) * (1 - tilt * tiltInfluence * 0.85),
      0.02,
      1,
    ),
    rotation: angle,
    opacity: flow * opacityPressure,
    pressure,
    index,
    textureSeed: hash32(seed ^ Math.imul(index + 1, 0x27d4eb2d) ^ (params.texture?.seed ?? 0)),
  };
}

function rotateDab(dab: BrushDab, centerX: number, centerY: number, angle: number): BrushDab {
  const dx = dab.x - centerX;
  const dy = dab.y - centerY;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return {
    ...dab,
    x: centerX + dx * cosine - dy * sine,
    y: centerY + dx * sine + dy * cosine,
    rotation: dab.rotation + angle,
  };
}

export function applyBrushSymmetry(dab: BrushDab, symmetry?: BrushSymmetry) {
  if (!symmetry) return [dab];
  const mirrored = [dab];
  if (symmetry.horizontal) {
    mirrored.push({
      ...dab,
      x: symmetry.centerX * 2 - dab.x,
      rotation: Math.PI - dab.rotation,
    });
  }
  if (symmetry.vertical) {
    for (const source of [...mirrored]) {
      mirrored.push({
        ...source,
        y: symmetry.centerY * 2 - source.y,
        rotation: -source.rotation,
      });
    }
  }
  const segments = Math.round(clamp(finite(symmetry.radialSegments ?? 1, 1), 1, 16));
  const result: BrushDab[] = [];
  for (let segment = 0; segment < segments; segment += 1) {
    const angle = TAU * segment / segments;
    for (const source of mirrored) {
      const rotated = rotateDab(source, symmetry.centerX, symmetry.centerY, angle);
      if (symmetry.mirrorAlternating && segment % 2 === 1) {
        rotated.x = symmetry.centerX * 2 - rotated.x;
        rotated.rotation = Math.PI - rotated.rotation;
      }
      result.push(rotated);
    }
  }
  const unique = new Map<string, BrushDab>();
  for (const candidate of result) {
    // An elliptical dab is unchanged by a half-turn, so canonicalize rotation
    // to prevent symmetry axes from depositing the exact same dab twice.
    const canonicalRotation = ((candidate.rotation % Math.PI) + Math.PI) % Math.PI;
    const key = `${candidate.x.toFixed(6)}:${candidate.y.toFixed(6)}:${canonicalRotation.toFixed(6)}`;
    if (!unique.has(key)) unique.set(key, candidate);
  }
  return [...unique.values()];
}

/**
 * Stateful spacing interpolator. Its carry is retained across pointer event
 * boundaries, so the same geometric stroke replays identically regardless of
 * how input points were packetized.
 */
export class BrushStrokePlanner {
  private previous: BrushPoint | null = null;
  private distanceToNext = 0;
  private dabIndex = 0;

  constructor(readonly params: BrushParams) {}

  start(point: BrushPoint, includeInitial = true) {
    if (!validBrushPoint(point)) throw new Error("Invalid brush coordinates or pressure");
    this.previous = { ...point };
    if (!includeInitial) {
      const preview = baseDab(point, this.params, this.dabIndex);
      this.distanceToNext = this.spacingFor(preview);
      return [];
    }
    const dabs = this.makeDabs(point);
    this.distanceToNext = this.spacingFor(dabs[0]);
    return dabs;
  }

  add(point: BrushPoint) {
    if (!validBrushPoint(point)) throw new Error("Invalid brush coordinates or pressure");
    if (!this.previous) return this.start(point);
    const from = this.previous;
    const dx = point.x - from.x;
    const dy = point.y - from.y;
    const distance = Math.hypot(dx, dy);
    const dabs: BrushDab[] = [];
    if (distance > 0) {
      let cursor = this.distanceToNext;
      while (cursor <= distance + 1e-9) {
        const t = cursor / distance;
        const interpolated: BrushPoint = {
          x: from.x + dx * t,
          y: from.y + dy * t,
          p: from.p + (point.p - from.p) * t,
          tiltX: (from.tiltX ?? 0) + ((point.tiltX ?? 0) - (from.tiltX ?? 0)) * t,
          tiltY: (from.tiltY ?? 0) + ((point.tiltY ?? 0) - (from.tiltY ?? 0)) * t,
          azimuth: interpolateAngle(from.azimuth, point.azimuth, t),
        };
        const emitted = this.makeDabs(interpolated);
        if (dabs.length + emitted.length > 16_384) throw new Error("Brush sample exceeds the 16,384-dab limit; reduce symmetry or increase spacing");
        dabs.push(...emitted);
        cursor += this.spacingFor(emitted[0]);
      }
      this.distanceToNext = cursor - distance;
    }
    this.previous = { ...point };
    return dabs;
  }

  snapshot() {
    return {
      previous: this.previous ? { ...this.previous } : null,
      distanceToNext: this.distanceToNext,
      dabIndex: this.dabIndex,
    };
  }

  private makeDabs(point: BrushPoint) {
    const dab = baseDab(point, this.params, this.dabIndex++);
    return applyBrushSymmetry(dab, this.params.symmetry);
  }

  private spacingFor(dab: BrushDab) {
    return Math.max(0.25, dab.size * clamp(finite(this.params.spacing ?? 0.15, 0.15), 0.01, 10));
  }
}

function interpolateAngle(from: number | undefined, to: number | undefined, t: number) {
  if (!Number.isFinite(from) && !Number.isFinite(to)) return undefined;
  const start = finite(from ?? to ?? 0, 0);
  const end = finite(to ?? from ?? 0, 0);
  const delta = Math.atan2(Math.sin(end - start), Math.cos(end - start));
  return start + delta * t;
}

export function planStroke(points: ReadonlyArray<BrushPoint>, params: BrushParams) {
  if (!points.length) return [];
  const planner = new BrushStrokePlanner(params);
  const dabs = planner.start(points[0]);
  for (let i = 1; i < points.length; i += 1) dabs.push(...planner.add(points[i]));
  return dabs;
}

export function parseBrushColor(color: string): [number, number, number] {
  const text = color.trim().toLowerCase();
  const short = /^#([\da-f])([\da-f])([\da-f])(?:[\da-f])?$/.exec(text);
  if (short) return [1, 2, 3].map((index) => parseInt(short[index] + short[index], 16)) as [number, number, number];
  const long = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})(?:[\da-f]{2})?$/.exec(text);
  if (long) return [1, 2, 3].map((index) => parseInt(long[index], 16)) as [number, number, number];
  const rgb = /^rgba?\(\s*([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)/.exec(text);
  if (rgb) return [clamp(Number(rgb[1]), 0, 255), clamp(Number(rgb[2]), 0, 255), clamp(Number(rgb[3]), 0, 255)];
  return [0, 0, 0];
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const t = clamp((value - edge0) / Math.max(1e-9, edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function textureAt(x: number, y: number, dab: BrushDab, texture?: BrushTexture) {
  if (!texture || texture.strength <= 0) return 1;
  const scale = Math.max(0.01, finite(texture.scale, 1));
  const xi = Math.floor(x * scale);
  const yi = Math.floor(y * scale);
  const noise = hash32(dab.textureSeed ^ Math.imul(xi, 0x1f123bb5) ^ Math.imul(yi, 0x5f356495)) /
    0x1_0000_0000;
  return 1 - clamp(texture.strength) + noise * clamp(texture.strength);
}

function validImageTip(tip: ImageBrushTip | undefined): tip is ImageBrushTip {
  return !!tip && Number.isInteger(tip.width) && Number.isInteger(tip.height) &&
    tip.width > 0 && tip.height > 0 && tip.width <= 2048 && tip.height <= 2048 &&
    tip.data.length === tip.width * tip.height * 4 &&
    (!tip.workingData || tip.workingData.length === tip.data.length);
}

function bilinearTipSample(tip: ImageBrushTip, u: number, v: number, working: boolean) {
  if (u < 0 || v < 0 || u > 1 || v > 1) return null;
  const x = u * Math.max(0, tip.width - 1);
  const y = v * Math.max(0, tip.height - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(tip.width - 1, x0 + 1);
  const y1 = Math.min(tip.height - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const source = working && tip.workingData ? tip.workingData : tip.data;
  const divisor = source === tip.data ? 255 : 1;
  const channel = (index: number) => {
    const a = source[(y0 * tip.width + x0) * 4 + index] / divisor;
    const b = source[(y0 * tip.width + x1) * 4 + index] / divisor;
    const c = source[(y1 * tip.width + x0) * 4 + index] / divisor;
    const d = source[(y1 * tip.width + x1) * 4 + index] / divisor;
    return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
  };
  // Alpha always comes from the display payload, even when RGB has a working copy.
  const alphaSource = tip.data;
  const alphaAt = (px: number, py: number) => alphaSource[(py * tip.width + px) * 4 + 3] / 255;
  const alpha = (alphaAt(x0, y0) + (alphaAt(x1, y0) - alphaAt(x0, y0)) * tx) * (1 - ty) +
    (alphaAt(x0, y1) + (alphaAt(x1, y1) - alphaAt(x0, y1)) * tx) * ty;
  const displayChannel = (index: number) => {
    const a = tip.data[(y0 * tip.width + x0) * 4 + index] / 255;
    const b = tip.data[(y0 * tip.width + x1) * 4 + index] / 255;
    const c = tip.data[(y1 * tip.width + x0) * 4 + index] / 255;
    const d = tip.data[(y1 * tip.width + x1) * 4 + index] / 255;
    return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
  };
  return {
    color: [channel(0), channel(1), channel(2)] as [number, number, number],
    displayLuminance: displayChannel(0) * 0.2126 + displayChannel(1) * 0.7152 + displayChannel(2) * 0.0722,
    alpha,
  };
}

function imageStrokeSource(
  surface: Pick<RgbaSurface, "width" | "height" | "originX" | "originY">,
  stroke: Stroke,
  paintColor: readonly [number, number, number],
  working: boolean,
  planned?: readonly BrushDab[],
  cache?: BrushCoverageCache,
) {
  const params = { ...stroke.params, seed: stroke.seed ?? stroke.params.seed ?? 0 };
  const tip = params.imageTip;
  if (!validImageTip(tip)) return null;
  const dabs = planned ?? planStroke(stroke.points, params);
  const alpha = cache?.alpha ?? new Float32Array(surface.width * surface.height);
  const premultiplied = cache?.premultiplied ?? new Float32Array(surface.width * surface.height * 3);
  if (cache) { cache.alpha = alpha; cache.premultiplied = premultiplied; }
  const buildUp = params.buildUp !== false;
  const originX = finite(surface.originX ?? 0, 0);
  const originY = finite(surface.originY ?? 0, 0);
  for (const dab of dabs) {
    const radius = dab.size / 2;
    if (radius <= 0) continue;
    const localCenterX = dab.x - originX;
    const localCenterY = dab.y - originY;
    const left = Math.max(0, Math.floor(localCenterX - radius - 1));
    const top = Math.max(0, Math.floor(localCenterY - radius - 1));
    const right = Math.min(surface.width, Math.ceil(localCenterX + radius + 1));
    const bottom = Math.min(surface.height, Math.ceil(localCenterY + radius + 1));
    const cosine = Math.cos(-dab.rotation);
    const sine = Math.sin(-dab.rotation);
    for (let y = top; y < bottom; y += 1) {
      for (let x = left; x < right; x += 1) {
        const dx = x + 0.5 - localCenterX;
        const dy = y + 0.5 - localCenterY;
        const localX = (dx * cosine - dy * sine) / Math.max(radius, 1e-9);
        const localY = (dx * sine + dy * cosine) / Math.max(radius * dab.roundness, 1e-9);
        const radial = Math.hypot(localX, localY);
        if (radial >= 1) continue;
        const sampled = bilinearTipSample(tip, localX * 0.5 + 0.5, localY * 0.5 + 0.5, working);
        if (!sampled) continue;
        const edge = 1 - smoothstep(dab.hardness, 1, radial);
        const stencil = tip.mode === "stencil" ? 1 - sampled.displayLuminance : 1;
        const deposit = clamp(dab.opacity * sampled.alpha * stencil * edge *
          textureAt(x + originX, y + originY, dab, params.texture));
        if (deposit <= 0) continue;
        const source = tip.mode === "color"
          ? sampled.color
          : tip.mode === "material"
            ? paintColor.map((channel) => clamp(channel * (0.35 + sampled.displayLuminance * 1.3))) as [number, number, number]
            : paintColor;
        const pixel = y * surface.width + x;
        const colorOffset = pixel * 3;
        if (!buildUp && deposit <= alpha[pixel]) continue;
        if (buildUp) {
          const remaining = 1 - deposit;
          premultiplied[colorOffset] = source[0] * deposit + premultiplied[colorOffset] * remaining;
          premultiplied[colorOffset + 1] = source[1] * deposit + premultiplied[colorOffset + 1] * remaining;
          premultiplied[colorOffset + 2] = source[2] * deposit + premultiplied[colorOffset + 2] * remaining;
          alpha[pixel] = deposit + alpha[pixel] * remaining;
        } else {
          premultiplied[colorOffset] = source[0] * deposit;
          premultiplied[colorOffset + 1] = source[1] * deposit;
          premultiplied[colorOffset + 2] = source[2] * deposit;
          alpha[pixel] = deposit;
        }
      }
    }
  }
  return { params, dabs, alpha, premultiplied };
}

/** Analytic dab coverage shared by the paint and retouch engines. */
export function brushDabOpacityAt(
  dab: BrushDab,
  documentX: number,
  documentY: number,
  params: Pick<BrushParams, "texture">,
) {
  const radius = dab.size / 2;
  if (radius <= 0) return 0;
  const dx = documentX - dab.x;
  const dy = documentY - dab.y;
  const cosine = Math.cos(-dab.rotation);
  const sine = Math.sin(-dab.rotation);
  const localX = (dx * cosine - dy * sine) / radius;
  const localY = (dx * sine + dy * cosine) / Math.max(radius * dab.roundness, 1e-9);
  const radial = Math.hypot(localX, localY);
  if (radial >= 1) return 0;
  const falloff = 1 - smoothstep(dab.hardness, 1, radial);
  return clamp(dab.opacity * falloff * textureAt(documentX, documentY, dab, params.texture));
}

function blendChannel(mode: BrushBlendMode, destination: number, source: number) {
  if (mode === "multiply") return destination * source;
  if (mode === "screen") return 1 - (1 - destination) * (1 - source);
  if (mode === "overlay") return destination <= 0.5 ? 2 * destination * source :
    1 - 2 * (1 - destination) * (1 - source);
  return source;
}

function strokeCoverage(
  surface: Pick<RgbaSurface, "width" | "height" | "originX" | "originY">,
  stroke: Stroke,
  planned?: readonly BrushDab[],
  cache?: BrushCoverageCache,
) {
  const params = { ...stroke.params, seed: stroke.seed ?? stroke.params.seed ?? 0 };
  const dabs = planned ?? planStroke(stroke.points, params);
  const coverage = cache?.coverage ?? new Float32Array(surface.width * surface.height);
  if (cache) cache.coverage = coverage;
  const buildUp = params.buildUp !== false;
  const originX = finite(surface.originX ?? 0, 0);
  const originY = finite(surface.originY ?? 0, 0);
  for (const dab of dabs) {
    const radius = dab.size / 2;
    const localCenterX = dab.x - originX;
    const localCenterY = dab.y - originY;
    const left = Math.max(0, Math.floor(localCenterX - radius - 1));
    const top = Math.max(0, Math.floor(localCenterY - radius - 1));
    const right = Math.min(surface.width, Math.ceil(localCenterX + radius + 1));
    const bottom = Math.min(surface.height, Math.ceil(localCenterY + radius + 1));
    const cosine = Math.cos(-dab.rotation);
    const sine = Math.sin(-dab.rotation);
    for (let y = top; y < bottom; y += 1) {
      for (let x = left; x < right; x += 1) {
        const dx = x + 0.5 - localCenterX;
        const dy = y + 0.5 - localCenterY;
        const localX = (dx * cosine - dy * sine) / Math.max(radius, 1e-9);
        const localY = (dx * sine + dy * cosine) / Math.max(radius * dab.roundness, 1e-9);
        const radial = Math.hypot(localX, localY);
        if (radial >= 1) continue;
        const falloff = 1 - smoothstep(dab.hardness, 1, radial);
        const alpha = clamp(dab.opacity * falloff * textureAt(x + originX, y + originY, dab, params.texture));
        const index = y * surface.width + x;
        coverage[index] = buildUp ? 1 - (1 - coverage[index]) * (1 - alpha) :
          Math.max(coverage[index], alpha);
      }
    }
  }
  return { params, dabs, coverage };
}

/** Replays a complete stroke into an RGBA8 surface without DOM dependencies. */
export function replayStroke(surface: RgbaSurface, stroke: Stroke) {
  if (surface.data.length !== surface.width * surface.height * 4) {
    throw new Error("RGBA surface payload does not match its dimensions");
  }
  const imageSource = validImageTip(stroke.params.imageTip)
    ? imageStrokeSource(surface, stroke, parseBrushColor(stroke.params.color).map((value) => value / 255) as [number, number, number], false)
    : null;
  if (imageSource) {
    const { params, dabs, alpha, premultiplied } = imageSource;
    const strokeOpacity = params.flow === undefined ? 1 : clamp(params.opacity);
    const blendMode = params.blendMode ?? "normal";
    let affectedPixels = 0;
    for (let pixel = 0; pixel < alpha.length; pixel += 1) {
      const sourceAlpha = clamp(alpha[pixel] * strokeOpacity);
      if (sourceAlpha <= 0) continue;
      affectedPixels++;
      const offset = pixel * 4;
      const destinationAlpha = surface.data[offset + 3] / 255;
      if (params.mode === "erase" || params.mode === "mask-remove") {
        surface.data[offset + 3] = Math.round(destinationAlpha * (1 - sourceAlpha) * 255);
        continue;
      }
      const outputAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
      const colorOffset = pixel * 3;
      for (let channel = 0; channel < 3; channel += 1) {
        const destination = surface.data[offset + channel] / 255;
        const source = premultiplied[colorOffset + channel] / Math.max(alpha[pixel], 1e-9);
        const blended = source * (1 - destinationAlpha) + destinationAlpha * blendChannel(blendMode, destination, source);
        const output = blended * sourceAlpha + destination * destinationAlpha * (1 - sourceAlpha);
        surface.data[offset + channel] = Math.round(clamp(output / Math.max(outputAlpha, 1e-9)) * 255);
      }
      surface.data[offset + 3] = Math.round(outputAlpha * 255);
    }
    return { dabs, affectedPixels };
  }

  const { params, dabs, coverage } = strokeCoverage(surface, stroke);

  const legacyFlow = params.flow === undefined;
  const strokeOpacity = legacyFlow ? 1 : clamp(params.opacity);
  const color = params.mode === "mask-add" ? [255, 255, 255] as const : parseBrushColor(params.color);
  const blendMode = params.blendMode ?? "normal";
  for (let pixel = 0; pixel < coverage.length; pixel += 1) {
    const sourceAlpha = clamp(coverage[pixel] * strokeOpacity);
    if (sourceAlpha <= 0) continue;
    const offset = pixel * 4;
    const destinationAlpha = surface.data[offset + 3] / 255;
    if (params.mode === "erase" || params.mode === "mask-remove") {
      surface.data[offset + 3] = Math.round(destinationAlpha * (1 - sourceAlpha) * 255);
      continue;
    }
    const outputAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
    for (let channel = 0; channel < 3; channel += 1) {
      const destination = surface.data[offset + channel] / 255;
      const source = color[channel] / 255;
      const blended = source * (1 - destinationAlpha) + destinationAlpha * blendChannel(blendMode, destination, source);
      const premultiplied = blended * sourceAlpha + destination * destinationAlpha * (1 - sourceAlpha);
      surface.data[offset + channel] = Math.round(clamp(premultiplied / Math.max(outputAlpha, 1e-9)) * 255);
    }
    surface.data[offset + 3] = Math.round(outputAlpha * 255);
  }
  return { dabs, affectedPixels: coverage.reduce((sum, value) => sum + (value > 0 ? 1 : 0), 0) };
}

/**
 * Float/linear-light replay path used by precision tile masters. Existing HDR
 * and wide-gamut channel values remain unbounded; only alpha and brush inputs
 * are clamped. `workingColor` must already be converted into the surface's
 * working color space.
 */
export function replayStrokeFloat(
  surface: FloatRgbaSurface,
  stroke: Stroke,
  workingColor: readonly [number, number, number] = parseBrushColor(stroke.params.color).map((value) => value / 255) as [number, number, number],
  incremental?: { dabs: readonly BrushDab[]; cache: BrushCoverageCache },
) {
  if (surface.data.length !== surface.width * surface.height * 4) {
    throw new Error("Float RGBA surface payload does not match its dimensions");
  }
  const imageSource = validImageTip(stroke.params.imageTip)
    ? imageStrokeSource(surface, stroke, workingColor, true, incremental?.dabs, incremental?.cache)
    : null;
  if (imageSource) {
    const { params, dabs, alpha, premultiplied } = imageSource;
    const strokeOpacity = params.flow === undefined ? 1 : clamp(params.opacity);
    const blendMode = params.blendMode ?? "normal";
    let affectedPixels = 0;
    for (let pixel = 0; pixel < alpha.length; pixel += 1) {
      const sourceAlpha = clamp(alpha[pixel] * strokeOpacity);
      if (sourceAlpha <= 0) continue;
      affectedPixels++;
      const offset = pixel * 4;
      const destinationAlpha = clamp(surface.data[offset + 3]);
      if (params.mode === "erase" || params.mode === "mask-remove") {
        surface.data[offset + 3] = destinationAlpha * (1 - sourceAlpha);
        continue;
      }
      const outputAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
      const colorOffset = pixel * 3;
      for (let channel = 0; channel < 3; channel += 1) {
        const destination = surface.data[offset + channel];
        const source = premultiplied[colorOffset + channel] / Math.max(alpha[pixel], 1e-9);
        const blended = source * (1 - destinationAlpha) + destinationAlpha * blendChannel(blendMode, destination, source);
        const output = blended * sourceAlpha + destination * destinationAlpha * (1 - sourceAlpha);
        surface.data[offset + channel] = output / Math.max(outputAlpha, 1e-9);
      }
      surface.data[offset + 3] = outputAlpha;
    }
    return { dabs, affectedPixels };
  }

  const { params, dabs, coverage } = strokeCoverage(surface, stroke, incremental?.dabs, incremental?.cache);
  const strokeOpacity = params.flow === undefined ? 1 : clamp(params.opacity);
  const color = params.mode === "mask-add" ? [1, 1, 1] as const : workingColor;
  const blendMode = params.blendMode ?? "normal";
  for (let pixel = 0; pixel < coverage.length; pixel += 1) {
    const sourceAlpha = clamp(coverage[pixel] * strokeOpacity);
    if (sourceAlpha <= 0) continue;
    const offset = pixel * 4;
    const destinationAlpha = clamp(surface.data[offset + 3]);
    if (params.mode === "erase" || params.mode === "mask-remove") {
      surface.data[offset + 3] = destinationAlpha * (1 - sourceAlpha);
      continue;
    }
    const outputAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
    for (let channel = 0; channel < 3; channel += 1) {
      const destination = surface.data[offset + channel];
      const blended = color[channel] * (1 - destinationAlpha) + destinationAlpha * blendChannel(blendMode, destination, color[channel]);
      const premultiplied = blended * sourceAlpha + destination * destinationAlpha * (1 - sourceAlpha);
      surface.data[offset + channel] = premultiplied / Math.max(outputAlpha, 1e-9);
    }
    surface.data[offset + 3] = outputAlpha;
  }
  return { dabs, affectedPixels: coverage.reduce((sum, value) => sum + (value > 0 ? 1 : 0), 0) };
}

function colorWithAlpha(color: string, alpha: number) {
  const [red, green, blue] = parseBrushColor(color);
  return `rgba(${red},${green},${blue},${alpha})`;
}

function stampCanvas(ctx: CanvasRenderingContext2D, dab: BrushDab, params: BrushParams) {
  const radius = dab.size / 2;
  if (radius < 0.005) return;
  const color = params.mode === "mask-add" ? "#ffffff" :
    params.mode === "mask-remove" || params.mode === "erase" ? "#000000" : params.color;
  ctx.save();
  ctx.translate(dab.x, dab.y);
  ctx.rotate(dab.rotation);
  ctx.scale(1, dab.roundness);
  if (dab.hardness >= 0.999999) {
    ctx.fillStyle = colorWithAlpha(color, dab.opacity);
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, TAU);
    ctx.fill();
    ctx.restore();
    return;
  }
  const gradient = ctx.createRadialGradient(0, 0, radius * dab.hardness, 0, 0, radius);
  gradient.addColorStop(0, colorWithAlpha(color, dab.opacity));
  gradient.addColorStop(1, colorWithAlpha(color, 0));
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, TAU);
  ctx.fill();
  ctx.restore();
}

const imageTipCanvasCache = new WeakMap<ImageBrushTip, Map<string, HTMLCanvasElement>>();

function canvasForImageTip(tip: ImageBrushTip, color: string) {
  const colorKey = tip.mode === "color" ? "color" : `${tip.mode}:${color.toLowerCase()}`;
  const cached = imageTipCanvasCache.get(tip);
  const existing = cached?.get(colorKey);
  if (existing) return existing;
  const canvas = document.createElement("canvas");
  canvas.width = tip.width;
  canvas.height = tip.height;
  const context = canvas.getContext("2d")!;
  const image = context.createImageData(tip.width, tip.height);
  const tint = parseBrushColor(color);
  for (let offset = 0; offset < tip.data.length; offset += 4) {
    const red = tip.data[offset];
    const green = tip.data[offset + 1];
    const blue = tip.data[offset + 2];
    const alpha = tip.data[offset + 3];
    if (tip.mode === "color") {
      image.data.set([red, green, blue, alpha], offset);
    } else {
      const luminance = (red * 0.2126 + green * 0.7152 + blue * 0.0722) / 255;
      const materialScale = 0.35 + luminance * 1.3;
      image.data.set([
        tip.mode === "material" ? Math.round(Math.min(255, tint[0] * materialScale)) : tint[0],
        tip.mode === "material" ? Math.round(Math.min(255, tint[1] * materialScale)) : tint[1],
        tip.mode === "material" ? Math.round(Math.min(255, tint[2] * materialScale)) : tint[2],
        Math.round(alpha * (tip.mode === "stencil" ? 1 - luminance : 1)),
      ], offset);
    }
  }
  context.putImageData(image, 0, 0);
  const variants = cached ?? new Map<string, HTMLCanvasElement>();
  variants.set(colorKey, canvas);
  imageTipCanvasCache.set(tip, variants);
  return canvas;
}

function stampImageTipCanvas(ctx: CanvasRenderingContext2D, dab: BrushDab, params: BrushParams) {
  const tip = params.imageTip;
  if (!validImageTip(tip) || dab.size <= 0) return;
  const canvas = canvasForImageTip(tip, params.color);
  ctx.save();
  ctx.translate(dab.x, dab.y);
  ctx.rotate(dab.rotation);
  ctx.scale(dab.size / tip.width, dab.size * dab.roundness / tip.height);
  ctx.globalAlpha = dab.opacity;
  ctx.drawImage(canvas, -tip.width / 2, -tip.height / 2);
  ctx.restore();
}

export type PaintSegmentState = { planner: BrushStrokePlanner; started: boolean };

export function createPaintSegmentState(params: BrushParams): PaintSegmentState {
  return { planner: new BrushStrokePlanner(params), started: false };
}

/**
 * Canvas adapter retained for the current studio. Pass a shared state across
 * calls to preserve spacing carry; the no-state form remains backward compatible.
 */
export function paintSegment(
  ctx: CanvasRenderingContext2D,
  from: BrushPoint,
  to: BrushPoint,
  params: BrushParams,
  state?: PaintSegmentState,
) {
  const planner = state?.planner ?? new BrushStrokePlanner(params);
  if (!state?.started) {
    planner.start(from, false);
    if (state) state.started = true;
  }
  let dabs = planner.add(to);
  if (!state && dabs.length === 0) dabs = applyBrushSymmetry(baseDab(to, params, 0), params.symmetry);
  const composite: GlobalCompositeOperation = params.mode === "erase" ? "destination-out" :
    params.blendMode === "multiply" ? "multiply" :
    params.blendMode === "screen" ? "screen" :
    params.blendMode === "overlay" ? "overlay" : "source-over";
  ctx.save();
  ctx.globalCompositeOperation = composite;
  for (const dab of dabs) {
    if (validImageTip(params.imageTip)) stampImageTipCanvas(ctx, dab, params);
    else stampCanvas(ctx, dab, params);
  }
  ctx.restore();
  return dabs.length;
}
