/**
 * Procedural mockup scenes.
 *
 * Licensing: every scene below is synthesized at runtime from code in this
 * file and `mockup-raster.ts` — silhouettes, folds, fabric weave, wall
 * plaster, wood grain, vinyl grooves and glass glare are all generated. No
 * photograph, template or third-party asset is used, so the output carries no
 * attribution or licence obligations beyond Luma's own.
 *
 * Coordinates are normalized to the square scene (0..1, y down) and scaled by
 * the requested size, so a 700 px preview and a 2000 px export are the same
 * picture at different resolutions.
 */
import type { MockupPlacement, MockupScene, MockupSceneId, MockupSurface, Quad } from "./mockup";
import { squareToQuad, applyHomography } from "./mockup";
import {
  ERASE, OVER, PathBuilder, blurMask, clamp01, ellipse, fbm, fillPolygon, fillPolygons, grain, hexToRgb, mirrorClosed,
  roundedRectUV, shiftMask, smoothstep, strokePolyline, valueNoise, type Mask, type Point,
} from "./mockup-raster";

export type SceneInfo = {
  id: MockupSceneId;
  name: string;
  description: string;
  /** Whether the product colour is user-selectable. */
  colorable: boolean;
  defaultColor: string;
  swatches: readonly string[];
  defaultPlacement: MockupPlacement;
};

const garmentSwatches = ["#f4f3ef", "#16171a", "#2f3d57", "#8b2632", "#c9b79c", "#5e6b4e", "#9aa3ad"] as const;

export const MOCKUP_SCENES: readonly SceneInfo[] = [
  { id: "tshirt", name: "T-shirt", description: "Flat-lay crew neck, chest print", colorable: true, defaultColor: "#f4f3ef", swatches: garmentSwatches, defaultPlacement: { fit: "contain", scale: 0.9, offsetX: 0, offsetY: -0.04, rotation: 0 } },
  { id: "hoodie", name: "Hoodie", description: "Pullover hoodie, chest print above the pocket", colorable: true, defaultColor: "#16171a", swatches: garmentSwatches, defaultPlacement: { fit: "contain", scale: 0.88, offsetX: 0, offsetY: 0, rotation: 0 } },
  { id: "tote", name: "Tote bag", description: "Natural canvas tote", colorable: true, defaultColor: "#e6dcc6", swatches: ["#e6dcc6", "#16171a", "#f4f3ef", "#2f3d57", "#5e6b4e"], defaultPlacement: { fit: "contain", scale: 0.86, offsetX: 0, offsetY: 0, rotation: 0 } },
  { id: "poster", name: "Poster on wall", description: "Framed 3:4 print in perspective", colorable: true, defaultColor: "#ebe6dd", swatches: ["#ebe6dd", "#cfd8d6", "#d9c3b0", "#3a3d42", "#b9c2cf"], defaultPlacement: { fit: "cover", scale: 1, offsetX: 0, offsetY: 0, rotation: 0 } },
  { id: "vinyl", name: "Vinyl sleeve", description: "12-inch sleeve with record", colorable: true, defaultColor: "#d64f2b", swatches: ["#d64f2b", "#f2d04b", "#3d6fd6", "#f4f3ef", "#16171a"], defaultPlacement: { fit: "cover", scale: 1, offsetX: 0, offsetY: 0, rotation: 0 } },
  { id: "phone", name: "Phone screen", description: "Tilted phone, full-bleed screen", colorable: true, defaultColor: "#c9ccd6", swatches: ["#c9ccd6", "#e9d8c8", "#1d2230", "#cfe0d4", "#e7c9d3"], defaultPlacement: { fit: "cover", scale: 1, offsetX: 0, offsetY: 0, rotation: 0 } },
];

export function sceneInfo(id: MockupSceneId): SceneInfo {
  const info = MOCKUP_SCENES.find(scene => scene.id === id);
  if (!info) throw new Error(`Unknown mockup scene: ${id}`);
  return info;
}

export const MOCKUP_SIZE_LIMITS = { min: 64, max: 2400 } as const;

export type SceneOptions = { size?: number; color?: string };

export function createMockupScene(id: MockupSceneId, options: SceneOptions = {}): MockupScene {
  const size = Math.round(options.size ?? 1200);
  if (!Number.isFinite(size) || size < MOCKUP_SIZE_LIMITS.min || size > MOCKUP_SIZE_LIMITS.max) throw new Error(`Mockup size must be ${MOCKUP_SIZE_LIMITS.min}–${MOCKUP_SIZE_LIMITS.max} px`);
  const info = sceneInfo(id);
  const color = hexToRgb(options.color ?? info.defaultColor);
  switch (id) {
    case "tshirt": return tshirt(size, color);
    case "hoodie": return hoodie(size, color);
    case "tote": return tote(size, color);
    case "poster": return poster(size, color);
    case "vinyl": return vinyl(size, color);
    case "phone": return phone(size, color);
  }
}

// ---------------------------------------------------------------------------
// Shared scene machinery
// ---------------------------------------------------------------------------

type RGB = readonly [number, number, number];

