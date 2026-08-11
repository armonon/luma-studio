import type { PrecisionTileSurface } from "./tile-store";
import type { RawDevelopSettings } from "./raw-develop";
import type { AiEditQuality, AiOperationControls, AiSelectionGuide } from "./ai-edit";

export type BlendMode =
  | "source-over"
  | "dissolve"
  | "darken"
  | "multiply"
  | "color-burn"
  | "linear-burn"
  | "darker-color"
  | "lighten"
  | "screen"
  | "color-dodge"
  | "linear-dodge"
  | "lighter-color"
  | "overlay"
  | "soft-light"
  | "hard-light"
  | "vivid-light"
  | "linear-light"
  | "pin-light"
  | "hard-mix"
  | "difference"
  | "exclusion"
  | "subtract"
  | "divide"
  | "hue"
  | "saturation"
  | "color"
  | "luminosity";

export const BLEND_LABELS: Record<BlendMode, string> = {
  "source-over": "Normal",
  dissolve: "Dissolve",
  darken: "Darken",
  multiply: "Multiply",
  "color-burn": "Color Burn",
  "linear-burn": "Linear Burn",
  "darker-color": "Darker Color",
  lighten: "Lighten",
  screen: "Screen",
  "color-dodge": "Color Dodge",
  "linear-dodge": "Linear Dodge (Add)",
  "lighter-color": "Lighter Color",
  overlay: "Overlay",
  "soft-light": "Soft Light",
  "hard-light": "Hard Light",
  "vivid-light": "Vivid Light",
  "linear-light": "Linear Light",
  "pin-light": "Pin Light",
  "hard-mix": "Hard Mix",
  difference: "Difference",
  exclusion: "Exclusion",
  subtract: "Subtract",
  divide: "Divide",
  hue: "Hue",
  saturation: "Saturation",
  color: "Color",
  luminosity: "Luminosity",
};

export const BLEND_MODE_GROUPS: ReadonlyArray<{
  label: string;
  modes: ReadonlyArray<BlendMode>;
}> = [
  { label: "Normal", modes: ["source-over", "dissolve"] },
  { label: "Darken", modes: ["darken", "multiply", "color-burn", "linear-burn", "darker-color"] },
  { label: "Lighten", modes: ["lighten", "screen", "color-dodge", "linear-dodge", "lighter-color"] },
  { label: "Contrast", modes: ["overlay", "soft-light", "hard-light", "vivid-light", "linear-light", "pin-light", "hard-mix"] },
  { label: "Inversion", modes: ["difference", "exclusion", "subtract", "divide"] },
  { label: "Component", modes: ["hue", "saturation", "color", "luminosity"] },
];

export const BLEND_MODES: ReadonlyArray<BlendMode> = BLEND_MODE_GROUPS.flatMap((group) => group.modes);

export type BlendPass = {
  id: string;
  mode: BlendMode;
  opacity: number;
  enabled: boolean;
};

export const MAX_LAYER_BLEND_PASSES = 8;

export type BlendIfChannel = "gray" | "red" | "green" | "blue";

export type BlendIfRange = {
  /** Pixels below this value are hidden. */
  black: number;
  /** Pixels reach full opacity at this value. */
  blackFeather: number;
  /** Pixels begin fading out at this value. */
  whiteFeather: number;
  /** Pixels above this value are hidden. */
  white: number;
};

export type BlendIf = {
  activeChannel: BlendIfChannel;
  channels: Record<BlendIfChannel, {
    source: BlendIfRange;
    underlying: BlendIfRange;
  }>;
};

type LegacyBlendIf = {
  channel: BlendIfChannel;
  source: BlendIfRange;
  underlying: BlendIfRange;
};

export const NEUTRAL_BLEND_IF_RANGE: BlendIfRange = {
  black: 0,
  blackFeather: 0,
  whiteFeather: 1,
  white: 1,
};

export const NEUTRAL_BLEND_IF: BlendIf = {
  activeChannel: "gray",
  channels: {
    gray: { source: { ...NEUTRAL_BLEND_IF_RANGE }, underlying: { ...NEUTRAL_BLEND_IF_RANGE } },
    red: { source: { ...NEUTRAL_BLEND_IF_RANGE }, underlying: { ...NEUTRAL_BLEND_IF_RANGE } },
    green: { source: { ...NEUTRAL_BLEND_IF_RANGE }, underlying: { ...NEUTRAL_BLEND_IF_RANGE } },
    blue: { source: { ...NEUTRAL_BLEND_IF_RANGE }, underlying: { ...NEUTRAL_BLEND_IF_RANGE } },
  },
};

export type ToneParams = {
  exposure: number;
  contrast: number;
  highlights: number;
  shadows: number;
  temperature: number;
  vibrance: number;
};

export const NEUTRAL_TONE: ToneParams = {
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  temperature: 0,
  vibrance: 0,
};

// Affine transform: layer pixels drawn with:
//   ctx.setTransform(cos*sx, sin*sx, -sin*sy, cos*sy, tx, ty)
// where (tx,ty) is the on-canvas offset for the layer's origin (top-left),
// and rotation happens around the layer's center. We keep a compact rep.
export type Transform = {
  tx: number;
  ty: number;
  sx: number;
  sy: number;
  rotation: number; // radians
};

export const IDENTITY_TRANSFORM: Transform = {
  tx: 0,
  ty: 0,
  sx: 1,
  sy: 1,
  rotation: 0,
};

export type AffineTransform = {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
};

export function affineForLayerTransform(transform: Transform): AffineTransform {
  const cosine = Math.cos(transform.rotation);
  const sine = Math.sin(transform.rotation);
  return {
    a: cosine * transform.sx,
    b: sine * transform.sx,
    c: -sine * transform.sy,
    d: cosine * transform.sy,
    e: transform.tx,
    f: transform.ty,
  };
}

