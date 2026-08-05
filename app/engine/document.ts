export type BlendMode =
  | "source-over"
  | "multiply"
  | "screen"
  | "overlay"
  | "soft-light"
  | "color-dodge"
  | "color-burn"
  | "hard-light"
  | "darken"
  | "lighten"
  | "difference"
  | "exclusion"
  | "hue"
  | "saturation"
  | "color"
  | "luminosity";

export const BLEND_LABELS: Record<BlendMode, string> = {
  "source-over": "Normal",
  multiply: "Multiply",
  screen: "Screen",
  overlay: "Overlay",
  "soft-light": "Soft Light",
  "color-dodge": "Color Dodge",
  "color-burn": "Color Burn",
  "hard-light": "Hard Light",
  darken: "Darken",
  lighten: "Lighten",
  difference: "Difference",
  exclusion: "Exclusion",
  hue: "Hue",
  saturation: "Saturation",
  color: "Color",
  luminosity: "Luminosity",
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

export type TextStyle = {
  text: string;
  font: string; // "600 128px Inter, system-ui, sans-serif"
  color: string;
  align: CanvasTextAlign;
  lineHeight: number; // multiplier
  x: number; // baseline x in layer-space
  y: number; // baseline y in layer-space
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
    quality: "low" | "medium" | "high";
    size: string;
  };
};

export type LayerEffect = {
  id: string;
  kind: "drop-shadow";
  enabled: boolean;
  opacity: number;
  color: string;
  blur: number;
  offsetX: number;
  offsetY: number;
};

export type Layer = {
  id: string;
  name: string;
  kind: LayerKind;
  visible: boolean;
  opacity: number;
  blend: BlendMode;
  transform: Transform;
  parentId?: string;
  locked?: boolean;
  clipping?: boolean;
  filters?: SmartFilter[];
  ai?: AiProvenance;
  effects?: LayerEffect[];
  bitmap?: HTMLCanvasElement;
  mask?: HTMLCanvasElement;
  tone?: ToneParams;
  curves?: Curves;
  levels?: LevelsParams;
  hsl?: HslParams;
  text?: TextStyle;
  shape?: ShapeStyle;
  path?: PathStyle;
};

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

export type Document = {
  width: number;
  height: number;
  colorSpace: "srgb" | "display-p3" | "linear-srgb";
  bitDepth: 8 | 16 | 32;
  resolution: { x: number; y: number; unit: "ppi" };
  guides: Guide[];
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
    layers: [],
    selection: null,
  };
}

export function createRasterLayer(
  name: string,
  bitmap: HTMLCanvasElement,
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
) {
  const { transform: t } = layer;
  const cos = Math.cos(t.rotation);
  const sin = Math.sin(t.rotation);
  ctx.save();
  // Rotate around the transformed origin
  ctx.setTransform(
    cos * t.sx,
    sin * t.sx,
    -sin * t.sy,
    cos * t.sy,
    t.tx,
    t.ty,
  );
  if ((layer.kind === "raster" || layer.kind === "smart-object") && layer.bitmap) {
    ctx.drawImage(layer.bitmap, 0, 0);
  } else if (layer.kind === "text" && layer.text) {
    const s = layer.text;
    ctx.font = s.font;
    ctx.textAlign = s.align;
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = s.color;
    const lines = s.text.split("\n");
    const fontSize = extractFontSize(s.font);
    const lh = fontSize * s.lineHeight;
    lines.forEach((line, i) => ctx.fillText(line, s.x, s.y + i * lh));
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