class Builder {
  readonly n: number;
  readonly r: Float32Array; readonly g: Float32Array; readonly b: Float32Array;
  overlay: Float32Array | null = null;
  constructor(readonly size: number) {
    this.n = size * size;
    this.r = new Float32Array(this.n); this.g = new Float32Array(this.n); this.b = new Float32Array(this.n);
  }
  mask(): Mask { return new Float32Array(this.n); }
  px(points: readonly Point[]): Point[] { return points.map(([x, y]) => [x * this.size, y * this.size] as Point); }
  fill(mask: Mask, polygons: readonly (readonly Point[])[], op = OVER, strength = 1) { fillPolygons(mask, this.size, this.size, polygons, op, strength); return mask; }
  stroke(mask: Mask, points: readonly Point[], width: number, op = OVER, strength = 1, closed = false) {
    strokePolyline(mask, this.size, this.size, points, width * this.size, op, strength, closed); return mask;
  }
  blur(mask: Mask, radius: number) { return blurMask(mask, this.size, this.size, radius * this.size); }
  shift(mask: Mask, dx: number, dy: number) { return shiftMask(mask, this.size, this.size, dx * this.size, dy * this.size); }
  /** Background: vertical gradient, soft vignette and a whisper of grain. */
  backdrop(top: RGB, bottom: RGB, vignette = 0.12, seed = 1) {
    const s = this.size;
    for (let y = 0; y < s; y++) {
      const t = y / (s - 1);
      for (let x = 0; x < s; x++) {
        const i = y * s + x, dx = x / s - 0.5, dy = y / s - 0.45;
        const v = 1 - vignette * smoothstep(0.2, 0.75, Math.sqrt(dx * dx + dy * dy));
        const n = 1 + grain(x, y, seed) * 0.012 + fbm(x / s * 6, y / s * 6, 2, seed) * 0.02;
        this.r[i] = (top[0] + (bottom[0] - top[0]) * t) * v * n;
        this.g[i] = (top[1] + (bottom[1] - top[1]) * t) * v * n;
        this.b[i] = (top[2] + (bottom[2] - top[2]) * t) * v * n;
      }
    }
  }
  /** Darken (factor < 1) or lighten where the mask is set. */
  multiply(mask: Mask, factor: number) {
    for (let i = 0; i < this.n; i++) {
      const m = mask[i]; if (!m) continue;
      const k = 1 - m * (1 - factor);
      this.r[i] *= k; this.g[i] *= k; this.b[i] *= k;
    }
  }
  paint(mask: Mask, color: RGB | ((i: number) => RGB), opacity = 1) {
    for (let i = 0; i < this.n; i++) {
      const m = mask[i] * opacity; if (m <= 0) continue;
      const c = typeof color === "function" ? color(i) : color;
      this.r[i] += (c[0] - this.r[i]) * m; this.g[i] += (c[1] - this.g[i]) * m; this.b[i] += (c[2] - this.b[i]) * m;
    }
  }
  ensureOverlay() { return this.overlay ??= new Float32Array(this.n * 4); }
  /** Premultiplied overlay painting (things in front of the print). */
  over(mask: Mask, color: RGB | ((i: number) => RGB), opacity = 1) {
    const o = this.ensureOverlay();
    for (let i = 0; i < this.n; i++) {
      const a = mask[i] * opacity; if (a <= 0) continue;
      const c = typeof color === "function" ? color(i) : color, p = i * 4;
      o[p] = c[0] * a + o[p] * (1 - a); o[p + 1] = c[1] * a + o[p + 1] * (1 - a); o[p + 2] = c[2] * a + o[p + 2] * (1 - a); o[p + 3] = a + o[p + 3] * (1 - a);
    }
  }
  rgba(): Uint8ClampedArray {
    const out = new Uint8ClampedArray(this.n * 4);
    for (let i = 0; i < this.n; i++) {
      out[i * 4] = this.r[i] * 255; out[i * 4 + 1] = this.g[i] * 255; out[i * 4 + 2] = this.b[i] * 255; out[i * 4 + 3] = 255;
    }
    return out;
  }
  scene(id: MockupSceneId, surface: MockupSurface, quad: Quad, printAspect: number, shading: Float32Array, printMask: Mask, displaceX?: Float32Array, displaceY?: Float32Array): MockupScene {
    const s = this.size;
    let x0 = s, y0 = s, x1 = -1, y1 = -1;
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) if (printMask[y * s + x] > 0) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (x1 < 0) throw new Error(`Mockup scene ${id} has no printable area`);
    return {
      id, name: sceneInfo(id).name, width: s, height: s, base: this.rgba(), shading, printMask,
      displaceX: displaceX ?? new Float32Array(this.n), displaceY: displaceY ?? new Float32Array(this.n),
      overlay: this.overlay, quad: quad.map(([x, y]) => [x * s, y * s]) as unknown as Quad, printAspect, surface,
      bounds: { x0, y0, x1, y1 },
    };
  }
}

/** A soft ridge (positive amp) or crease (negative amp) along a segment, in normalized units. */
type Fold = { a: Point; b: Point; width: number; amp: number };

function addFolds(height: Float32Array, size: number, folds: readonly Fold[]) {
  for (const { a, b, width, amp } of folds) {
    const ax = a[0] * size, ay = a[1] * size, bx = b[0] * size, by = b[1] * size, w = width * size;
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - 3 * w)), x1 = Math.min(size - 1, Math.ceil(Math.max(ax, bx) + 3 * w));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by) - 3 * w)), y1 = Math.min(size - 1, Math.ceil(Math.max(ay, by) + 3 * w));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const t = len2 ? ((x - ax) * dx + (y - ay) * dy) / len2 : 0;
      if (t <= 0 || t >= 1) continue;
      const d = Math.hypot(x - ax - t * dx, y - ay - t * dy) / w;
      if (d > 3) continue;
      // Folds fade in and out along their length, like real drape.
      height[y * size + x] += amp * Math.exp(-d * d) * Math.pow(Math.sin(Math.PI * t), 0.8);
    }
  }
}

type Lighting = { shade: Float32Array; displaceX: Float32Array; displaceY: Float32Array };

/**
 * Turn a height field into a light multiplier and a displacement field. The
 * displacement is proportional to height (like a classic displacement map),
 * so a straight line crossing a fold bends over it; the light follows the
 * surface normal from a top-left key light.
 */
function lightFromHeight(height: Float32Array, size: number, strength: number, displacement: number, within: Mask): Lighting {
  const shade = new Float32Array(size * size).fill(1);
  const displaceX = new Float32Array(size * size), displaceY = new Float32Array(size * size);
  const L = [-0.45, -0.65, 1], ll = Math.hypot(L[0], L[1], L[2]);
  const lx = L[0] / ll, ly = L[1] / ll, lz = L[2] / ll;
  const scale = size / 2;
  for (let y = 1; y < size - 1; y++) for (let x = 1; x < size - 1; x++) {
    const i = y * size + x;
    if (within[i] <= 0) continue;
    const gx = (height[i + 1] - height[i - 1]) * scale * strength;
    const gy = (height[i + size] - height[i - size]) * scale * strength;
    const nl = Math.hypot(gx, gy, 1);
    shade[i] = (-gx * lx - gy * ly + lz) / nl / lz;
    displaceX[i] = -height[i] * size * displacement * 0.35;
    displaceY[i] = -height[i] * size * displacement;
  }
  return { shade, displaceX, displaceY };
}

type Texture = "jersey" | "fleece" | "canvas";