export function inverseAffineForLayerTransform(transform: Transform): AffineTransform | null {
  const forward = affineForLayerTransform(transform);
  const determinant = forward.a * forward.d - forward.b * forward.c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) return null;
  const a = forward.d / determinant;
  const b = -forward.b / determinant;
  const c = -forward.c / determinant;
  const d = forward.a / determinant;
  return {
    a,
    b,
    c,
    d,
    e: -(a * forward.e + c * forward.f),
    f: -(b * forward.e + d * forward.f),
  };
}

export function transformPoint(matrix: AffineTransform, x: number, y: number) {
  return {
    x: matrix.a * x + matrix.c * y + matrix.e,
    y: matrix.b * x + matrix.d * y + matrix.f,
  };
}

export function documentPointToLayer(transform: Transform, x: number, y: number) {
  const inverse = inverseAffineForLayerTransform(transform);
  return inverse ? transformPoint(inverse, x, y) : null;
}

/** Compose a document-space rotation around an arbitrary pivot with a layer transform. */
export function rotateLayerTransformAround(
  transform: Transform,
  angleRadians: number,
  pivotX: number,
  pivotY: number,
): Transform {
  const cosine = Math.cos(angleRadians);
  const sine = Math.sin(angleRadians);
  const dx = transform.tx - pivotX;
  const dy = transform.ty - pivotY;
  return {
    ...transform,
    rotation: transform.rotation + angleRadians,
    tx: pivotX + dx * cosine - dy * sine,
    ty: pivotY + dx * sine + dy * cosine,
  };
}

export type LayerKind =
  | "raster"
  | "smart-object"
  | "group"
  | "adjustment-tone"
  | "adjustment-curves"
  | "adjustment-levels"
  | "adjustment-hsl"
  | "text"
  | "shape"
  | "path";

// Levels: input black/white/gamma remap. 0..1 in x, gamma > 0.
export type LevelsParams = {
  inBlack: number;   // 0..1
  inWhite: number;   // 0..1
  gamma: number;     // 0.01..9.99, 1 = neutral
  outBlack: number;  // 0..1
  outWhite: number;  // 0..1
};
export const NEUTRAL_LEVELS: LevelsParams = {
  inBlack: 0, inWhite: 1, gamma: 1, outBlack: 0, outWhite: 1,
};

// HSL adjustment: shifts hue, saturation, lightness globally. Ranges:
//   hue     : -180..+180 degrees
//   sat     : -100..+100 (percent of current saturation)
//   light   : -100..+100 (percent lightness shift)
export type HslParams = { hue: number; saturation: number; lightness: number };
export const NEUTRAL_HSL: HslParams = { hue: 0, saturation: 0, lightness: 0 };

// A curve is a set of control points 0..1 in x (input) and y (output). We
// evaluate it as a smooth monotone spline into a 256-entry lookup table.
export type CurvePoints = Array<{ x: number; y: number }>;
export type Curves = {
  rgb: CurvePoints;
  r: CurvePoints;
  g: CurvePoints;
  b: CurvePoints;
};
export const IDENTITY_CURVE: CurvePoints = [
  { x: 0, y: 0 },
  { x: 1, y: 1 },
];
export const NEUTRAL_CURVES: Curves = {
  rgb: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
  r: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
  g: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
  b: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
};

// Bezier path anchor for the pen tool. Each anchor stores its tangent handles
// as offsets from the anchor point (Photoshop convention).
export type PathAnchor = {
  x: number;
  y: number;
  hIn: { dx: number; dy: number };
  hOut: { dx: number; dy: number };
};
export type PathStyle = {
  anchors: PathAnchor[];
  closed: boolean;
  fill: string;
  stroke: string;
  strokeWidth: number;
};

export type PathArcSample = { x: number; y: number; distance: number };

const midpoint = (a: number, b: number) => (a + b) / 2;

function flattenCubic(
  output: Array<{ x: number; y: number }>,
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  tolerance: number,
  depth = 0,
) {
  const chord = Math.hypot(p3.x - p0.x, p3.y - p0.y);
  const polygon = Math.hypot(p1.x - p0.x, p1.y - p0.y)
    + Math.hypot(p2.x - p1.x, p2.y - p1.y)
    + Math.hypot(p3.x - p2.x, p3.y - p2.y);
  if (depth >= 12 || polygon - chord <= tolerance) {
    output.push(p3);
    return;
  }
  const p01 = { x: midpoint(p0.x, p1.x), y: midpoint(p0.y, p1.y) };
  const p12 = { x: midpoint(p1.x, p2.x), y: midpoint(p1.y, p2.y) };
  const p23 = { x: midpoint(p2.x, p3.x), y: midpoint(p2.y, p3.y) };
  const p012 = { x: midpoint(p01.x, p12.x), y: midpoint(p01.y, p12.y) };
  const p123 = { x: midpoint(p12.x, p23.x), y: midpoint(p12.y, p23.y) };
  const center = { x: midpoint(p012.x, p123.x), y: midpoint(p012.y, p123.y) };
  flattenCubic(output, p0, p01, p012, center, tolerance, depth + 1);
  flattenCubic(output, center, p123, p23, p3, tolerance, depth + 1);
}

