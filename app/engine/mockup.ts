/**
 * Mockup compositor (alpha).
 *
 * Places artwork onto a procedurally generated product scene. The art is
 * mapped through a projective transform (homography) onto the scene's print
 * quad, then bent by the scene's displacement field so it follows folds, then
 * lit by the scene's shading map so folds, weave and light read through the
 * ink. Objects that sit in front of the print (drawstrings, glass glare) live
 * in a separate overlay that is composited last.
 *
 * DOM-free: scenes, art and output are plain RGBA arrays.
 */
import type { Point } from "./mockup-raster";

export type MockupSceneId = "tshirt" | "hoodie" | "tote" | "poster" | "vinyl" | "phone";
export type MockupSurface = "fabric" | "paper" | "glossy";
export type Quad = readonly [Point, Point, Point, Point];

export type MockupScene = {
  id: MockupSceneId;
  name: string;
  width: number;
  height: number;
  /** Scene without art, straight RGBA. */
  base: Uint8ClampedArray;
  /** Light multiplier for printed ink (folds, weave, falloff). 1 = neutral. */
  shading: Float32Array;
  /** Where the print may appear, 0..1 (garment silhouette × print area, screen shape, …). */
  printMask: Float32Array;
  /** Scene-space pixel offsets applied before the projective lookup. */
  displaceX: Float32Array;
  displaceY: Float32Array;
  /** Premultiplied RGBA drawn over the art (drawstrings, glare). Null when nothing sits in front. */
  overlay: Float32Array | null;
  /** Print area corners in scene pixels: top-left, top-right, bottom-right, bottom-left. */
  quad: Quad;
  /** Physical width / height of the print area (independent of perspective). */
  printAspect: number;
  surface: MockupSurface;
  /** Pixel bounds of the non-zero print mask, for fast iteration. */
  bounds: { x0: number; y0: number; x1: number; y1: number };
};

export type RasterImage = { width: number; height: number; data: Uint8ClampedArray };

export type MockupPlacement = {
  /** contain: the whole artwork fits in the print area at scale 1. cover: it fills the area. */
  fit: "contain" | "cover";
  /** Multiplier on the fitted size. */
  scale: number;
  /** Offset of the art centre, as a fraction of print-area width / height. */
  offsetX: number;
  offsetY: number;
  /** Degrees, clockwise. */
  rotation: number;
};

export const PLACEMENT_LIMITS = { scale: [0.1, 3], offset: [-1, 1], rotation: [-180, 180] } as const;

export function normalizePlacement(value: Partial<MockupPlacement>, fallback: MockupPlacement): MockupPlacement {
  const num = (v: unknown, d: number, [lo, hi]: readonly [number, number]) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  return {
    fit: value.fit === "cover" || value.fit === "contain" ? value.fit : fallback.fit,
    scale: num(value.scale, fallback.scale, PLACEMENT_LIMITS.scale),
    offsetX: num(value.offsetX, fallback.offsetX, PLACEMENT_LIMITS.offset),
    offsetY: num(value.offsetY, fallback.offsetY, PLACEMENT_LIMITS.offset),
    rotation: num(value.rotation, fallback.rotation, PLACEMENT_LIMITS.rotation),
  };
}

// ---------------------------------------------------------------------------
// Projective geometry
// ---------------------------------------------------------------------------

/** Row-major 3×3 matrix. */
export type Homography = readonly [number, number, number, number, number, number, number, number, number];

/**
 * Homography taking the unit square (0,0) (1,0) (1,1) (0,1) to the quad's
 * corners in order. Heckbert's closed form; the affine case falls out with
 * g = h = 0.
 */
export function squareToQuad(quad: Quad): Homography {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = quad;
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  const det = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(det) < 1e-12) throw new Error("Degenerate print area");
  const g = (dx3 * dy2 - dx2 * dy3) / det;
  const h = (dx1 * dy3 - dx3 * dy1) / det;
  return [x1 - x0 + g * x1, x3 - x0 + h * x3, x0, y1 - y0 + g * y1, y3 - y0 + h * y3, y0, g, h, 1];
}

export function invertHomography(m: Homography): Homography {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) throw new Error("Homography is not invertible");
  const k = 1 / det;
  return [A * k, -(b * i - c * h) * k, (b * f - c * e) * k, B * k, (a * i - c * g) * k, -(a * f - c * d) * k, C * k, -(a * h - b * g) * k, (a * e - b * d) * k];
}