function textureAt(kind: Texture, x: number, y: number, size: number) {
  const u = x / size, v = y / size;
  if (kind === "canvas") {
    const p = Math.max(3, size / 420);
    const weave = Math.sin(x / p * Math.PI) * Math.sin(y / p * Math.PI);
    return 1 + weave * 0.03 + grain(x, y, 7) * 0.05 + fbm(u * 90, v * 12, 2, 3) * 0.06;
  }
  if (kind === "fleece") return 1 + grain(x, y, 5) * 0.035 + fbm(u * 140, v * 140, 2, 9) * 0.05;
  // Jersey knit columns. Below ~3 px per column the pattern aliases into
  // stripes at preview sizes, so the period never drops under that.
  const p = Math.max(3, size / 480);
  return 1 + (Math.abs(Math.sin(x / p * Math.PI)) - 0.64) * 0.022 + grain(x, y, 3) * 0.03 + fbm(u * 60, v * 60, 2, 4) * 0.025;
}

type GarmentSpec = {
  id: MockupSceneId;
  size: number;
  color: RGB;
  backdrop: [RGB, RGB];
  /** Main fabric, normalized polygons. */
  body: Point[][];
  /** Fabric seen through an opening (back of neck, inside of hood, back handle): drawn darker, never printed on. */
  inner?: { polygons: Point[][]; shade: number }[];
  seams?: { points: Point[]; width: number; depth: number; closed?: boolean }[];
  /** Raised regions (pocket, collar, ribbing) as polygons with a height. */
  raised?: { polygons: Point[][]; height: number; ribs?: number }[];
  folds: Fold[];
  print: Quad;
  texture: Texture;
  overlay?: (builder: Builder, shadeAt: (i: number) => number) => void;
};

function garment(spec: GarmentSpec): MockupScene {
  const { size, color } = spec;
  const B = new Builder(size);
  B.backdrop(spec.backdrop[0], spec.backdrop[1], 0.14, size);
  // Each polygon composites separately: even-odd filling of overlapping
  // parts (body + hood) in one pass would punch holes where they overlap.
  const body = B.mask();
  for (const polygon of spec.body) B.fill(body, [B.px(polygon)]);
  const inner = B.mask(), innerShade = new Float32Array(B.n).fill(1);
  for (const part of spec.inner ?? []) {
    const m = B.fill(B.mask(), part.polygons.map(p => B.px(p)));
    for (let i = 0; i < B.n; i++) if (m[i] > 0) { inner[i] = OVER(inner[i], m[i]); innerShade[i] *= 1 - m[i] * (1 - part.shade); }
  }
  // An opening (inside of the hood, back of the neck) is never printable.
  const cover = B.mask();
  for (let i = 0; i < B.n; i++) { cover[i] = body[i] + inner[i] * (1 - body[i]); body[i] *= 1 - inner[i]; }
  // Soft contact shadow plus a wider ambient one: the cloth lies on a surface.
  B.multiply(B.blur(B.shift(cover, 0.004, 0.009), 0.022), 0.62);
  B.multiply(B.blur(B.shift(cover, 0.01, 0.02), 0.05), 0.82);

  const height = new Float32Array(B.n);
  addFolds(height, size, spec.folds);
  for (const part of spec.raised ?? []) {
    const m = B.blur(B.fill(B.mask(), part.polygons.map(p => B.px(p))), 0.004);
    for (let i = 0; i < B.n; i++) if (m[i] > 0) {
      const x = i % size, rib = part.ribs ? Math.sin(x / (size / part.ribs) * Math.PI * 2) * 0.0012 : 0;
      height[i] += m[i] * (part.height + rib);
    }
  }
  for (const seam of spec.seams ?? []) {
    const m = B.blur(B.stroke(B.mask(), B.px(seam.points), seam.width, OVER, 1, seam.closed), 0.0025);
    for (let i = 0; i < B.n; i++) height[i] -= m[i] * seam.depth;
  }
  const smooth = blurMask(height, size, size, size * 0.004);
  const lit = lightFromHeight(smooth, size, 1.15, 0.55, cover);
  // Volume: cloth turns away from the light at its edges.
  const volume = B.blur(cover, 0.028);
  const shading = new Float32Array(B.n).fill(1);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    if (cover[i] <= 0) continue;
    const falloff = 0.74 + 0.26 * smoothstep(0.3, 0.95, volume[i]);
    const key = 1.04 - 0.08 * (x + y) / (2 * size);
    shading[i] = lit.shade[i] * falloff * key * textureAt(spec.texture, x, y, size) * innerShade[i];
  }
  // Dark cloth shows folds through sheen rather than shadow, so the additive
  // lift grows as the colour darkens; otherwise a black hoodie reads flat.
  const lum = color[0] * 0.3 + color[1] * 0.59 + color[2] * 0.11, liftGain = 0.18 + 0.3 * (1 - lum);
  B.paint(cover, i => {
    const s = shading[i], lift = (s - 1) * liftGain;
    return [clamp01(color[0] * s + lift), clamp01(color[1] * s + lift), clamp01(color[2] * s + lift)];
  });
  const printArea = B.fill(B.mask(), [B.px(spec.print as unknown as Point[])]);
  const printMask = B.mask();
  for (let i = 0; i < B.n; i++) printMask[i] = printArea[i] * body[i];
  spec.overlay?.(B, i => shading[i]);
  const quad = spec.print;
  const w = Math.hypot(quad[1][0] - quad[0][0], quad[1][1] - quad[0][1]), h = Math.hypot(quad[3][0] - quad[0][0], quad[3][1] - quad[0][1]);
  return B.scene(spec.id, "fabric", quad, w / h, shading, printMask, lit.displaceX, lit.displaceY);
}

const studioBackdrop: [RGB, RGB] = [[0.925, 0.92, 0.905], [0.85, 0.84, 0.82]];

// ---------------------------------------------------------------------------
// T-shirt
// ---------------------------------------------------------------------------

