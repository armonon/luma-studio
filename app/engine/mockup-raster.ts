/**
 * Small, deterministic raster primitives used to synthesize mockup scenes.
 *
 * Every mockup scene is drawn procedurally from these functions at runtime, so
 * no photograph or third-party template ships with Luma. They are DOM-free on
 * purpose: the same code runs in the browser and in `node --test`, and a scene
 * generated twice at the same size is bit-identical.
 */

export type Point = readonly [number, number];
export type Mask = Float32Array;

/** A coverage combiner: given the destination value and new coverage, return the new destination. */
export type CoverageOp = (dst: number, coverage: number) => number;
export const OVER: CoverageOp = (dst, c) => dst + c * (1 - dst);
export const ERASE: CoverageOp = (dst, c) => dst * (1 - c);
export const MAX: CoverageOp = (dst, c) => (c > dst ? c : dst);

const SUBROWS = 5;

/**
 * Anti-aliased scanline fill (even-odd) of one or more closed polygons into a
 * single-channel mask. Horizontal coverage is exact per span; vertical
 * coverage uses SUBROWS sample rows, which is plenty for soft product shots.
 */
export function fillPolygons(target: Mask, width: number, height: number, polygons: readonly (readonly Point[])[], op: CoverageOp = OVER, strength = 1) {
  let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity;
  for (const polygon of polygons) for (const [x, y] of polygon) {
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
  }
  if (!Number.isFinite(minY)) return;
  const y0 = Math.max(0, Math.floor(minY)), y1 = Math.min(height - 1, Math.ceil(maxY));
  const x0 = Math.max(0, Math.floor(minX)), x1 = Math.min(width - 1, Math.ceil(maxX));
  if (x1 < x0 || y1 < y0) return;
  const row = new Float32Array(x1 - x0 + 2);
  const crossings: number[] = [];
  for (let y = y0; y <= y1; y++) {
    row.fill(0);
    let touched = false;
    for (let s = 0; s < SUBROWS; s++) {
      const sy = y + (s + 0.5) / SUBROWS;
      crossings.length = 0;
      for (const polygon of polygons) {
        for (let i = 0, n = polygon.length; i < n; i++) {
          const [ax, ay] = polygon[i], [bx, by] = polygon[(i + 1) % n];
          if ((ay <= sy && by > sy) || (by <= sy && ay > sy)) crossings.push(ax + (sy - ay) / (by - ay) * (bx - ax));
        }
      }
      if (crossings.length < 2) continue;
      crossings.sort((a, b) => a - b);
      for (let i = 0; i + 1 < crossings.length; i += 2) {
        const a = Math.max(x0, crossings[i]), b = Math.min(x1 + 1, crossings[i + 1]);
        if (b <= a) continue;
        touched = true;
        const ia = Math.floor(a), ib = Math.floor(b), w = 1 / SUBROWS;
        if (ia === ib) { row[ia - x0] += (b - a) * w; continue; }
        row[ia - x0] += (ia + 1 - a) * w;
        for (let x = ia + 1; x < ib; x++) row[x - x0] += w;
        if (ib <= x1) row[ib - x0] += (b - ib) * w;
      }
    }
    if (!touched) continue;
    const base = y * width;
    for (let x = x0; x <= x1; x++) {
      const c = row[x - x0];
      if (c > 0) target[base + x] = op(target[base + x], Math.min(1, c) * strength);
    }
  }
}

export function fillPolygon(target: Mask, width: number, height: number, polygon: readonly Point[], op: CoverageOp = OVER, strength = 1) {
  fillPolygons(target, width, height, [polygon], op, strength);
}

/** Anti-aliased thick polyline (round joins/caps) via per-pixel segment distance. */
export function strokePolyline(target: Mask, width: number, height: number, points: readonly Point[], strokeWidth: number, op: CoverageOp = OVER, strength = 1, closed = false) {
  if (points.length < 2) return;
  const r = strokeWidth / 2;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  const x0 = Math.max(0, Math.floor(minX - r - 1)), y0 = Math.max(0, Math.floor(minY - r - 1));
  const x1 = Math.min(width - 1, Math.ceil(maxX + r + 1)), y1 = Math.min(height - 1, Math.ceil(maxY + r + 1));
  if (x1 < x0 || y1 < y0) return;
  const bw = x1 - x0 + 1, local = new Float32Array(bw * (y1 - y0 + 1));
  const segments = closed ? points.length : points.length - 1;
  for (let s = 0; s < segments; s++) {
    const [ax, ay] = points[s], [bx, by] = points[(s + 1) % points.length];
    const sx0 = Math.max(x0, Math.floor(Math.min(ax, bx) - r - 1)), sx1 = Math.min(x1, Math.ceil(Math.max(ax, bx) + r + 1));
    const sy0 = Math.max(y0, Math.floor(Math.min(ay, by) - r - 1)), sy1 = Math.min(y1, Math.ceil(Math.max(ay, by) + r + 1));
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    for (let y = sy0; y <= sy1; y++) for (let x = sx0; x <= sx1; x++) {
      const px = x + 0.5, py = y + 0.5;
      const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
      const d = Math.hypot(px - ax - t * dx, py - ay - t * dy);
      const c = Math.max(0, Math.min(1, r - d + 0.5));
      const at = (y - y0) * bw + (x - x0);
      if (c > local[at]) local[at] = c;
    }
  }
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const c = local[(y - y0) * bw + (x - x0)];
    if (c > 0) target[y * width + x] = op(target[y * width + x], c * strength);
  }
}

