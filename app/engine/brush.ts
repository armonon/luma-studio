export type BrushPoint = {
  x: number;
  y: number;
  p: number;
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

function blendChannel(mode: BrushBlendMode, destination: number, source: number) {
  if (mode === "multiply") return destination * source;
  if (mode === "screen") return 1 - (1 - destination) * (1 - source);
  if (mode === "overlay") return destination <= 0.5 ? 2 * destination * source :
    1 - 2 * (1 - destination) * (1 - source);
  return source;
}

/** Replays a complete stroke into an RGBA8 surface without DOM dependencies. */
export function replayStroke(surface: RgbaSurface, stroke: Stroke) {
  if (surface.data.length !== surface.width * surface.height * 4) {
    throw new Error("RGBA surface payload does not match its dimensions");
  }
  const params = { ...stroke.params, seed: stroke.seed ?? stroke.params.seed ?? 0 };
  const dabs = planStroke(stroke.points, params);
  const coverage = new Float32Array(surface.width * surface.height);
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
      const blended = blendChannel(blendMode, destination, source);
      const premultiplied = blended * sourceAlpha + destination * destinationAlpha * (1 - sourceAlpha);
      surface.data[offset + channel] = Math.round(clamp(premultiplied / Math.max(outputAlpha, 1e-9)) * 255);
    }
    surface.data[offset + 3] = Math.round(outputAlpha * 255);
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
  for (const dab of dabs) stampCanvas(ctx, dab, params);
  ctx.restore();
  return dabs.length;
}