function tshirt(size: number, color: RGB): MockupScene {
  const right = new PathBuilder(1)
    .move(0.5, 0.215).cubic(0.54, 0.214, 0.575, 0.19, 0.585, 0.155) // front neckline
    .cubic(0.63, 0.17, 0.67, 0.18, 0.7, 0.195) // shoulder
    .cubic(0.76, 0.22, 0.82, 0.27, 0.865, 0.33) // sleeve top
    .line(0.80, 0.405) // cuff
    .cubic(0.77, 0.38, 0.735, 0.36, 0.71, 0.35) // under-sleeve
    .cubic(0.705, 0.5, 0.715, 0.7, 0.72, 0.865) // side seam
    .cubic(0.62, 0.875, 0.56, 0.872, 0.5, 0.874) // hem
    .build();
  const body = mirrorClosed(right, 1);
  const backNeck = new PathBuilder(1).move(0.415, 0.155).cubic(0.45, 0.17, 0.55, 0.17, 0.585, 0.155).cubic(0.575, 0.19, 0.54, 0.214, 0.5, 0.215).cubic(0.46, 0.214, 0.425, 0.19, 0.415, 0.155).build();
  const backCollar = new PathBuilder(1).move(0.405, 0.149).cubic(0.44, 0.141, 0.56, 0.141, 0.595, 0.149).line(0.585, 0.155).cubic(0.55, 0.17, 0.45, 0.17, 0.415, 0.155).build();
  const neckline = new PathBuilder(1).move(0.415, 0.155).cubic(0.425, 0.19, 0.46, 0.214, 0.5, 0.215).cubic(0.54, 0.214, 0.575, 0.19, 0.585, 0.155).build();
  const collarBand = new PathBuilder(1).move(0.405, 0.15).cubic(0.418, 0.2, 0.46, 0.232, 0.5, 0.233).cubic(0.54, 0.232, 0.582, 0.2, 0.595, 0.15)
    .line(0.585, 0.155).cubic(0.575, 0.19, 0.54, 0.214, 0.5, 0.215).cubic(0.46, 0.214, 0.425, 0.19, 0.415, 0.155).build();
  const folds: Fold[] = [
    { a: [0.69, 0.37], b: [0.57, 0.58], width: 0.018, amp: 0.010 },
    { a: [0.31, 0.37], b: [0.44, 0.6], width: 0.02, amp: 0.009 },
    { a: [0.66, 0.42], b: [0.6, 0.7], width: 0.03, amp: -0.006 },
    { a: [0.34, 0.45], b: [0.39, 0.74], width: 0.028, amp: -0.005 },
    { a: [0.33, 0.79], b: [0.67, 0.81], width: 0.012, amp: 0.006 },
    { a: [0.36, 0.835], b: [0.62, 0.83], width: 0.01, amp: -0.004 },
    { a: [0.73, 0.25], b: [0.83, 0.36], width: 0.012, amp: 0.006 },
    { a: [0.27, 0.25], b: [0.18, 0.35], width: 0.012, amp: 0.006 },
    { a: [0.52, 0.47], b: [0.47, 0.66], width: 0.035, amp: 0.004 },
    { a: [0.45, 0.24], b: [0.56, 0.3], width: 0.02, amp: -0.003 },
  ];
  return garment({
    id: "tshirt", size, color, backdrop: studioBackdrop, texture: "jersey",
    body: [body, backCollar],
    inner: [{ polygons: [backNeck], shade: 0.62 }],
    raised: [{ polygons: [collarBand], height: 0.004, ribs: 260 }],
    seams: [
      { points: neckline.map(([x, y]) => [x, y + 0.018] as Point), width: 0.0022, depth: 0.004 },
      { points: [[0.7, 0.195], [0.71, 0.35]], width: 0.002, depth: 0.003 },
      { points: [[0.3, 0.195], [0.29, 0.35]], width: 0.002, depth: 0.003 },
      { points: [[0.29, 0.85], [0.71, 0.85]], width: 0.002, depth: 0.003 },
      { points: [[0.81, 0.39], [0.855, 0.335]], width: 0.002, depth: 0.003 },
      { points: [[0.19, 0.39], [0.145, 0.335]], width: 0.002, depth: 0.003 },
    ],
    folds,
    print: [[0.375, 0.27], [0.625, 0.27], [0.625, 0.6], [0.375, 0.6]],
  });
}

// ---------------------------------------------------------------------------
// Hoodie
// ---------------------------------------------------------------------------