/** Adaptive Bezier flattening with cumulative arc length for text and tools. */
export function pathArcTable(path: PathStyle, tolerance = 0.25): PathArcSample[] {
  if (path.anchors.length < 2) return [];
  const points: Array<{ x: number; y: number }> = [{ x: path.anchors[0].x, y: path.anchors[0].y }];
  const segmentCount = path.anchors.length - 1 + (path.closed ? 1 : 0);
  for (let index = 0; index < segmentCount; index += 1) {
    const from = path.anchors[index % path.anchors.length];
    const to = path.anchors[(index + 1) % path.anchors.length];
    flattenCubic(
      points,
      from,
      { x: from.x + from.hOut.dx, y: from.y + from.hOut.dy },
      { x: to.x + to.hIn.dx, y: to.y + to.hIn.dy },
      to,
      Math.max(0.01, tolerance),
    );
  }
  let distance = 0;
  return points.map((point, index) => {
    if (index > 0) distance += Math.hypot(point.x - points[index - 1].x, point.y - points[index - 1].y);
    return { ...point, distance };
  });
}

export function nearestPathDistance(table: ReadonlyArray<PathArcSample>, x: number, y: number) {
  if (table.length < 2) return 0;
  let nearestDistance = 0;
  let nearestSquared = Infinity;
  for (let index = 1; index < table.length; index += 1) {
    const from = table[index - 1];
    const to = table[index];
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const lengthSquared = dx * dx + dy * dy;
    const amount = lengthSquared > 0
      ? Math.max(0, Math.min(1, ((x - from.x) * dx + (y - from.y) * dy) / lengthSquared))
      : 0;
    const px = from.x + dx * amount;
    const py = from.y + dy * amount;
    const squared = (x - px) ** 2 + (y - py) ** 2;
    if (squared < nearestSquared) {
      nearestSquared = squared;
      nearestDistance = from.distance + (to.distance - from.distance) * amount;
    }
  }
  return nearestDistance;
}

export function samplePathDistance(table: ReadonlyArray<PathArcSample>, distance: number, closed = false) {
  if (table.length < 2) return null;
  const total = table.at(-1)!.distance;
  if (total <= 0) return null;
  let target = distance;
  if (closed) target = ((target % total) + total) % total;
  else if (target < 0 || target > total) return null;
  let low = 1;
  let high = table.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (table[middle].distance < target) low = middle + 1;
    else high = middle;
  }
  const to = table[low];
  const from = table[low - 1];
  const span = Math.max(1e-9, to.distance - from.distance);
  const amount = (target - from.distance) / span;
  return {
    x: from.x + (to.x - from.x) * amount,
    y: from.y + (to.y - from.y) * amount,
    angle: Math.atan2(to.y - from.y, to.x - from.x),
  };
}

export type TextStyle = {
  text: string;
  font: string; // "600 128px Inter, system-ui, sans-serif"
  color: string;
  align: CanvasTextAlign;
  lineHeight: number; // multiplier
  x: number; // baseline x in layer-space
  y: number; // baseline y in layer-space
  layout?: "point" | "paragraph" | "vertical" | "path";
  boxWidth?: number;
  boxHeight?: number;
  /** Frozen path geometry for type-on-path so the text layer stays portable. */
  path?: PathStyle;
};

export type ShapeKind = "rect" | "ellipse";
export type ShapeStyle = {
  kind: ShapeKind;
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  radius: number; // rect corner radius
};

export type SmartFilter = {
  id: string;
  kind: "blur" | "sharpen" | "invert" | "desaturate" | "hue";
  enabled: boolean;
  opacity: number;
  params: Record<string, number>;
};

export type AiProvenance = {
  id: string;
  operation: "fill" | "expand" | "remove" | "relight" | "harmonize" | "upscale";
  provider: "openai" | "local";
  model: string;
  prompt: string;
  createdAt: string;
  sourceLayerIds: string[];
  usedSelection: boolean;
  requestId?: string;
  inputSha256?: string;
  maskSha256?: string;
  parameters?: {
    quality: AiEditQuality;
    size: string;
    variationIndex?: number;
    controls?: AiOperationControls;
    selection?: AiSelectionGuide;
  };
};

export type SourceProvenance = {
  originalName: string;
  format: string;
  mode: "decoded" | "embedded-raw-preview" | "dng-cfa-developed";
  originalBytes?: number;
  colorProfile?: {
    id: string;
    name: string;
    version?: string;
    colorSpace: string;
    model: "matrix-trc" | "lut" | "unsupported-lut" | "metadata-only";
    canTransform: boolean;
    browserDecoded: true;
    warnings: string[];
  };
};

/**
 * Original sensor asset and nondestructive develop recipe for an editable DNG
 * layer. The source bytes are stored once in a .luma project; all display and
 * precision surfaces remain reproducible derivatives.
 */
export type RawLayerSource = {
  original: Uint8Array;
  settings: RawDevelopSettings;
  decoder: "luma-dng-tiff-v1";
  boundary: "classic-tiff-uncompressed-bayer" | "bigtiff-uncompressed-bayer" | "tiff-lossless-jpeg-bayer";
  matrixSource: "forward-matrix-1" | "color-matrix-1" | "assumed-camera-rgb";
  sensor: {
    bitsPerSample: number;
    dngVersion?: string;
    warnings: string[];
  };
};

/**
 * Layer style effects.
 *
 * Effects split into two passes by where they sit relative to the layer's own
 * pixels — see EFFECTS_BELOW_CONTENT. Shadows and glows draw underneath;
 * overlays, strokes and bevels draw on top clipped to the layer's alpha.
 *
 * The shared fields stay required so existing callers keep working; per-kind
 * options are optional with documented defaults.
 */
export type LayerEffectKind =
  | "drop-shadow"
  | "inner-shadow"
  | "outer-glow"
  | "color-overlay"
  | "stroke"
  | "bevel-emboss";

/** Effects painted beneath the layer content; the rest paint over it. */
export const EFFECTS_BELOW_CONTENT: ReadonlyArray<LayerEffectKind> = ["drop-shadow", "outer-glow"];

