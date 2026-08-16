export type Point = { x: number; y: number };
export type Quad = readonly [Point, Point, Point, Point];
export type PixelBuffer = { width: number; height: number; data: Uint8ClampedArray };
export type PatternKind = "checker" | "stripes" | "dots";

const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));

function parseHex(color: string) {
  const value = /^#([0-9a-f]{6})$/i.exec(color)?.[1] ?? "000000";
  return [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16)) as [number, number, number];
}

export function rgbaToHex(color: ArrayLike<number>) {
  return `#${[color[0], color[1], color[2]].map((value) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0")).join("")}`;
}

function interpolateColor(a: readonly number[], b: readonly number[], amount: number) {
  const t = clamp(amount, 0, 1);
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
    255,
  ];
}

export function createGradientPixels(
  width: number,
  height: number,
  start: Point,
  end: Point,
  from: string,
  to: string,
  type: "linear" | "radial" = "linear",
): PixelBuffer {
  const output = new Uint8ClampedArray(width * height * 4);
  const first = parseHex(from);
  const last = parseHex(to);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const span = Math.max(1e-6, Math.hypot(dx, dy));
  const denominator = Math.max(1e-6, dx * dx + dy * dy);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const amount = type === "radial"
        ? Math.hypot(x + 0.5 - start.x, y + 0.5 - start.y) / span
        : ((x + 0.5 - start.x) * dx + (y + 0.5 - start.y) * dy) / denominator;
      output.set(interpolateColor(first, last, amount), (y * width + x) * 4);
    }
  }
  return { width, height, data: output };
}

export function createPatternPixels(
  width: number,
  height: number,
  kind: PatternKind,
  foreground: string,
  background: string,
  scale = 16,
): PixelBuffer {
  const output = new Uint8ClampedArray(width * height * 4);
  const fg = parseHex(foreground);
  const bg = parseHex(background);
  const size = Math.max(2, Math.round(scale));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const useForeground = kind === "checker"
        ? (Math.floor(x / size) + Math.floor(y / size)) % 2 === 0
        : kind === "stripes"
          ? Math.floor((x + y) / size) % 2 === 0
          : Math.hypot(x % size - size / 2, y % size - size / 2) <= size * 0.24;
      output.set([...(useForeground ? fg : bg), 255], (y * width + x) * 4);
    }
  }
  return { width, height, data: output };
}