function hoodie(size: number, color: RGB): MockupScene {
  const right = new PathBuilder(1)
    .move(0.5, 0.235).cubic(0.54, 0.235, 0.58, 0.215, 0.6, 0.185)
    .cubic(0.65, 0.2, 0.7, 0.215, 0.735, 0.24) // shoulder
    .cubic(0.8, 0.33, 0.85, 0.5, 0.87, 0.74) // sleeve outer
    .line(0.875, 0.835).line(0.805, 0.845) // cuff
    .cubic(0.79, 0.65, 0.77, 0.5, 0.735, 0.4) // sleeve inner
    .cubic(0.73, 0.55, 0.735, 0.75, 0.74, 0.905) // side
    .line(0.5, 0.91)
    .build();
  const body = mirrorClosed(right, 1);
  const hood = new PathBuilder(1).move(0.4, 0.19).cubic(0.37, 0.12, 0.42, 0.065, 0.5, 0.06).cubic(0.58, 0.065, 0.63, 0.12, 0.6, 0.19)
    .cubic(0.58, 0.215, 0.54, 0.235, 0.5, 0.235).cubic(0.46, 0.235, 0.42, 0.215, 0.4, 0.19).build();
  const hoodOpening = new PathBuilder(1).move(0.43, 0.185).cubic(0.43, 0.13, 0.46, 0.105, 0.5, 0.105).cubic(0.54, 0.105, 0.57, 0.13, 0.57, 0.185)
    .cubic(0.55, 0.205, 0.525, 0.212, 0.5, 0.212).cubic(0.475, 0.212, 0.45, 0.205, 0.43, 0.185).build();
  const pocket = new PathBuilder(1).move(0.37, 0.64).line(0.63, 0.64).cubic(0.66, 0.7, 0.675, 0.78, 0.68, 0.835).line(0.32, 0.835).cubic(0.325, 0.78, 0.34, 0.7, 0.37, 0.64).build();
  const hem = [[0.26, 0.855], [0.74, 0.855], [0.74, 0.905], [0.26, 0.91]] as Point[];
  const cuffR = [[0.802, 0.79], [0.873, 0.785], [0.875, 0.835], [0.805, 0.845]] as Point[];
  const cuffL = cuffR.map(([x, y]) => [1 - x, y] as Point);
  return garment({
    id: "hoodie", size, color, backdrop: [[0.9, 0.9, 0.9], [0.8, 0.8, 0.81]], texture: "fleece",
    body: [body, hood],
    inner: [{ polygons: [hoodOpening], shade: 0.42 }],
    raised: [
      { polygons: [pocket], height: 0.005 },
      { polygons: [hem, cuffR, cuffL], height: 0.002, ribs: 210 },
      { polygons: [hood], height: 0.008 },
    ],
    seams: [
      { points: pocket, width: 0.0022, depth: 0.004, closed: true },
      { points: [[0.26, 0.855], [0.74, 0.855]], width: 0.002, depth: 0.003 },
      { points: [[0.802, 0.79], [0.873, 0.785]], width: 0.002, depth: 0.003 },
      { points: [[0.198, 0.79], [0.127, 0.785]], width: 0.002, depth: 0.003 },
      { points: [[0.735, 0.24], [0.735, 0.4]], width: 0.002, depth: 0.003 },
      { points: [[0.265, 0.24], [0.265, 0.4]], width: 0.002, depth: 0.003 },
      { points: [[0.5, 0.075], [0.5, 0.104]], width: 0.002, depth: 0.003 },
    ],
    folds: [
      { a: [0.72, 0.42], b: [0.6, 0.6], width: 0.022, amp: 0.011 },
      { a: [0.28, 0.42], b: [0.41, 0.6], width: 0.022, amp: 0.01 },
      { a: [0.8, 0.45], b: [0.84, 0.7], width: 0.015, amp: 0.008 },
      { a: [0.2, 0.45], b: [0.16, 0.7], width: 0.015, amp: 0.008 },
      { a: [0.82, 0.6], b: [0.86, 0.66], width: 0.01, amp: -0.006 },
      { a: [0.18, 0.6], b: [0.14, 0.66], width: 0.01, amp: -0.006 },
      { a: [0.45, 0.42], b: [0.58, 0.47], width: 0.03, amp: -0.004 },
      { a: [0.3, 0.62], b: [0.33, 0.8], width: 0.02, amp: 0.006 },
    ],
    print: [[0.38, 0.27], [0.62, 0.27], [0.62, 0.59], [0.38, 0.59]],
    overlay(B, shadeAt) {
      // Drawstrings hang in front of the print.
      const strings = B.mask();
      const left = new PathBuilder(size).move(0.465, 0.205).cubic(0.462, 0.27, 0.458, 0.33, 0.452, 0.39).build();
      const rightString = new PathBuilder(size).move(0.535, 0.205).cubic(0.54, 0.28, 0.545, 0.34, 0.552, 0.41).build();
      strokePolyline(strings, size, size, left, size * 0.009);
      strokePolyline(strings, size, size, rightString, size * 0.009);
      const shadow = B.blur(B.shift(strings, 0.003, 0.005), 0.004);
      B.over(shadow, [0, 0, 0], 0.35);
      const lum = color[0] * 0.3 + color[1] * 0.59 + color[2] * 0.11;
      const stringColor: RGB = lum < 0.3 ? [0.88, 0.88, 0.86] : [color[0] * 0.92, color[1] * 0.92, color[2] * 0.92];
      B.over(strings, i => { const s = shadeAt(i) * (0.95 + grain(i % size, Math.floor(i / size), 2) * 0.1); return [clamp01(stringColor[0] * s), clamp01(stringColor[1] * s), clamp01(stringColor[2] * s)]; });
      const tips = B.mask();
      strokePolyline(tips, size, size, [[0.452 * size, 0.385 * size], [0.451 * size, 0.405 * size]], size * 0.011);
      strokePolyline(tips, size, size, [[0.552 * size, 0.405 * size], [0.553 * size, 0.425 * size]], size * 0.011);
      B.over(tips, [0.72, 0.72, 0.74]);
      const eyelets = B.mask();
      fillPolygons(eyelets, size, size, [ellipse(0.465 * size, 0.205 * size, size * 0.007, size * 0.007), ellipse(0.535 * size, 0.205 * size, size * 0.007, size * 0.007)]);
      B.over(eyelets, [0.6, 0.6, 0.62]);
    },
  });
}

// ---------------------------------------------------------------------------
// Tote bag
// ---------------------------------------------------------------------------

function tote(size: number, color: RGB): MockupScene {
  const bag = new PathBuilder(1).move(0.255, 0.32).cubic(0.42, 0.315, 0.58, 0.315, 0.745, 0.32)
    .cubic(0.755, 0.5, 0.765, 0.72, 0.775, 0.89).cubic(0.6, 0.9, 0.4, 0.9, 0.225, 0.89).cubic(0.235, 0.72, 0.245, 0.5, 0.255, 0.32).build();
  const handle = (x0: number, x1: number, top: number) => new PathBuilder(1).move(x0, 0.33).cubic(x0 - 0.01, top, x1 + 0.01, top, x1, 0.33).build();
  return garment({
    id: "tote", size, color, backdrop: [[0.86, 0.87, 0.85], [0.76, 0.77, 0.75]], texture: "canvas",
    body: [bag],
    inner: [],
    raised: [{ polygons: [[[0.255, 0.32], [0.745, 0.32], [0.747, 0.36], [0.253, 0.36]]], height: 0.002 }],
    seams: [
      { points: [[0.254, 0.36], [0.746, 0.36]], width: 0.002, depth: 0.003 },
      { points: [[0.35, 0.33], [0.39, 0.33], [0.39, 0.355], [0.35, 0.355]], width: 0.0018, depth: 0.003, closed: true },
      { points: [[0.61, 0.33], [0.65, 0.33], [0.65, 0.355], [0.61, 0.355]], width: 0.0018, depth: 0.003, closed: true },
    ],
    folds: [
      { a: [0.33, 0.38], b: [0.31, 0.86], width: 0.02, amp: 0.006 },
      { a: [0.68, 0.38], b: [0.7, 0.86], width: 0.025, amp: -0.005 },
      { a: [0.5, 0.36], b: [0.52, 0.6], width: 0.04, amp: 0.004 },
      { a: [0.26, 0.6], b: [0.74, 0.62], width: 0.012, amp: -0.004 },
      { a: [0.28, 0.85], b: [0.72, 0.855], width: 0.02, amp: 0.005 },
    ],
    print: [[0.31, 0.4], [0.69, 0.4], [0.704, 0.78], [0.296, 0.78]],
    overlay(B) {
      // Front handle in front of the bag top; back handle peeks out behind.
      const back = B.mask(), front = B.mask();
      strokePolyline(back, size, size, B.px(handle(0.4, 0.6, 0.085)), size * 0.03);
      strokePolyline(front, size, size, B.px(handle(0.37, 0.63, 0.1)), size * 0.036);
      // The back handle is only visible above the bag.
      for (let i = 0; i < B.n; i++) if (Math.floor(i / size) > 0.33 * size) back[i] = 0;
      for (let i = 0; i < B.n; i++) if (Math.floor(i / size) > 0.352 * size) front[i] = 0;
      const shadow = B.blur(B.shift(front, 0.004, 0.008), 0.008);
      B.over(shadow, [0, 0, 0], 0.25);
      const tex = (k: number) => (i: number): RGB => { const x = i % size, y = Math.floor(i / size), s = k * textureAt("canvas", x, y, size) * (1.02 - 0.12 * y / size); return [clamp01(color[0] * s), clamp01(color[1] * s), clamp01(color[2] * s)]; };
      B.over(back, tex(0.66));
      B.over(front, tex(0.96));
      const edge = B.mask();
      strokePolyline(edge, size, size, B.px(handle(0.37, 0.63, 0.1)), size * 0.0025);
      for (let i = 0; i < B.n; i++) if (Math.floor(i / size) > 0.352 * size) edge[i] = 0;
      B.over(edge, [0, 0, 0], 0.18);
    },
  });
}