export type StrokePosition = "outside" | "inside" | "center";

export type LayerEffect = {
  id: string;
  kind: LayerEffectKind;
  enabled: boolean;
  opacity: number;
  color: string;
  blur: number;
  offsetX: number;
  offsetY: number;
  /** stroke only — thickness in document pixels. Defaults to 3. */
  width?: number;
  /** stroke only — defaults to "outside". */
  position?: StrokePosition;
  /** bevel-emboss only — offset in px between highlight and shadow. Defaults to 3. */
  depth?: number;
  /** bevel-emboss only — light direction in degrees. Defaults to 135 (top-left). */
  angle?: number;
  /** bevel-emboss only. Defaults to white. */
  highlightColor?: string;
  /** bevel-emboss only. Defaults to black. */
  shadowColor?: string;
};

export function isEffectBelowContent(kind: LayerEffectKind) {
  return EFFECTS_BELOW_CONTENT.includes(kind);
}

/** Dialog order, matching Photoshop's Layer Style list (top of the shape outwards). */
export const LAYER_EFFECT_KINDS: ReadonlyArray<LayerEffectKind> = [
  "bevel-emboss",
  "stroke",
  "inner-shadow",
  "color-overlay",
  "outer-glow",
  "drop-shadow",
];

export const EFFECT_LABELS: Record<LayerEffectKind, string> = {
  "bevel-emboss": "Bevel & Emboss",
  stroke: "Stroke",
  "inner-shadow": "Inner Shadow",
  "color-overlay": "Color Overlay",
  "outer-glow": "Outer Glow",
  "drop-shadow": "Drop Shadow",
};

/** Controls an effect actually reads. Anything omitted here is ignored by the renderer. */
export type EffectField = "offset" | "blur" | "width" | "position" | "depth" | "angle" | "bevelColors";

export const EFFECT_FIELDS: Record<LayerEffectKind, ReadonlyArray<EffectField>> = {
  "drop-shadow": ["offset", "blur"],
  "inner-shadow": ["offset", "blur"],
  "outer-glow": ["blur"],
  "color-overlay": [],
  stroke: ["width", "position"],
  "bevel-emboss": ["depth", "angle", "blur", "bevelColors"],
};

export function effectUses(kind: LayerEffectKind, field: EffectField) {
  return EFFECT_FIELDS[kind].includes(field);
}

/**
 * Effects in painting order: bottom-most first.
 *
 * Photoshop paints layer styles in a fixed order regardless of the order they
 * were added, and its dialog list is that order upside down — Bevel & Emboss
 * sits at the top of the list because it paints last. Rendering in array order
 * instead made the result depend on which button the user clicked first.
 *
 * Ties keep their relative order, so duplicates of one kind stack as added.
 */
export function effectsInPaintOrder(effects: ReadonlyArray<LayerEffect>): LayerEffect[] {
  const rank = (effect: LayerEffect) => LAYER_EFFECT_KINDS.indexOf(effect.kind);
  return effects
    .map((effect, index) => ({ effect, index }))
    .sort((a, b) => (rank(b.effect) - rank(a.effect)) || (a.index - b.index))
    .map(({ effect }) => effect);
}

/** Light direction resolved to a pixel offset for bevel/emboss. */
export function bevelOffset(effect: LayerEffect) {
  const depth = effect.depth ?? 3;
  const radians = ((effect.angle ?? 135) * Math.PI) / 180;
  return { dx: Math.cos(radians) * depth, dy: -Math.sin(radians) * depth };
}

export type Layer = {
  id: string;
  name: string;
  kind: LayerKind;
  visible: boolean;
  opacity: number;
  /** Content opacity; unlike layer opacity, effects remain fully present. */
  fillOpacity?: number;
  blend: BlendMode;
  /** Ordered blend passes. Missing means one legacy pass using `blend`. */
  blendStack?: BlendPass[];
  blendIf?: BlendIf;
  transform: Transform;
  parentId?: string;
  locked?: boolean;
  clipping?: boolean;
  filters?: SmartFilter[];
  ai?: AiProvenance;
  source?: SourceProvenance;
  raw?: RawLayerSource;
  /** Stable source-layer slot used to restore preservation metadata from an embedded PSD/PSB. */
  photoshop?: { sourceIndex: number };
  effects?: LayerEffect[];
  bitmap?: HTMLCanvasElement;
  /** Linear-light edit master; bitmap is its clamped display/compatibility mirror. */
  surface?: PrecisionTileSurface;
  mask?: HTMLCanvasElement;
  tone?: ToneParams;
  curves?: Curves;
  levels?: LevelsParams;
  hsl?: HslParams;
  text?: TextStyle;
  shape?: ShapeStyle;
  path?: PathStyle;
};

export function resolvedBlendPasses(layer: Pick<Layer, "id" | "blend" | "blendStack">): BlendPass[] {
  if (layer.blendStack?.length) {
    return layer.blendStack.map((pass) => ({
      ...pass,
      opacity: Math.max(0, Math.min(1, Number.isFinite(pass.opacity) ? pass.opacity : 1)),
    }));
  }
  return [{ id: `${layer.id}-blend-0`, mode: layer.blend, opacity: 1, enabled: true }];
}

export function resolvedFillOpacity(layer: Pick<Layer, "fillOpacity">) {
  return Math.max(0, Math.min(1, Number.isFinite(layer.fillOpacity) ? layer.fillOpacity! : 1));
}

function normalizedBlendIfRange(range?: Partial<BlendIfRange>): BlendIfRange {
  const clamp = (value: number | undefined, fallback: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value! : fallback));
  const black = clamp(range?.black, 0);
  const blackFeather = Math.max(black, clamp(range?.blackFeather, black));
  const whiteFeather = Math.max(blackFeather, clamp(range?.whiteFeather, 1));
  const white = Math.max(whiteFeather, clamp(range?.white, 1));
  return { black, blackFeather, whiteFeather, white };
}