export function applyHomography(m: Homography, x: number, y: number): [number, number] {
  const w = m[6] * x + m[7] * y + m[8];
  return [(m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w];
}

// ---------------------------------------------------------------------------
// Placement: print-area (u, v) → artwork pixel
// ---------------------------------------------------------------------------

export type PlacementMap = { toArt: (u: number, v: number) => [number, number]; artWidth: number; artHeight: number };

/** Size of the fitted artwork in print units, where the print area is printAspect × 1. */
export function fittedArtSize(artWidth: number, artHeight: number, printAspect: number, placement: MockupPlacement) {
  const r = artWidth / artHeight;
  const widthLimited = placement.fit === "contain" ? r > printAspect : r < printAspect;
  const w = widthLimited ? printAspect : r, h = widthLimited ? printAspect / r : 1;
  return { width: w * placement.scale, height: h * placement.scale };
}

export function placementMap(artWidth: number, artHeight: number, printAspect: number, placement: MockupPlacement): PlacementMap {
  const { width, height } = fittedArtSize(artWidth, artHeight, printAspect, placement);
  const cx = printAspect * (0.5 + placement.offsetX), cy = 0.5 + placement.offsetY;
  const t = -placement.rotation * Math.PI / 180, cos = Math.cos(t), sin = Math.sin(t);
  return {
    artWidth, artHeight,
    toArt(u, v) {
      const px = u * printAspect - cx, py = v - cy;
      const lx = px * cos - py * sin, ly = px * sin + py * cos;
      return [(lx / width + 0.5) * artWidth, (ly / height + 0.5) * artHeight];
    },
  };
}

/** Bilinear, premultiplied lookup; outside the image is transparent so edges anti-alias. */
function samplePremultiplied(art: RasterImage, x: number, y: number, out: Float32Array) {
  const fx = x - 0.5, fy = y - 0.5;
  const ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
  out[0] = out[1] = out[2] = out[3] = 0;
  const { width, height, data } = art;
  for (let j = 0; j < 2; j++) {
    const sy = iy + j; if (sy < 0 || sy >= height) continue;
    const wy = j ? ty : 1 - ty;
    for (let k = 0; k < 2; k++) {
      const sx = ix + k; if (sx < 0 || sx >= width) continue;
      const w = wy * (k ? tx : 1 - tx); if (!w) continue;
      const p = (sy * width + sx) * 4, a = data[p + 3] / 255 * w;
      out[0] += data[p] / 255 * a; out[1] += data[p + 1] / 255 * a; out[2] += data[p + 2] / 255 * a; out[3] += a;
    }
  }
}

export type RenderOptions = {
  /** Ink density, 0..1. Below 1 the substrate shows through slightly, like a real print. */
  inkOpacity?: number;
};

/**
 * Composite artwork into a scene. Returns a new straight-alpha RGBA buffer the
 * size of the scene. `art` may be null to render the empty product.
 */
export function renderMockup(scene: MockupScene, art: RasterImage | null, placement: MockupPlacement, options: RenderOptions = {}): Uint8ClampedArray {
  const { width, height, base, shading, printMask, displaceX, displaceY, overlay, surface } = scene;
  const out = new Uint8ClampedArray(base);
  const inkOpacity = Math.min(1, Math.max(0, options.inkOpacity ?? (surface === "fabric" ? 0.94 : 1)));
  if (art && art.width > 0 && art.height > 0 && inkOpacity > 0) {
    const inverse = invertHomography(squareToQuad(scene.quad));
    const map = placementMap(art.width, art.height, scene.printAspect, placement);
    const sample = new Float32Array(4);
    // Ink sits *on* the substrate: it takes the substrate's light but not its
    // colour. The small additive term keeps folds legible on dark ink, the
    // same trick the garment base uses so black shirts still show creases.
    const lift = surface === "glossy" ? 0 : 0.12;
    const { x0, y0, x1, y1 } = scene.bounds;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * width + x, m = printMask[i];
        if (m <= 0) continue;
        let [u, v] = applyHomography(inverse, x + 0.5 + displaceX[i], y + 0.5 + displaceY[i]);
        // The mask, not the quad test, shapes the print edge so it stays
        // anti-aliased; clamping only stops a fold from sampling past it.
        u = u < 0 ? 0 : u > 1 ? 1 : u; v = v < 0 ? 0 : v > 1 ? 1 : v;
        const [ax, ay] = map.toArt(u, v);
        samplePremultiplied(art, ax, ay, sample);
        const alpha = sample[3] * m * inkOpacity;
        if (alpha <= 0) continue;
        const s = shading[i], add = (s - 1) * lift;
        const p = i * 4, k = 255 * m * inkOpacity;
        for (let c = 0; c < 3; c++) {
          const ink = sample[c] * s + add * sample[3]; // premultiplied ink colour
          out[p + c] = out[p + c] * (1 - alpha) + ink * k;
        }
      }
    }
  }
  if (overlay) {
    for (let i = 0, n = width * height; i < n; i++) {
      const a = overlay[i * 4 + 3];
      if (a <= 0) continue;
      const p = i * 4;
      for (let c = 0; c < 3; c++) out[p + c] = overlay[p + c] * 255 + out[p + c] * (1 - a);
    }
  }
  return out;
}

/** Scene pixel delta → print-area offset delta, used by drag-to-place. */
export function sceneDeltaToOffset(scene: Pick<MockupScene, "quad">, from: Point, to: Point): [number, number] {
  const inverse = invertHomography(squareToQuad(scene.quad));
  const [u0, v0] = applyHomography(inverse, from[0], from[1]);
  const [u1, v1] = applyHomography(inverse, to[0], to[1]);
  return [u1 - u0, v1 - v0];
}

export function mockupFileName(projectName: string, scene: MockupSceneId, type: "image/png" | "image/jpeg") {
  const stem = projectName.trim().replace(/\.[a-z0-9]{1,5}$/i, "").replace(/[^a-z0-9-_ ]+/gi, "").trim().replace(/\s+/g, "-").slice(0, 60) || "artwork";
  return `${stem}-mockup-${scene}.${type === "image/png" ? "png" : "jpg"}`;
}