// ---------------------------------------------------------------------------
// Poster on wall
// ---------------------------------------------------------------------------

function quadLerp(H: ReturnType<typeof squareToQuad>, u0: number, v0: number, u1: number, v1: number): Point[] {
  return [applyHomography(H, u0, v0), applyHomography(H, u1, v0), applyHomography(H, u1, v1), applyHomography(H, u0, v1)];
}

function poster(size: number, wall: RGB): MockupScene {
  const B = new Builder(size);
  const s = size;
  // Wall: plaster texture, window light from the upper left.
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const i = y * s + x, u = x / s, v = y / s;
    const light = 1.06 - 0.22 * smoothstep(0, 1.2, u * 0.8 + v * 0.5);
    const plaster = 1 + fbm(u * 18, v * 18, 3, 11) * 0.035 + grain(x, y, 4) * 0.012;
    B.r[i] = wall[0] * light * plaster; B.g[i] = wall[1] * light * plaster; B.b[i] = wall[2] * light * plaster;
  }
  // Soft window patch.
  const windowLight = B.blur(B.fill(B.mask(), [B.px([[0.02, 0.05], [0.2, 0.0], [0.34, 0.55], [0.1, 0.66]])]), 0.08);
  for (let i = 0; i < B.n; i++) { const k = 1 + windowLight[i] * 0.07; B.r[i] *= k; B.g[i] *= k * 0.995; B.b[i] *= k * 0.98; }
  // Floor and skirting board.
  const floor = B.fill(B.mask(), [B.px([[0, 0.865], [1, 0.865], [1, 1], [0, 1]])]);
  B.paint(floor, i => {
    const x = i % s, y = Math.floor(i / s), u = x / s, v = y / s;
    const plank = Math.floor((v - 0.865) / 0.035 + u * 0.02);
    const grainLine = fbm(u * 4 + plank * 3.1, v * 120, 3, 21 + plank) * 0.25;
    const k = (0.92 + valueNoise(plank * 7.3, 0.5, 5) * 0.16) * (1 + grainLine) * (0.82 + 0.18 * (v - 0.865) / 0.135);
    return [0.56 * k, 0.41 * k, 0.29 * k];
  });
  const boardShadow = B.blur(B.fill(B.mask(), [B.px([[0, 0.86], [1, 0.86], [1, 0.865], [0, 0.865]])]), 0.012);
  B.multiply(boardShadow, 0.8);
  const board = B.fill(B.mask(), [B.px([[0, 0.835], [1, 0.835], [1, 0.865], [0, 0.865]])]);
  B.paint(board, i => { const y = Math.floor(i / s) / s; const k = y < 0.84 ? 1.03 : 0.93; return [0.93 * k, 0.92 * k, 0.9 * k]; });

  const quad: Quad = [[0.285, 0.125], [0.69, 0.16], [0.69, 0.705], [0.285, 0.76]];
  const H = squareToQuad(quad.map(([x, y]) => [x * s, y * s]) as unknown as Quad);
  // Physical aspect 3:4. Mat and frame widths in the poster's own units.
  const aspect = 0.75, mat = 0.06, frame = 0.032;
  const mu = mat / aspect, fu = frame / aspect;
  const frameOuter = quadLerp(H, -mu - fu, -mat - frame, 1 + mu + fu, 1 + mat + frame);
  const matOuter = quadLerp(H, -mu, -mat, 1 + mu, 1 + mat);
  const art = quadLerp(H, 0, 0, 1, 1);
  const outer = B.mask(); fillPolygon(outer, s, s, frameOuter);
  B.multiply(B.blur(B.shift(outer, 0.016, 0.022), 0.03), 0.55);
  B.multiply(B.blur(B.shift(outer, 0.004, 0.006), 0.006), 0.75);
  const frameRing = B.mask(); fillPolygon(frameRing, s, s, frameOuter); fillPolygon(frameRing, s, s, matOuter, ERASE);
  B.paint(frameRing, i => { const n = 1 + grain(i % s, Math.floor(i / s), 8) * 0.06; return [0.075 * n, 0.07 * n, 0.068 * n]; });
  // Bevel highlight on the frame's top/left inner and outer edges.
  const bevel = B.mask();
  strokePolyline(bevel, s, s, [frameOuter[3], frameOuter[0], frameOuter[1]], s * 0.003);
  B.paint(bevel, [0.35, 0.35, 0.35], 0.6);
  const matMask = B.mask(); fillPolygon(matMask, s, s, matOuter); fillPolygon(matMask, s, s, art, ERASE);
  B.paint(matMask, i => { const x = i % s, y = Math.floor(i / s), k = (0.965 - 0.05 * y / s) * (1 + grain(x, y, 12) * 0.01); return [k, k * 0.995, k * 0.985]; });
  // Mat bevel: a lit cut edge around the print and a shadow cast by the frame.
  const matShadow = B.blur(B.stroke(B.mask(), [matOuter[3], matOuter[0], matOuter[1]], 0.008), 0.01);
  for (let i = 0; i < B.n; i++) matShadow[i] *= matMask[i];
  B.multiply(matShadow, 0.82);
  const cut = B.mask(); strokePolyline(cut, s, s, art, s * 0.0022, OVER, 1, true);
  B.paint(cut, [0.995, 0.995, 0.99], 0.9);

  const printMask = B.mask(); fillPolygon(printMask, s, s, art);
  B.paint(printMask, i => { const x = i % s, y = Math.floor(i / s); const k = 0.955 * (1 + grain(x, y, 15) * 0.012); return [k, k, k * 0.985]; });
  const shading = new Float32Array(B.n).fill(1);
  const height = new Float32Array(B.n);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const i = y * s + x; if (printMask[i] <= 0) continue;
    height[i] = fbm(x / s * 3, y / s * 3, 2, 31) * 0.0016;
  }
  const lit = lightFromHeight(height, s, 1, 0.6, printMask);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const i = y * s + x; if (printMask[i] <= 0) continue;
    const light = 1.03 - 0.12 * smoothstep(0, 1.2, x / s * 0.8 + y / s * 0.5);
    shading[i] = lit.shade[i] * light * (1 + grain(x, y, 15) * 0.015);
  }
  // Glass glare in front of everything inside the frame.
  const glass = B.mask(); fillPolygon(glass, s, s, matOuter);
  const o = B.ensureOverlay();
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const i = y * s + x, g = glass[i]; if (g <= 0) continue;
    const band = Math.exp(-Math.pow((x / s * 1.0 + y / s * 0.7 - 0.62) / 0.06, 2)) * 0.13 + Math.exp(-Math.pow((x / s + y / s * 0.7 - 0.82) / 0.02, 2)) * 0.06 + 0.025;
    const a = g * band, p = i * 4;
    o[p] = a; o[p + 1] = a; o[p + 2] = a; o[p + 3] = a;
  }
  return B.scene("poster", "paper", quad, aspect, shading, printMask, lit.displaceX, lit.displaceY);
}