/** The four Blend If handles, in the order they must stay in. */
export const BLEND_IF_HANDLES = ["black", "blackFeather", "whiteFeather", "white"] as const;

/**
 * Reorder a range after one handle moved, pushing the others out of its way.
 *
 * `normalizedBlendIfRange` only ever raises a handle to satisfy the ordering,
 * so pulling an outer handle inwards would be silently undone — dragging
 * "White hide" left would do nothing at all. Handles push each other instead,
 * which is also what Photoshop's split sliders do.
 */
export function orderBlendIfHandles(range: BlendIfRange, moved: keyof BlendIfRange): BlendIfRange {
  const index = BLEND_IF_HANDLES.indexOf(moved);
  if (index < 0) return range;
  const next = { ...range };
  const pivot = next[moved];
  for (let i = index - 1; i >= 0; i -= 1) {
    next[BLEND_IF_HANDLES[i]] = Math.min(next[BLEND_IF_HANDLES[i]], pivot);
  }
  for (let i = index + 1; i < BLEND_IF_HANDLES.length; i += 1) {
    next[BLEND_IF_HANDLES[i]] = Math.max(next[BLEND_IF_HANDLES[i]], pivot);
  }
  return next;
}

export function resolvedBlendIf(layer: Pick<Layer, "blendIf">): BlendIf {
  const source = layer.blendIf as (Partial<BlendIf> & Partial<LegacyBlendIf>) | undefined;
  const candidateChannel = source?.activeChannel ?? source?.channel;
  const activeChannel: BlendIfChannel = (["gray", "red", "green", "blue"] as const).includes(candidateChannel as BlendIfChannel)
    ? candidateChannel as BlendIfChannel
    : "gray";
  const legacyBand = source?.source || source?.underlying
    ? { source: normalizedBlendIfRange(source.source), underlying: normalizedBlendIfRange(source.underlying) }
    : undefined;
  const channel = (name: BlendIfChannel) => {
    const band = source?.channels?.[name] ?? (name === activeChannel ? legacyBand : undefined);
    return {
      source: normalizedBlendIfRange(band?.source),
      underlying: normalizedBlendIfRange(band?.underlying),
    };
  };
  return {
    activeChannel,
    channels: {
      gray: channel("gray"),
      red: channel("red"),
      green: channel("green"),
      blue: channel("blue"),
    },
  };
}

export type Selection = {
  // Grayscale mask; alpha 255 = fully selected.
  mask: HTMLCanvasElement;
  // Bounding rect for quick reject / drawing marching ants.
  bounds: { x: number; y: number; w: number; h: number };
};

export type Guide = {
  id: string;
  orientation: "horizontal" | "vertical";
  position: number;
};

export type CapturedBrushAsset = {
  id: string;
  name: string;
  bitmap: HTMLCanvasElement;
  /** Diameter in document pixels when sampled, before storage downsampling. */
  sourceDiameter: number;
  createdAt: string;
};

export const MAX_CAPTURED_BRUSHES = 32;
export const MAX_CAPTURED_BRUSH_EDGE = 512;

export type ProofProfile = "none" | "srgb" | "display-p3" | "cmyk-generic";

export type ProofSettings = {
  profile: ProofProfile;
  intent: "perceptual" | "relative-colorimetric" | "absolute-colorimetric" | "saturation";
  blackPointCompensation: boolean;
  gamutWarning: boolean;
};

export const MAX_LAYER_COMPS = 64;
export const MAX_ARTBOARDS = 128;

export type Artboard = {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type LayerComp = {
  id: string;
  name: string;
  createdAt: string;
  layers: Array<{
    layerId: string;
    visible: boolean;
    opacity: number;
    transform: Transform;
  }>;
};

export type Document = {
  width: number;
  height: number;
  colorSpace: "srgb" | "display-p3" | "linear-srgb";
  bitDepth: 8 | 16 | 32;
  resolution: { x: number; y: number; unit: "ppi" };
  guides: Guide[];
  proofing: ProofSettings;
  capturedBrushes?: CapturedBrushAsset[];
  layerComps?: LayerComp[];
  artboards?: Artboard[];
  layers: Layer[]; // index 0 is topmost
  selection: Selection | null;
};

let idCounter = 0;
export function nextId(prefix: string) {
  idCounter += 1;
  return `${prefix}-${idCounter.toString(36)}`;
}

/** Keep generated ids collision-free when a v2 project restores stable ids. */
export function reserveId(id: string) {
  const suffix = id.match(/-([0-9a-z]+)$/i)?.[1];
  if (!suffix) return;
  const value = Number.parseInt(suffix, 36);
  if (Number.isFinite(value)) idCounter = Math.max(idCounter, value);
}

/**
 * Geometry for drawing a source image into a destination canvas so the whole
 * image is visible and centred, preserving aspect ratio ("contain").
 *
 * Importing used to draw at 0,0 at native size, which silently cropped any
 * image larger than the document and pinned smaller ones to the top-left
 * corner. Exported separately so the maths is testable without a canvas.
 *
 * Images smaller than the canvas are NOT upscaled — enlarging on import would
 * invent detail the file does not have. They are centred at native size.
 */
export function fitImageRect(
  sourceWidth: number,
  sourceHeight: number,
  destWidth: number,
  destHeight: number,
  { allowUpscale = false }: { allowUpscale?: boolean } = {},
): { x: number; y: number; width: number; height: number; scale: number } {
  if (sourceWidth <= 0 || sourceHeight <= 0 || destWidth <= 0 || destHeight <= 0) {
    return { x: 0, y: 0, width: 0, height: 0, scale: 1 };
  }
  const contain = Math.min(destWidth / sourceWidth, destHeight / sourceHeight);
  const scale = allowUpscale ? contain : Math.min(1, contain);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return {
    x: (destWidth - width) / 2,
    y: (destHeight - height) / 2,
    width,
    height,
    scale,
  };
}

export function newCanvas(width: number, height: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c;
}

export function cloneCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = newCanvas(src.width, src.height);
  c.getContext("2d")!.drawImage(src, 0, 0);
  return c;
}