function sampleBilinear(source: PixelBuffer, x: number, y: number, output: Uint8ClampedArray, offset: number) {
  const x0 = clamp(Math.floor(x), 0, source.width - 1);
  const y0 = clamp(Math.floor(y), 0, source.height - 1);
  const x1 = Math.min(source.width - 1, x0 + 1);
  const y1 = Math.min(source.height - 1, y0 + 1);
  const tx = clamp(x - x0, 0, 1);
  const ty = clamp(y - y0, 0, 1);
  for (let channel = 0; channel < 4; channel += 1) {
    const a = source.data[(y0 * source.width + x0) * 4 + channel];
    const b = source.data[(y0 * source.width + x1) * 4 + channel];
    const c = source.data[(y1 * source.width + x0) * 4 + channel];
    const d = source.data[(y1 * source.width + x1) * 4 + channel];
    output[offset + channel] = (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
  }
}

function quadPoint(quad: Quad, u: number, v: number) {
  const [topLeft, topRight, bottomRight, bottomLeft] = quad;
  return {
    x: topLeft.x * (1 - u) * (1 - v) + topRight.x * u * (1 - v) + bottomRight.x * u * v + bottomLeft.x * (1 - u) * v,
    y: topLeft.y * (1 - u) * (1 - v) + topRight.y * u * (1 - v) + bottomRight.y * u * v + bottomLeft.y * (1 - u) * v,
  };
}

export function quadrilateralSize(quad: Quad) {
  const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
  return {
    width: Math.max(1, Math.round((distance(quad[0], quad[1]) + distance(quad[3], quad[2])) / 2)),
    height: Math.max(1, Math.round((distance(quad[0], quad[3]) + distance(quad[1], quad[2])) / 2)),
  };
}

/** Rectifies a four-corner region into a rectangular pixel buffer. */
export function rectifyQuadrilateral(source: PixelBuffer, quad: Quad): PixelBuffer {
  const size = quadrilateralSize(quad);
  const output = new Uint8ClampedArray(size.width * size.height * 4);
  for (let y = 0; y < size.height; y += 1) {
    const v = size.height === 1 ? 0 : y / (size.height - 1);
    for (let x = 0; x < size.width; x += 1) {
      const u = size.width === 1 ? 0 : x / (size.width - 1);
      const point = quadPoint(quad, u, v);
      sampleBilinear(source, point.x, point.y, output, (y * size.width + x) * 4);
    }
  }
  return { ...size, data: output };
}

/** Maps a rectangular source into an arbitrary destination quad. */
export function warpToQuadrilateral(source: PixelBuffer, width: number, height: number, quad: Quad): PixelBuffer {
  const output = new Uint8ClampedArray(width * height * 4);
  const xs = quad.map((point) => point.x);
  const ys = quad.map((point) => point.y);
  const left = Math.max(0, Math.floor(Math.min(...xs)));
  const right = Math.min(width - 1, Math.ceil(Math.max(...xs)));
  const top = Math.max(0, Math.floor(Math.min(...ys)));
  const bottom = Math.min(height - 1, Math.ceil(Math.max(...ys)));
  const [a, topRight, , bottomLeft] = quad;
  const b = { x: topRight.x - a.x, y: topRight.y - a.y };
  const c = { x: bottomLeft.x - a.x, y: bottomLeft.y - a.y };
  const d = {
    x: quad[2].x - topRight.x - bottomLeft.x + a.x,
    y: quad[2].y - topRight.y - bottomLeft.y + a.y,
  };
  const boxWidth = Math.max(1, right - left);
  const boxHeight = Math.max(1, bottom - top);
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      // Invert the bilinear quad with a short Newton solve. Reverse mapping
      // samples every destination pixel, avoiding the pinholes of forward splats.
      let u = (x - left) / boxWidth;
      let v = (y - top) / boxHeight;
      for (let iteration = 0; iteration < 8; iteration += 1) {
        const mapped = quadPoint(quad, u, v);
        const errorX = mapped.x - x;
        const errorY = mapped.y - y;
        const duX = b.x + d.x * v;
        const duY = b.y + d.y * v;
        const dvX = c.x + d.x * u;
        const dvY = c.y + d.y * u;
        const determinant = duX * dvY - dvX * duY;
        if (Math.abs(determinant) < 1e-8) break;
        u -= (errorX * dvY - errorY * dvX) / determinant;
        v -= (duX * errorY - duY * errorX) / determinant;
      }
      if (u < -1e-4 || v < -1e-4 || u > 1.0001 || v > 1.0001) continue;
      sampleBilinear(
        source,
        clamp(u, 0, 1) * (source.width - 1),
        clamp(v, 0, 1) * (source.height - 1),
        output,
        (y * width + x) * 4,
      );
    }
  }
  return { width, height, data: output };
}

/** Local radial deformation used by radial-warp and liquify-style gestures. */
export function radialWarp(source: PixelBuffer, from: Point, to: Point, radius: number): PixelBuffer {
  const output = new Uint8ClampedArray(source.data.length);
  const safeRadius = Math.max(1, radius);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const distance = Math.hypot(x - to.x, y - to.y);
      const falloff = distance >= safeRadius ? 0 : (1 - distance / safeRadius) ** 2;
      sampleBilinear(source, x - dx * falloff, y - dy * falloff, output, (y * source.width + x) * 4);
    }
  }
  return { width: source.width, height: source.height, data: output };
}

/** Snap to the strongest local luminance edge for magnetic-lasso placement. */
export function snapPointToEdge(source: PixelBuffer, point: Point, radius = 12): Point {
  const luma = (x: number, y: number) => {
    const px = clamp(Math.round(x), 0, source.width - 1);
    const py = clamp(Math.round(y), 0, source.height - 1);
    const offset = (py * source.width + px) * 4;
    return source.data[offset] * 0.2126 + source.data[offset + 1] * 0.7152 + source.data[offset + 2] * 0.0722;
  };
  let best = { x: point.x, y: point.y };
  let bestStrength = -1;
  const range = Math.max(1, Math.round(radius));
  for (let y = Math.round(point.y) - range; y <= Math.round(point.y) + range; y += 1) {
    for (let x = Math.round(point.x) - range; x <= Math.round(point.x) + range; x += 1) {
      if (x < 1 || y < 1 || x >= source.width - 1 || y >= source.height - 1) continue;
      const gx = luma(x + 1, y) - luma(x - 1, y);
      const gy = luma(x, y + 1) - luma(x, y - 1);
      const distancePenalty = Math.hypot(x - point.x, y - point.y) * 1.5;
      const strength = Math.hypot(gx, gy) - distancePenalty;
      if (strength > bestStrength) {
        bestStrength = strength;
        best = { x, y };
      }
    }
  }
  return best;
}