// ---------------------------------------------------------------------------
// Vinyl sleeve
// ---------------------------------------------------------------------------

function rotate([x, y]: Point, [cx, cy]: Point, angle: number): Point {
  const c = Math.cos(angle), sn = Math.sin(angle), dx = x - cx, dy = y - cy;
  return [cx + dx * c - dy * sn, cy + dx * sn + dy * c];
}

function vinyl(size: number, labelColor: RGB): MockupScene {
  const B = new Builder(size);
  const s = size;
  // Oak tabletop seen from above.
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const i = y * s + x, u = x / s, v = y / s;
    const ru = u * 0.97 + v * 0.24, rv = -u * 0.24 + v * 0.97;
    const board = Math.floor(rv / 0.21);
    const lines = Math.sin((rv * 140 + fbm(ru * 3, rv * 30, 3, 40 + board) * 9) * Math.PI) * 0.5 + 0.5;
    const k = (0.9 + valueNoise(board * 5.1, 1.5, 3) * 0.14) * (0.9 + lines * 0.1) * (1 + grain(x, y, 2) * 0.02);
    const seam = Math.abs(rv / 0.21 - Math.round(rv / 0.21)) < 0.004 ? 0.7 : 1;
    const vig = 1 - 0.18 * smoothstep(0.25, 0.8, Math.hypot(u - 0.48, v - 0.5));
    B.r[i] = 0.66 * k * seam * vig; B.g[i] = 0.5 * k * seam * vig; B.b[i] = 0.36 * k * seam * vig;
  }
  const angle = -5 * Math.PI / 180, center: Point = [0.43, 0.53], half = 0.305;
  const corner = (dx: number, dy: number) => rotate([center[0] + dx, center[1] + dy], center, angle);
  const quad: Quad = [corner(-half, -half), corner(half, -half), corner(half, half), corner(-half, half)];
  const discCenter = rotate([center[0] + 0.2, center[1] - 0.005], center, angle), discR = 0.29;
  const disc = B.mask(); fillPolygon(disc, s, s, B.px(ellipse(discCenter[0], discCenter[1], discR, discR, 0, 220)));
  B.multiply(B.blur(B.shift(disc, 0.01, 0.016), 0.022), 0.5);
  const [dcx, dcy] = [discCenter[0] * s, discCenter[1] * s];
  B.paint(disc, i => {
    const x = i % s + 0.5, y = Math.floor(i / s) + 0.5, dx = x - dcx, dy = y - dcy;
    const r = Math.hypot(dx, dy) / s, theta = Math.atan2(dy, dx);
    const groove = 0.5 + 0.5 * Math.sin(r * 2200);
    const sheen = Math.pow(Math.abs(Math.cos(theta - 0.6)), 14) * 0.22 + Math.pow(Math.abs(Math.cos(theta - 0.6 + Math.PI / 2)), 30) * 0.05;
    const band = r > 0.12 && r < 0.27 ? 1 : 0.6;
    const k = 0.045 + groove * 0.018 * band + sheen * band;
    return [k, k, k * 1.04];
  });
  const label = B.mask(); fillPolygon(label, s, s, B.px(ellipse(discCenter[0], discCenter[1], 0.095, 0.095, 0, 160)));
  B.paint(label, i => { const n = 1 + grain(i % s, Math.floor(i / s), 3) * 0.03; return [labelColor[0] * n, labelColor[1] * n, labelColor[2] * n]; });
  const ring = B.mask(); strokePolyline(ring, s, s, B.px(ellipse(discCenter[0], discCenter[1], 0.07, 0.07, 0, 120)), s * 0.0015, OVER, 1, true);
  B.paint(ring, [0, 0, 0], 0.25);
  const hole = B.mask(); fillPolygon(hole, s, s, B.px(ellipse(discCenter[0], discCenter[1], 0.0075, 0.0075, 0, 40)));
  B.paint(hole, [0.3, 0.22, 0.15]);

  const sleeve = B.mask(); fillPolygon(sleeve, s, s, B.px(quad as unknown as Point[]));
  B.multiply(B.blur(B.shift(sleeve, 0.008, 0.014), 0.02), 0.45);
  B.multiply(B.blur(B.shift(sleeve, 0.002, 0.004), 0.004), 0.7);
  // Cardboard: edges catch less light, slight edge wear.
  const inner = B.blur(sleeve, 0.006);
  const shading = new Float32Array(B.n).fill(1);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const i = y * s + x; if (sleeve[i] <= 0) continue;
    const edge = 0.9 + 0.1 * smoothstep(0.5, 1, inner[i]);
    const light = 1.04 - 0.1 * (x + y) / (2 * s);
    shading[i] = edge * light * (1 + grain(x, y, 19) * 0.018 + fbm(x / s * 40, y / s * 40, 2, 6) * 0.02);
  }
  B.paint(sleeve, i => { const k = 0.93 * shading[i]; return [k, k * 0.99, k * 0.97]; });
  // Wear along the open edge and a faint glare.
  const wear = B.mask(); strokePolyline(wear, s, s, B.px([quad[1], quad[2]]), s * 0.003);
  for (let i = 0; i < B.n; i++) wear[i] *= Math.max(0, valueNoise(i % s / s * 60, Math.floor(i / s) / s * 60, 77) - 0.35);
  const o = B.ensureOverlay();
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const i = y * s + x, m = sleeve[i]; if (m <= 0) continue;
    const a = m * (Math.exp(-Math.pow((x / s * 0.9 + y / s - 0.78) / 0.12, 2)) * 0.06) + wear[i] * 0.5, p = i * 4;
    const c = 0.97;
    o[p] = c * a; o[p + 1] = c * a; o[p + 2] = c * a; o[p + 3] = a;
  }
  return B.scene("vinyl", "paper", quad, 1, shading, sleeve);
}