export function createDocument(width: number, height: number): Document {
  return {
    width,
    height,
    colorSpace: "srgb",
    bitDepth: 8,
    resolution: { x: 72, y: 72, unit: "ppi" },
    guides: [],
    proofing: {
      profile: "none",
      intent: "relative-colorimetric",
      blackPointCompensation: true,
      gamutWarning: false,
    },
    capturedBrushes: [],
    layerComps: [],
    artboards: [],
    layers: [],
    selection: null,
  };
}

export function createRasterLayer(
  name: string,
  bitmap?: HTMLCanvasElement,
): Layer {
  return {
    id: nextId("raster"),
    name,
    kind: "raster",
    visible: true,
    opacity: 1,
    blend: "source-over",
    transform: { ...IDENTITY_TRANSFORM },
    bitmap,
  };
}

export function createGroupLayer(name = "Group"): Layer {
  return {
    id: nextId("group"),
    name,
    kind: "group",
    visible: true,
    opacity: 1,
    blend: "source-over",
    transform: { ...IDENTITY_TRANSFORM },
    locked: false,
  };
}

export function layerAncestors(doc: Document, layer: Layer): Layer[] {
  const result: Layer[] = [];
  const seen = new Set<string>();
  let parentId = layer.parentId;
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = doc.layers.find((candidate) => candidate.id === parentId);
    if (!parent) break;
    result.push(parent);
    parentId = parent.parentId;
  }
  return result;
}

export function effectiveLayerVisible(doc: Document, layer: Layer) {
  return layer.visible && layerAncestors(doc, layer).every((parent) => parent.visible);
}

export function effectiveLayerOpacity(doc: Document, layer: Layer) {
  return layerAncestors(doc, layer).reduce((opacity, parent) => opacity * parent.opacity, layer.opacity);
}

export function findClippingBase(doc: Document, layer: Layer) {
  const index = doc.layers.findIndex((candidate) => candidate.id === layer.id);
  for (let i = index + 1; i < doc.layers.length; i++) {
    const candidate = doc.layers[i];
    if (candidate.parentId !== layer.parentId) continue;
    if (candidate.kind !== "group") return candidate;
  }
  return null;
}

export function createAdjustmentLayer(
  name: string,
  tone: ToneParams = { ...NEUTRAL_TONE },
): Layer {
  return {
    id: nextId("adj"),
    name,
    kind: "adjustment-tone",
    visible: true,
    opacity: 1,
    blend: "source-over",
    transform: { ...IDENTITY_TRANSFORM },
    tone,
  };
}

export function createTextLayer(name: string, style: TextStyle): Layer {
  return {
    id: nextId("text"),
    name,
    kind: "text",
    visible: true,
    opacity: 1,
    blend: "source-over",
    transform: { ...IDENTITY_TRANSFORM },
    text: style,
  };
}

export function createShapeLayer(name: string, style: ShapeStyle): Layer {
  return {
    id: nextId("shape"),
    name,
    kind: "shape",
    visible: true,
    opacity: 1,
    blend: "source-over",
    transform: { ...IDENTITY_TRANSFORM },
    shape: style,
  };
}

export function createLevelsLayer(name: string, levels: LevelsParams = { ...NEUTRAL_LEVELS }): Layer {
  return {
    id: nextId("levels"),
    name,
    kind: "adjustment-levels",
    visible: true,
    opacity: 1,
    blend: "source-over",
    transform: { ...IDENTITY_TRANSFORM },
    levels,
  };
}

export function createHslLayer(name: string, hsl: HslParams = { ...NEUTRAL_HSL }): Layer {
  return {
    id: nextId("hsl"),
    name,
    kind: "adjustment-hsl",
    visible: true,
    opacity: 1,
    blend: "source-over",
    transform: { ...IDENTITY_TRANSFORM },
    hsl,
  };
}

export function applyLevelsToImageData(img: ImageData, p: LevelsParams): ImageData {
  const inSpan = Math.max(0.001, p.inWhite - p.inBlack);
  const outSpan = p.outWhite - p.outBlack;
  const invGamma = 1 / Math.max(0.01, p.gamma);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    for (let k = 0; k < 3; k++) {
      let v = d[i + k] / 255;
      v = Math.max(0, Math.min(1, (v - p.inBlack) / inSpan));
      v = Math.pow(v, invGamma);
      v = p.outBlack + v * outSpan;
      d[i + k] = Math.max(0, Math.min(255, Math.round(v * 255)));
    }
  }
  return img;
}