/** Three separable box passes approximate a Gaussian of the given sigma-ish radius. */
export function blurMask(source: Mask, width: number, height: number, radius: number): Mask {
  const r = Math.max(0, Math.round(radius / 1.7));
  const a = Float32Array.from(source);
  if (r < 1) return a;
  const b = new Float32Array(a.length);
  for (let pass = 0; pass < 3; pass++) {
    boxHorizontal(a, b, width, height, r);
    boxVertical(b, a, width, height, r);
  }
  return a;
}

function boxHorizontal(src: Float32Array, dst: Float32Array, w: number, h: number, r: number) {
  const norm = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += src[row + Math.min(w - 1, Math.max(0, k))];
    for (let x = 0; x < w; x++) {
      dst[row + x] = sum * norm;
      sum += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
}

function boxVertical(src: Float32Array, dst: Float32Array, w: number, h: number, r: number) {
  const norm = 1 / (2 * r + 1);
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += src[Math.min(h - 1, Math.max(0, k)) * w + x];
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = sum * norm;
      sum += src[Math.min(h - 1, y + r + 1) * w + x] - src[Math.max(0, y - r) * w + x];
    }
  }
}

/** Shift a mask by whole pixels (used for drop shadows). */
export function shiftMask(source: Mask, width: number, height: number, dx: number, dy: number): Mask {
  const out = new Float32Array(source.length), ox = Math.round(dx), oy = Math.round(dy);
  for (let y = 0; y < height; y++) {
    const sy = y - oy; if (sy < 0 || sy >= height) continue;
    for (let x = 0; x < width; x++) {
      const sx = x - ox; if (sx < 0 || sx >= width) continue;
      out[y * width + x] = source[sy * width + sx];
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Noise. Integer hashing keeps results identical across JS engines.
// ---------------------------------------------------------------------------

function hash2(x: number, y: number, seed: number) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

const fade = (t: number) => t * t * (3 - 2 * t);

/** Smooth value noise in [0, 1]. */
export function valueNoise(x: number, y: number, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed), c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  const u = fade(xf), v = fade(yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Fractal noise centred on 0, roughly in [-0.5, 0.5]. */
export function fbm(x: number, y: number, octaves = 4, seed = 0) {
  let sum = 0, amp = 0.5, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += (valueNoise(x * freq, y * freq, seed + i * 17) - 0.5) * amp;
    norm += amp; amp *= 0.5; freq *= 2.03;
  }
  return sum / norm;
}

/** Per-pixel white noise in [-0.5, 0.5]. */
export function grain(x: number, y: number, seed = 0) { return hash2(x, y, seed + 911) - 0.5; }

/** Deterministic PRNG for placing procedural details (mulberry32). */
export function seededRandom(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Path construction in normalized (0..1) scene coordinates.
// ---------------------------------------------------------------------------

export class PathBuilder {
  readonly points: [number, number][] = [];
  constructor(private readonly scale: number, private readonly steps = 18) {}
  move(x: number, y: number) { this.points.push([x * this.scale, y * this.scale]); return this; }
  line(x: number, y: number) { return this.move(x, y); }
  /** Cubic Bézier from the current point. */
  cubic(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number) {
    const [sx, sy] = this.points[this.points.length - 1];
    const p0 = [sx / this.scale, sy / this.scale];
    for (let i = 1; i <= this.steps; i++) {
      const t = i / this.steps, u = 1 - t;
      const bx = u * u * u * p0[0] + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * x;
      const by = u * u * u * p0[1] + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * y;
      this.points.push([bx * this.scale, by * this.scale]);
    }
    return this;
  }
  /** Quadratic Bézier from the current point. */
  quad(cx: number, cy: number, x: number, y: number) {
    const [sx, sy] = this.points[this.points.length - 1];
    const p0 = [sx / this.scale, sy / this.scale];
    return this.cubic(p0[0] + 2 / 3 * (cx - p0[0]), p0[1] + 2 / 3 * (cy - p0[1]), x + 2 / 3 * (cx - x), y + 2 / 3 * (cy - y), x, y);
  }
  build(): Point[] { return this.points.slice(); }
}

/** Mirror a right-half outline (x >= 0.5, listed top to bottom) into a closed symmetric polygon. */
export function mirrorClosed(rightHalf: readonly Point[], size: number): Point[] {
  const left = rightHalf.slice().reverse().map(([x, y]) => [size - x, y] as Point);
  return [...rightHalf, ...left];
}

export function ellipse(cx: number, cy: number, rx: number, ry: number, rotation = 0, segments = 96): Point[] {
  const out: Point[] = [], c = Math.cos(rotation), s = Math.sin(rotation);
  for (let i = 0; i < segments; i++) {
    const t = i / segments * Math.PI * 2, x = Math.cos(t) * rx, y = Math.sin(t) * ry;
    out.push([cx + x * c - y * s, cy + x * s + y * c]);
  }
  return out;
}

/** Rounded rectangle in local (u, v) coordinates, for later projective mapping. */
export function roundedRectUV(width: number, height: number, radius: number, cornerSteps = 10): Point[] {
  const r = Math.min(radius, width / 2, height / 2), out: Point[] = [];
  const corners: [number, number, number][] = [[width - r, r, -Math.PI / 2], [width - r, height - r, 0], [r, height - r, Math.PI / 2], [r, r, Math.PI]];
  for (const [cx, cy, start] of corners) for (let i = 0; i <= cornerSteps; i++) {
    const t = start + i / cornerSteps * Math.PI / 2;
    out.push([cx + Math.cos(t) * r, cy + Math.sin(t) * r]);
  }
  return out;
}

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export function smoothstep(a: number, b: number, v: number) { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); }

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`Invalid color ${hex}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}