// ---------------------------------------------------------------------------
// Phone screen
// ---------------------------------------------------------------------------

function phone(size: number, backdrop: RGB): MockupScene {
  const B = new Builder(size);
  const s = size;
  const top: RGB = [Math.min(1, backdrop[0] * 1.06), Math.min(1, backdrop[1] * 1.06), Math.min(1, backdrop[2] * 1.06)];
  const bottom: RGB = [backdrop[0] * 0.82, backdrop[1] * 0.82, backdrop[2] * 0.82];
  B.backdrop(top, bottom, 0.2, 77);
  // Phone body in its own physical units: width 1, height 2.167 (19.5:9).
  const W = 1, Hh = 2.167, bezel = 0.045;
  const body: Quad = [[0.335, 0.075], [0.685, 0.1], [0.665, 0.925], [0.3, 0.9]];
  const Hp = squareToQuad(body.map(([x, y]) => [x * s, y * s]) as unknown as Quad);
  const mapUV = (pts: Point[]) => pts.map(([u, v]) => applyHomography(Hp, u / W, v / Hh) as Point);
  const outline = mapUV(roundedRectUV(W, Hh, 0.15, 14));
  const screenUV = roundedRectUV(W - 2 * bezel, Hh - 2 * bezel, 0.11, 14).map(([u, v]) => [u + bezel, v + bezel] as Point);
  const screen = mapUV(screenUV);
  const bodyMask = B.mask(); fillPolygon(bodyMask, s, s, outline);
  B.multiply(B.blur(B.shift(bodyMask, 0.03, 0.04), 0.05), 0.55);
  B.multiply(B.blur(B.shift(bodyMask, 0.006, 0.01), 0.01), 0.6);
  // Side thickness: a darker copy offset toward the camera's right.
  const side = B.shift(bodyMask, 0.007, 0.004);
  B.paint(side, [0.2, 0.2, 0.22]);
  B.paint(bodyMask, i => { const y = Math.floor(i / s) / s; const k = 0.11 + 0.03 * (1 - y); return [k, k, k * 1.08]; });
  const rim = B.mask(); strokePolyline(rim, s, s, outline, s * 0.004, OVER, 1, true);
  B.paint(rim, i => { const x = i % s / s, y = Math.floor(i / s) / s; const k = 0.42 + 0.35 * smoothstep(0.2, 0.9, 1 - (x + y) / 1.6); return [k, k, k * 1.03]; });
  const printMask = B.mask(); fillPolygon(printMask, s, s, screen);
  B.paint(printMask, i => { const y = Math.floor(i / s) / s; const k = 0.03 + 0.03 * y; return [k, k, k * 1.2]; });
  const shading = new Float32Array(B.n).fill(1);
  // Glass glare and the camera island sit in front of the screen.
  const o = B.ensureOverlay();
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const i = y * s + x, m = bodyMask[i]; if (m <= 0) continue;
    const u = x / s, v = y / s;
    const a = m * (Math.exp(-Math.pow((u * 1.0 - v * 0.35 - 0.36) / 0.09, 2)) * 0.16 + 0.03 * (1 - v)), p = i * 4;
    o[p] = a; o[p + 1] = a; o[p + 2] = a; o[p + 3] = a;
  }
  const islandUV = roundedRectUV(0.32, 0.085, 0.0425, 8).map(([u, v]) => [u + 0.34, v + bezel + 0.04] as Point);
  const island = B.mask(); fillPolygon(island, s, s, mapUV(islandUV));
  B.over(island, [0.01, 0.01, 0.012]);
  const lens = B.mask();
  const [lx, ly] = applyHomography(Hp, 0.6 / W, (bezel + 0.0825) / Hh);
  fillPolygon(lens, s, s, ellipse(lx, ly, s * 0.0045, s * 0.0045));
  B.over(lens, [0.08, 0.1, 0.16]);
  const sq: Quad = [
    applyHomography(Hp, bezel / W, bezel / Hh), applyHomography(Hp, (W - bezel) / W, bezel / Hh),
    applyHomography(Hp, (W - bezel) / W, (Hh - bezel) / Hh), applyHomography(Hp, bezel / W, (Hh - bezel) / Hh),
  ].map(([x, y]) => [x / s, y / s]) as unknown as Quad;
  return B.scene("phone", "glossy", sq, (W - 2 * bezel) / (Hh - 2 * bezel), shading, printMask);
}