// Convert to HSL, offset, convert back. Standard rec.601 luminance for
// perceptual weighting — good enough for global HSL edits.
export function applyHslToImageData(img: ImageData, p: HslParams): ImageData {
  const d = img.data;
  const hueOff = (p.hue % 360) / 360;
  const satScale = 1 + p.saturation / 100;
  const lightOff = p.lightness / 100;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
      const dch = max - min;
      s = l > 0.5 ? dch / (2 - max - min) : dch / (max + min);
      switch (max) {
        case r: h = (g - b) / dch + (g < b ? 6 : 0); break;
        case g: h = (b - r) / dch + 2; break;
        case b: h = (r - g) / dch + 4; break;
      }
      h /= 6;
    }
    h = (h + hueOff + 1) % 1;
    s = Math.max(0, Math.min(1, s * satScale));
    const l2 = Math.max(0, Math.min(1, l + lightOff));
    const q = l2 < 0.5 ? l2 * (1 + s) : l2 + s - l2 * s;
    const pcomp = 2 * l2 - q;
    const conv = (t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return pcomp + (q - pcomp) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return pcomp + (q - pcomp) * (2 / 3 - t) * 6;
      return pcomp;
    };
    d[i] = Math.round(conv(h + 1 / 3) * 255);
    d[i + 1] = Math.round(conv(h) * 255);
    d[i + 2] = Math.round(conv(h - 1 / 3) * 255);
  }
  return img;
}

export function createCurvesLayer(name: string, curves: Curves = cloneCurves(NEUTRAL_CURVES)): Layer {
  return {
    id: nextId("curves"),
    name,
    kind: "adjustment-curves",
    visible: true,
    opacity: 1,
    blend: "source-over",
    transform: { ...IDENTITY_TRANSFORM },
    curves,
  };
}

export function createPathLayer(name: string, path: PathStyle): Layer {
  return {
    id: nextId("path"),
    name,
    kind: "path",
    visible: true,
    opacity: 1,
    blend: "source-over",
    transform: { ...IDENTITY_TRANSFORM },
    path,
  };
}

export function cloneCurves(c: Curves): Curves {
  return {
    rgb: c.rgb.map((p) => ({ ...p })),
    r: c.r.map((p) => ({ ...p })),
    g: c.g.map((p) => ({ ...p })),
    b: c.b.map((p) => ({ ...p })),
  };
}

// Convert a set of control points into a 256-entry LUT via monotone cubic
// interpolation (Fritsch–Carlson) — matches Photoshop's curve behavior well
// enough that ordinary photo edits feel right.
export function curveToLut(points: CurvePoints): Uint8ClampedArray {
  const pts = [...points].sort((a, b) => a.x - b.x);
  const n = pts.length;
  const lut = new Uint8ClampedArray(256);
  if (n === 0) {
    for (let i = 0; i < 256; i++) lut[i] = i;
    return lut;
  }
  if (n === 1) {
    for (let i = 0; i < 256; i++) lut[i] = Math.round(pts[0].y * 255);
    return lut;
  }
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const dx = new Array(n - 1).fill(0).map((_, i) => xs[i + 1] - xs[i]);
  const dy = new Array(n - 1).fill(0).map((_, i) => ys[i + 1] - ys[i]);
  const m = dx.map((d, i) => (d > 0 ? dy[i] / d : 0));
  const tangents: number[] = new Array(n).fill(0);
  tangents[0] = m[0];
  tangents[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) tangents[i] = (m[i - 1] + m[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      tangents[i] = 0;
      tangents[i + 1] = 0;
    } else {
      const a = tangents[i] / m[i];
      const b = tangents[i + 1] / m[i];
      const h = a * a + b * b;
      if (h > 9) {
        const t = 3 / Math.sqrt(h);
        tangents[i] = t * a * m[i];
        tangents[i + 1] = t * b * m[i];
      }
    }
  }
  const eval1 = (x: number): number => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let seg = 0;
    while (seg < n - 2 && x > xs[seg + 1]) seg++;
    const h = xs[seg + 1] - xs[seg];
    const t = (x - xs[seg]) / h;
    const h00 = (1 + 2 * t) * (1 - t) * (1 - t);
    const h10 = t * (1 - t) * (1 - t);
    const h01 = t * t * (3 - 2 * t);
    const h11 = t * t * (t - 1);
    return h00 * ys[seg] + h10 * h * tangents[seg] + h01 * ys[seg + 1] + h11 * h * tangents[seg + 1];
  };
  for (let i = 0; i < 256; i++) {
    const y = eval1(i / 255);
    lut[i] = Math.max(0, Math.min(255, Math.round(y * 255)));
  }
  return lut;
}

export function applyCurvesToImageData(img: ImageData, curves: Curves): ImageData {
  const rgb = curveToLut(curves.rgb);
  const r = curveToLut(curves.r);
  const g = curveToLut(curves.g);
  const b = curveToLut(curves.b);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    // per-channel first, then luminance/rgb pass.
    d[i] = rgb[r[d[i]]];
    d[i + 1] = rgb[g[d[i + 1]]];
    d[i + 2] = rgb[b[d[i + 2]]];
  }
  return img;
}

export function ensureMask(layer: Layer, width: number, height: number) {
  if (!layer.mask) {
    layer.mask = newCanvas(width, height);
    const ctx = layer.mask.getContext("2d")!;
    ctx.fillStyle = "rgba(0,0,0,1)";
    ctx.fillRect(0, 0, width, height);
  }
  return layer.mask;
}

// Draw a layer onto the given ctx at its transformed position. Used by both
// renderer and any consumer that needs a rasterized layer (e.g. export).
export function drawLayerContent(
  ctx: CanvasRenderingContext2D,
  layer: Layer,
  projection?: { a: number; b: number; c: number; d: number; e: number; f: number },
) {
  const { transform: t } = layer;
  const cos = Math.cos(t.rotation);
  const sin = Math.sin(t.rotation);
  ctx.save();
  // Rotate around the transformed origin
  const a = cos * t.sx;
  const b = sin * t.sx;
  const c = -sin * t.sy;
  const d = cos * t.sy;
  if (projection) {
    ctx.setTransform(
      projection.a * a + projection.c * b,
      projection.b * a + projection.d * b,
      projection.a * c + projection.c * d,
      projection.b * c + projection.d * d,
      projection.a * t.tx + projection.c * t.ty + projection.e,
      projection.b * t.tx + projection.d * t.ty + projection.f,
    );
  } else {
    ctx.setTransform(a, b, c, d, t.tx, t.ty);
  }
  if ((layer.kind === "raster" || layer.kind === "smart-object") && layer.bitmap) {
    ctx.drawImage(layer.bitmap, 0, 0);
  } else if (layer.kind === "text" && layer.text) {
    const s = layer.text;
    ctx.font = s.font;
    ctx.textAlign = s.align;
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = s.color;
    const fontSize = extractFontSize(s.font);
    const lh = fontSize * s.lineHeight;
    if (s.layout === "vertical") {
      let row = 0;
      let column = 0;
      for (const character of s.text) {
        if (character === "\n") { column += 1; row = 0; continue; }
        ctx.fillText(character, s.x - column * lh, s.y + row * lh);
        row += 1;
      }
    } else if (s.layout === "paragraph" && s.boxWidth) {
      const lines: string[] = [];
      for (const paragraph of s.text.split("\n")) {
        let line = "";
        for (const word of paragraph.split(/\s+/)) {
          const candidate = line ? `${line} ${word}` : word;
          if (line && ctx.measureText(candidate).width > s.boxWidth) {
            lines.push(line);
            line = word;
          } else line = candidate;
        }
        lines.push(line);
      }
      const maximumLines = s.boxHeight ? Math.max(1, Math.floor(s.boxHeight / lh)) : lines.length;
      lines.slice(0, maximumLines).forEach((line, index) => ctx.fillText(line, s.x, s.y + index * lh));
    } else if (s.layout === "path" && s.path?.anchors.length) {
      const table = pathArcTable(s.path);
      let distance = nearestPathDistance(table, s.x, s.y);
      let previous = "";
      const characters = typeof Intl.Segmenter === "function"
        ? [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(s.text)].map((entry) => entry.segment)
        : Array.from(s.text);
      ctx.textAlign = "left";
      for (const character of characters) {
        const advance = ctx.measureText(character).width;
        if (previous) {
          distance += ctx.measureText(previous + character).width
            - ctx.measureText(previous).width
            - advance;
        }
        const center = distance + advance / 2;
        const sample = samplePathDistance(table, center, s.path.closed);
        if (!sample) break;
        ctx.save();
        ctx.translate(sample.x, sample.y);
        ctx.rotate(sample.angle);
        ctx.fillText(character, -advance / 2, 0);
        ctx.restore();
        distance += advance;
        previous = character;
      }
    } else {
      s.text.split("\n").forEach((line, index) => ctx.fillText(line, s.x, s.y + index * lh));
    }
  } else if (layer.kind === "path" && layer.path) {
    const p = layer.path;
    if (p.anchors.length >= 2) {
      ctx.beginPath();
      ctx.moveTo(p.anchors[0].x, p.anchors[0].y);
      for (let i = 0; i < p.anchors.length - 1; i++) {
        const a = p.anchors[i];
        const b = p.anchors[i + 1];
        ctx.bezierCurveTo(
          a.x + a.hOut.dx, a.y + a.hOut.dy,
          b.x + b.hIn.dx, b.y + b.hIn.dy,
          b.x, b.y,
        );
      }
      if (p.closed) {
        const a = p.anchors[p.anchors.length - 1];
        const b = p.anchors[0];
        ctx.bezierCurveTo(
          a.x + a.hOut.dx, a.y + a.hOut.dy,
          b.x + b.hIn.dx, b.y + b.hIn.dy,
          b.x, b.y,
        );
        ctx.closePath();
      }
      if (p.fill && p.fill !== "none" && p.closed) {
        ctx.fillStyle = p.fill;
        ctx.fill();
      }
      if (p.stroke && p.strokeWidth > 0) {
        ctx.strokeStyle = p.stroke;
        ctx.lineWidth = p.strokeWidth;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.stroke();
      }
    }
  } else if (layer.kind === "shape" && layer.shape) {
    const sh = layer.shape;
    ctx.beginPath();
    if (sh.kind === "rect") {
      roundedRect(ctx, sh.x, sh.y, sh.w, sh.h, sh.radius);
    } else {
      ctx.ellipse(
        sh.x + sh.w / 2,
        sh.y + sh.h / 2,
        Math.abs(sh.w) / 2,
        Math.abs(sh.h) / 2,
        0,
        0,
        Math.PI * 2,
      );
    }
    if (sh.fill && sh.fill !== "none") {
      ctx.fillStyle = sh.fill;
      ctx.fill();
    }
    if (sh.stroke && sh.strokeWidth > 0) {
      ctx.strokeStyle = sh.stroke;
      ctx.lineWidth = sh.strokeWidth;
      ctx.stroke();
    }
  }
  ctx.restore();
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// Return the four corners of a layer in doc space, in this order:
// [top-left, top-right, bottom-right, bottom-left]. Assumes the layer's
// intrinsic pixel box is (0,0)..(docW,docH) before transform.
export function layerCorners(
  layer: Layer,
  docW: number,
  docH: number,
): Array<[number, number]> {
  const t = layer.transform;
  const cos = Math.cos(t.rotation);
  const sin = Math.sin(t.rotation);
  const map = (x: number, y: number): [number, number] => [
    cos * t.sx * x - sin * t.sy * y + t.tx,
    sin * t.sx * x + cos * t.sy * y + t.ty,
  ];
  return [map(0, 0), map(docW, 0), map(docW, docH), map(0, docH)];
}

function extractFontSize(font: string): number {
  // Best-effort: look for a "Npx" token.
  const m = font.match(/(\d+(?:\.\d+)?)px/);
  return m ? Number(m[1]) : 32;
}
