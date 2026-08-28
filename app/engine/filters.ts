import {
  Document,
  Layer,
  SmartFilter,
  SmartFilterKind,
  affineForLayerTransform,
  inverseAffineForLayerTransform,
  newCanvas,
  transformPoint,
} from "./document";
import { selectionRegionCanvas } from "./selection";

export type FilterRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type SmartFilterSpec = {
  label: string;
  category: "Blur" | "Sharpen" | "Noise" | "Other";
  defaults: Record<string, number>;
};

/**
 * One catalogue drives the UI, actions, overscan planner and renderer. Keeping
 * defaults here prevents a filter from looking different depending on which
 * surface created it.
 */
export const SMART_FILTER_SPECS: Record<SmartFilterKind, SmartFilterSpec> = {
  blur: { label: "Gaussian Blur", category: "Blur", defaults: { radius: 8 } },
  "motion-blur": { label: "Motion Blur", category: "Blur", defaults: { radius: 16, angle: 0 } },
  "surface-blur": { label: "Surface Blur", category: "Blur", defaults: { radius: 5, threshold: 24 } },
  sharpen: { label: "Unsharp Mask", category: "Sharpen", defaults: { radius: 2, amount: 0.6 } },
  "high-pass": { label: "High Pass", category: "Sharpen", defaults: { radius: 4 } },
  median: { label: "Median", category: "Noise", defaults: { radius: 2 } },
  "dust-scratches": { label: "Dust & Scratches", category: "Noise", defaults: { radius: 2, threshold: 18 } },
  "reduce-noise": { label: "Reduce Noise", category: "Noise", defaults: { radius: 2, strength: 0.65, preserveDetail: 0.55, reduceColor: 0.7 } },
  "lens-blur": { label: "Lens Blur", category: "Blur", defaults: { radius: 8, blades: 6, rotation: 0, highlights: 0.15 } },
  displace: { label: "Displace", category: "Other", defaults: { amount: 12, scale: 48, angle: 0 } },
  maximum: { label: "Maximum", category: "Other", defaults: { radius: 2 } },
  minimum: { label: "Minimum", category: "Other", defaults: { radius: 2 } },
  invert: { label: "Invert", category: "Other", defaults: {} },
  desaturate: { label: "Desaturate", category: "Other", defaults: { amount: 1 } },
  hue: { label: "Hue Rotate", category: "Other", defaults: { degrees: 45 } },
};

export const SMART_FILTER_KINDS = Object.keys(SMART_FILTER_SPECS) as SmartFilterKind[];

export function smartFilterInfluenceRadius(filter: Pick<SmartFilter, "kind" | "params">, displayScale = 1) {
  const defaults = SMART_FILTER_SPECS[filter.kind].defaults;
  const radius = Math.max(0, (filter.params.radius ?? defaults.radius ?? 0) * displayScale);
  if (filter.kind === "blur" || filter.kind === "sharpen" || filter.kind === "high-pass") {
    return gaussianInfluenceRadius(radius);
  }
  if (["motion-blur", "surface-blur", "median", "dust-scratches", "maximum", "minimum", "lens-blur", "reduce-noise"].includes(filter.kind)) {
    return Math.ceil(radius);
  }
  // Scaled to match the amplitude applySmartFilters actually uses.
  if (filter.kind === "displace") return Math.ceil(Math.abs(filter.params.amount ?? defaults.amount ?? 0) * displayScale) + 2;
  return 0;
}

function snapNearInteger(value: number) {
  const integer = Math.round(value);
  return Math.abs(value - integer) < 1e-9 ? integer : value;
}

/**
 * Return the smallest layer-pixel rectangle needed to filter the current
 * document selection. `padding` is the filter's influence radius (for
 * example, the combined box radii used to approximate a Gaussian).
 *
 * Selection bounds live in document space, while bitmap pixels live in layer
 * space. Mapping all four corners through the inverse affine transform keeps
 * rotated, translated, and non-uniformly scaled layers correct. The result is
 * clipped before any canvas or ImageData allocation is made.
 */
export function filterRegionForSelection(
  doc: Document,
  layer: Layer,
  padding = 0,
): FilterRegion | null {
  if (!layer.bitmap) return null;
  const width = layer.bitmap.width;
  const height = layer.bitmap.height;
  if (!doc.selection) return { x: 0, y: 0, width, height };
  const bounds = doc.selection.bounds;
  if (bounds.w <= 0 || bounds.h <= 0) return null;
  const inverse = inverseAffineForLayerTransform(layer.transform);
  if (!inverse) return null;
  const corners = [
    transformPoint(inverse, bounds.x, bounds.y),
    transformPoint(inverse, bounds.x + bounds.w, bounds.y),
    transformPoint(inverse, bounds.x, bounds.y + bounds.h),
    transformPoint(inverse, bounds.x + bounds.w, bounds.y + bounds.h),
  ];
  const influence = Math.max(0, Math.ceil(padding));
  // Trigonometric transforms such as an exact quarter-turn commonly land at
  // 20.000000000000004. Snap only floating-point noise before rounding so it
  // does not create an unnecessary extra row or column.
  const minX = Math.max(0, Math.floor(snapNearInteger(Math.min(...corners.map((point) => point.x))) - influence));
  const minY = Math.max(0, Math.floor(snapNearInteger(Math.min(...corners.map((point) => point.y))) - influence));
  const maxX = Math.min(width, Math.ceil(snapNearInteger(Math.max(...corners.map((point) => point.x))) + influence));
  const maxY = Math.min(height, Math.ceil(snapNearInteger(Math.max(...corners.map((point) => point.y))) + influence));
  if (maxX <= minX || maxY <= minY) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// Apply an ImageData transform to `layer.bitmap`, constrained to `doc.selection`
// (if present). Returns nothing; mutates the layer's bitmap.
function applyPixelFilter(
  doc: Document,
  layer: Layer,
  transform: (src: ImageData) => ImageData,
  influenceRadius = 0,
) {
  if (!layer.bitmap) return;
  const src = layer.bitmap.getContext("2d")!;
  const region = filterRegionForSelection(doc, layer, influenceRadius);
  if (!region) return;
  const input = src.getImageData(region.x, region.y, region.width, region.height);
  const output = transform(input);

  if (doc.selection) {
    // Blend the filtered pixels into the source by selection alpha. This
    // temporary canvas is selection-bounded rather than layer-sized: on a
    // 50K document a 256px selection no longer creates another 10GB bitmap.
    const localSelection = newCanvas(region.width, region.height);
    const localSelectionContext = localSelection.getContext("2d")!;
    const inverse = inverseAffineForLayerTransform(layer.transform);
    if (!inverse) return;
    const forward = affineForLayerTransform(layer.transform);
    const corners = [
      transformPoint(forward, region.x, region.y),
      transformPoint(forward, region.x + region.width, region.y),
      transformPoint(forward, region.x, region.y + region.height),
      transformPoint(forward, region.x + region.width, region.y + region.height),
    ];
    const minX = Math.floor(Math.min(...corners.map((point) => point.x))) - 1;
    const minY = Math.floor(Math.min(...corners.map((point) => point.y))) - 1;
    const maxX = Math.ceil(Math.max(...corners.map((point) => point.x))) + 1;
    const maxY = Math.ceil(Math.max(...corners.map((point) => point.y))) + 1;
    const selectionRect = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    const selection = selectionRegionCanvas(doc, selectionRect);
    if (!selection) return;
    localSelectionContext.setTransform(
      inverse.a,
      inverse.b,
      inverse.c,
      inverse.d,
      inverse.e - region.x,
      inverse.f - region.y,
    );
    localSelectionContext.drawImage(selection, selectionRect.x, selectionRect.y);
    const selData = localSelectionContext.getImageData(0, 0, region.width, region.height).data;
    const outData = output.data;
    const srcData = input.data;
    for (let i = 0; i < srcData.length; i += 4) {
      const a = selData[i + 3] / 255;
      const inv = 1 - a;
      srcData[i] = srcData[i] * inv + outData[i] * a;
      srcData[i + 1] = srcData[i + 1] * inv + outData[i + 1] * a;
      srcData[i + 2] = srcData[i + 2] * inv + outData[i + 2] * a;
      srcData[i + 3] = Math.max(srcData[i + 3], outData[i + 3] * a);
    }
    src.putImageData(input, region.x, region.y);
  } else {
    src.putImageData(output, region.x, region.y);
  }
}

// Separable Gaussian via three iterations of a box blur (van Vliet / Wells
// approximation) — cheap and visually indistinguishable at typical radii.
export function gaussianBlur(doc: Document, layer: Layer, radius: number) {
  if (radius <= 0) return;
  applyPixelFilter(doc, layer, (src) => boxBlur3(src, radius), gaussianInfluenceRadius(radius));
}

function gaussianInfluenceRadius(radius: number) {
  return boxRadiiForGaussian(radius, 3).reduce((sum, value) => sum + value, 0);
}

function boxBlur3(src: ImageData, r: number): ImageData {
  const w = src.width;
  const h = src.height;
  const buf1 = new Uint8ClampedArray(src.data);
  const buf2 = new Uint8ClampedArray(src.data.length);
  const rounds = boxRadiiForGaussian(r, 3);
  const a = buf1;
  const b = buf2;
  for (const rr of rounds) {
    boxBlurH(a, b, w, h, rr);
    boxBlurV(b, a, w, h, rr);
  }
  return new ImageData(a, w, h);
}

function boxRadiiForGaussian(sigma: number, n: number): number[] {
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4);
  const m = Math.round(mIdeal);
  const sizes: number[] = [];
  for (let i = 0; i < n; i++) sizes.push(((i < m ? wl : wu) - 1) / 2);
  return sizes.map((s) => Math.max(1, s));
}

function boxBlurH(src: Uint8ClampedArray, dst: Uint8ClampedArray, w: number, h: number, r: number) {
  const radius = Math.max(0, Math.floor(r));
  const iarr = 1 / (radius + radius + 1);
  const prefix = new Float64Array((w + 1) * 4);
  for (let y = 0; y < h; y++) {
    const rowStart = y * w;
    prefix.fill(0);
    for (let x = 0; x < w; x += 1) {
      const source = (rowStart + x) * 4;
      const previous = x * 4;
      const next = (x + 1) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        prefix[next + channel] = prefix[previous + channel] + src[source + channel];
      }
    }
    const first = rowStart * 4;
    const last = (rowStart + w - 1) * 4;
    for (let x = 0; x < w; x += 1) {
      const left = Math.max(0, x - radius);
      const right = Math.min(w - 1, x + radius);
      const repeatedLeft = Math.max(0, radius - x);
      const repeatedRight = Math.max(0, x + radius - (w - 1));
      const to = (rowStart + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        const range = prefix[(right + 1) * 4 + channel] - prefix[left * 4 + channel];
        dst[to + channel] = (
          range + repeatedLeft * src[first + channel] + repeatedRight * src[last + channel]
        ) * iarr;
      }
    }
  }
}

function boxBlurV(src: Uint8ClampedArray, dst: Uint8ClampedArray, w: number, h: number, r: number) {
  const radius = Math.max(0, Math.floor(r));
  const iarr = 1 / (radius + radius + 1);
  const prefix = new Float64Array((h + 1) * 4);
  for (let x = 0; x < w; x++) {
    prefix.fill(0);
    for (let y = 0; y < h; y += 1) {
      const source = (y * w + x) * 4;
      const previous = y * 4;
      const next = (y + 1) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        prefix[next + channel] = prefix[previous + channel] + src[source + channel];
      }
    }
    const firstIdx = x * 4;
    const lastIdx = ((h - 1) * w + x) * 4;
    for (let y = 0; y < h; y += 1) {
      const top = Math.max(0, y - radius);
      const bottom = Math.min(h - 1, y + radius);
      const repeatedTop = Math.max(0, radius - y);
      const repeatedBottom = Math.max(0, y + radius - (h - 1));
      const to = (y * w + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        const range = prefix[(bottom + 1) * 4 + channel] - prefix[top * 4 + channel];
        dst[to + channel] = (
          range + repeatedTop * src[firstIdx + channel] + repeatedBottom * src[lastIdx + channel]
        ) * iarr;
      }
    }
  }
}

// Unsharp mask: sharpened = src + amount * (src - blur(src))
export function unsharpMask(
  doc: Document,
  layer: Layer,
  radius: number,
  amount: number,
) {
  if (!layer.bitmap) return;
  applyPixelFilter(doc, layer, (src) => {
    const blur = boxBlur3(new ImageData(new Uint8ClampedArray(src.data), src.width, src.height), radius);
    const out = new ImageData(new Uint8ClampedArray(src.data.length), src.width, src.height);
    const sd = src.data;
    const bd = blur.data;
    const od = out.data;
    for (let i = 0; i < sd.length; i += 4) {
      od[i] = clamp(sd[i] + amount * (sd[i] - bd[i]));
      od[i + 1] = clamp(sd[i + 1] + amount * (sd[i + 1] - bd[i + 1]));
      od[i + 2] = clamp(sd[i + 2] + amount * (sd[i + 2] - bd[i + 2]));
      od[i + 3] = sd[i + 3];
    }
    return out;
  }, gaussianInfluenceRadius(radius));
}

/** Edge detail isolated around middle gray, suitable for Overlay/Soft Light. */
export function highPass(doc: Document, layer: Layer, radius: number) {
  if (radius <= 0) return;
  applyPixelFilter(doc, layer, (src) => {
    const blur = boxBlur3(new ImageData(new Uint8ClampedArray(src.data), src.width, src.height), radius);
    const out = new ImageData(new Uint8ClampedArray(src.data.length), src.width, src.height);
    for (let i = 0; i < src.data.length; i += 4) {
      out.data[i] = clamp(128 + src.data[i] - blur.data[i]);
      out.data[i + 1] = clamp(128 + src.data[i + 1] - blur.data[i + 1]);
      out.data[i + 2] = clamp(128 + src.data[i + 2] - blur.data[i + 2]);
      out.data[i + 3] = src.data[i + 3];
    }
    return out;
  }, gaussianInfluenceRadius(radius));
}

function pixelIndex(width: number, height: number, x: number, y: number) {
  return (Math.max(0, Math.min(height - 1, y)) * width + Math.max(0, Math.min(width - 1, x))) * 4;
}

export function motionBlur(doc: Document, layer: Layer, radius: number, angleDegrees: number) {
  const r = Math.max(1, Math.min(96, Math.round(radius)));
  const radians = angleDegrees * Math.PI / 180;
  const dx = Math.cos(radians);
  const dy = Math.sin(radians);
  applyPixelFilter(doc, layer, (src) => {
    const out = new ImageData(new Uint8ClampedArray(src.data.length), src.width, src.height);
    const samples = Math.min(65, r * 2 + 1);
    for (let y = 0; y < src.height; y += 1) {
      for (let x = 0; x < src.width; x += 1) {
        const target = (y * src.width + x) * 4;
        const sums = [0, 0, 0, 0];
        for (let sample = 0; sample < samples; sample += 1) {
          const distance = samples === 1 ? 0 : -r + sample * (r * 2 / (samples - 1));
          const source = pixelIndex(src.width, src.height, Math.round(x + dx * distance), Math.round(y + dy * distance));
          for (let channel = 0; channel < 4; channel += 1) sums[channel] += src.data[source + channel];
        }
        for (let channel = 0; channel < 4; channel += 1) out.data[target + channel] = sums[channel] / samples;
      }
    }
    return out;
  }, r);
}

type NeighborhoodMode = "median" | "maximum" | "minimum";

function neighborhoodFilter(src: ImageData, radius: number, mode: NeighborhoodMode) {
  const r = Math.max(1, Math.min(12, Math.round(radius)));
  const out = new ImageData(new Uint8ClampedArray(src.data.length), src.width, src.height);
  const values: number[][] = [[], [], [], []];
  for (let y = 0; y < src.height; y += 1) {
    for (let x = 0; x < src.width; x += 1) {
      for (const channel of values) channel.length = 0;
      for (let yy = y - r; yy <= y + r; yy += 1) {
        for (let xx = x - r; xx <= x + r; xx += 1) {
          const source = pixelIndex(src.width, src.height, xx, yy);
          for (let channel = 0; channel < 4; channel += 1) values[channel].push(src.data[source + channel]);
        }
      }
      const target = (y * src.width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        if (mode === "maximum") out.data[target + channel] = Math.max(...values[channel]);
        else if (mode === "minimum") out.data[target + channel] = Math.min(...values[channel]);
        else {
          values[channel].sort((a, b) => a - b);
          out.data[target + channel] = values[channel][Math.floor(values[channel].length / 2)];
        }
      }
      out.data[target + 3] = src.data[target + 3];
    }
  }
  return out;
}

export function medianFilter(doc: Document, layer: Layer, radius: number) {
  applyPixelFilter(doc, layer, (src) => neighborhoodFilter(src, radius, "median"), Math.ceil(radius));
}

export function maximumFilter(doc: Document, layer: Layer, radius: number) {
  applyPixelFilter(doc, layer, (src) => neighborhoodFilter(src, radius, "maximum"), Math.ceil(radius));
}

export function minimumFilter(doc: Document, layer: Layer, radius: number) {
  applyPixelFilter(doc, layer, (src) => neighborhoodFilter(src, radius, "minimum"), Math.ceil(radius));
}

export function dustAndScratches(doc: Document, layer: Layer, radius: number, threshold: number) {
  applyPixelFilter(doc, layer, (src) => {
    const median = neighborhoodFilter(src, radius, "median");
    const out = new ImageData(new Uint8ClampedArray(src.data), src.width, src.height);
    const limit = Math.max(0, Math.min(255, threshold));
    for (let i = 0; i < src.data.length; i += 4) {
      const difference = Math.max(
        Math.abs(src.data[i] - median.data[i]),
        Math.abs(src.data[i + 1] - median.data[i + 1]),
        Math.abs(src.data[i + 2] - median.data[i + 2]),
      );
      if (difference <= limit) continue;
      out.data[i] = median.data[i];
      out.data[i + 1] = median.data[i + 1];
      out.data[i + 2] = median.data[i + 2];
    }
    return out;
  }, Math.ceil(radius));
}

/** Edge-aware blur: only neighbours within the RGB distance threshold mix. */
export function surfaceBlur(doc: Document, layer: Layer, radius: number, threshold: number) {
  const r = Math.max(1, Math.min(12, Math.round(radius)));
  const limit = Math.max(0, Math.min(255, threshold));
  applyPixelFilter(doc, layer, (src) => {
    const out = new ImageData(new Uint8ClampedArray(src.data.length), src.width, src.height);
    for (let y = 0; y < src.height; y += 1) {
      for (let x = 0; x < src.width; x += 1) {
        const target = (y * src.width + x) * 4;
        const sums = [0, 0, 0];
        let weight = 0;
        for (let yy = y - r; yy <= y + r; yy += 1) {
          for (let xx = x - r; xx <= x + r; xx += 1) {
            const source = pixelIndex(src.width, src.height, xx, yy);
            const difference = Math.max(
              Math.abs(src.data[target] - src.data[source]),
              Math.abs(src.data[target + 1] - src.data[source + 1]),
              Math.abs(src.data[target + 2] - src.data[source + 2]),
            );
            if (difference > limit) continue;
            const sampleWeight = 1 - difference / Math.max(1, limit + 1);
            sums[0] += src.data[source] * sampleWeight;
            sums[1] += src.data[source + 1] * sampleWeight;
            sums[2] += src.data[source + 2] * sampleWeight;
            weight += sampleWeight;
          }
        }
        out.data[target] = sums[0] / Math.max(1, weight);
        out.data[target + 1] = sums[1] / Math.max(1, weight);
        out.data[target + 2] = sums[2] / Math.max(1, weight);
        out.data[target + 3] = src.data[target + 3];
      }
    }
    return out;
  }, r);
}

/**
 * Aperture-shaped blur with optional highlight bloom. The sample budget is
 * capped so a large radius cannot turn one viewport tile into an unbounded
 * quadratic operation; the influence radius remains exact for tile overscan.
 */
export function lensBlur(
  doc: Document,
  layer: Layer,
  radius: number,
  blades = 6,
  rotationDegrees = 0,
  highlights = 0.15,
) {
  const r = Math.max(1, Math.min(64, Math.round(radius)));
  const sides = Math.max(3, Math.min(12, Math.round(blades)));
  const rotation = rotationDegrees * Math.PI / 180;
  const bloom = Math.max(0, Math.min(1, highlights));
  const step = Math.max(1, Math.ceil(r / 12));
  const offsets: Array<[number, number]> = [];
  for (let y = -r; y <= r; y += step) for (let x = -r; x <= r; x += step) {
    const distance = Math.hypot(x, y);
    if (distance > r) continue;
    // Radius of a regular polygon at this angle. This produces a visibly
    // photographic aperture instead of another Gaussian under a new name.
    const angle = Math.atan2(y, x) - rotation;
    const sector = (angle + Math.PI * 4) % (Math.PI * 2 / sides) - Math.PI / sides;
    const boundary = r * Math.cos(Math.PI / sides) / Math.max(1e-6, Math.cos(sector));
    if (distance <= boundary) offsets.push([x, y]);
  }
  applyPixelFilter(doc, layer, (src) => {
    const out = new ImageData(new Uint8ClampedArray(src.data.length), src.width, src.height);
    for (let y = 0; y < src.height; y += 1) for (let x = 0; x < src.width; x += 1) {
      const target = (y * src.width + x) * 4;
      const sums = [0, 0, 0, 0];
      let weight = 0;
      for (const [ox, oy] of offsets) {
        const source = pixelIndex(src.width, src.height, x + ox, y + oy);
        const luma = (src.data[source] + src.data[source + 1] + src.data[source + 2]) / (255 * 3);
        const sampleWeight = 1 + bloom * Math.max(0, luma - 0.65) * 4;
        for (let channel = 0; channel < 4; channel += 1) sums[channel] += src.data[source + channel] * sampleWeight;
        weight += sampleWeight;
      }
      for (let channel = 0; channel < 4; channel += 1) out.data[target + channel] = sums[channel] / Math.max(1, weight);
    }
    return out;
  }, r);
}

/** Edge-aware luma/chroma denoise. Detail preservation controls the bilateral
 * range threshold; color noise can be reduced more strongly than luminance. */
export function reduceNoise(
  doc: Document,
  layer: Layer,
  radius: number,
  strength = 0.65,
  preserveDetail = 0.55,
  reduceColor = 0.7,
) {
  const r = Math.max(1, Math.min(6, Math.round(radius)));
  const mix = Math.max(0, Math.min(1, strength));
  const detail = Math.max(0, Math.min(1, preserveDetail));
  const chromaMix = Math.max(0, Math.min(1, reduceColor));
  const range = 8 + (1 - detail) * 96;
  applyPixelFilter(doc, layer, (src) => {
    const out = new ImageData(new Uint8ClampedArray(src.data), src.width, src.height);
    for (let y = 0; y < src.height; y += 1) for (let x = 0; x < src.width; x += 1) {
      const target = (y * src.width + x) * 4;
      const centerY = 0.2126 * src.data[target] + 0.7152 * src.data[target + 1] + 0.0722 * src.data[target + 2];
      let sumY = 0;
      let sumCb = 0;
      let sumCr = 0;
      let weight = 0;
      for (let oy = -r; oy <= r; oy += 1) for (let ox = -r; ox <= r; ox += 1) {
        const source = pixelIndex(src.width, src.height, x + ox, y + oy);
        const red = src.data[source];
        const green = src.data[source + 1];
        const blue = src.data[source + 2];
        const sampleY = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
        const spatial = Math.exp(-(ox * ox + oy * oy) / Math.max(1, r * r));
        const rangeWeight = Math.exp(-Math.abs(sampleY - centerY) / range);
        const sampleWeight = spatial * rangeWeight;
        sumY += sampleY * sampleWeight;
        sumCb += (blue - sampleY) * sampleWeight;
        sumCr += (red - sampleY) * sampleWeight;
        weight += sampleWeight;
      }
      const smoothY = sumY / Math.max(1e-6, weight);
      const smoothCb = sumCb / Math.max(1e-6, weight);
      const smoothCr = sumCr / Math.max(1e-6, weight);
      const sourceCb = src.data[target + 2] - centerY;
      const sourceCr = src.data[target] - centerY;
      const finalY = centerY * (1 - mix) + smoothY * mix;
      const finalCb = sourceCb * (1 - chromaMix) + smoothCb * chromaMix;
      const finalCr = sourceCr * (1 - chromaMix) + smoothCr * chromaMix;
      out.data[target] = clamp(finalY + finalCr);
      out.data[target + 2] = clamp(finalY + finalCb);
      out.data[target + 1] = clamp((finalY - 0.2126 * out.data[target] - 0.0722 * out.data[target + 2]) / 0.7152);
    }
    return out;
  }, r);
}

/** Procedural displacement map. Because the wave is analytic, it is fully
 * serializable and deterministic in Actions and project files. */
export function displace(
  doc: Document,
  layer: Layer,
  amount: number,
  scale = 48,
  angleDegrees = 0,
) {
  const amplitude = Math.max(-128, Math.min(128, amount));
  if (Math.abs(amplitude) < 0.01) return;
  const wavelength = Math.max(4, Math.min(2048, scale));
  const angle = angleDegrees * Math.PI / 180;
  const directionX = Math.cos(angle);
  const directionY = Math.sin(angle);
  applyPixelFilter(doc, layer, (src) => {
    const out = new ImageData(new Uint8ClampedArray(src.data.length), src.width, src.height);
    for (let y = 0; y < src.height; y += 1) for (let x = 0; x < src.width; x += 1) {
      const phase = (x * -directionY + y * directionX) * Math.PI * 2 / wavelength;
      const offset = Math.sin(phase) * amplitude;
      const source = pixelIndex(src.width, src.height, Math.round(x + directionX * offset), Math.round(y + directionY * offset));
      const target = (y * src.width + x) * 4;
      out.data[target] = src.data[source];
      out.data[target + 1] = src.data[source + 1];
      out.data[target + 2] = src.data[source + 2];
      out.data[target + 3] = src.data[source + 3];
    }
    return out;
  }, Math.ceil(Math.abs(amplitude)) + 2);
}

export function invertColors(doc: Document, layer: Layer) {
  applyPixelFilter(doc, layer, (src) => {
    const out = new ImageData(new Uint8ClampedArray(src.data), src.width, src.height);
    const d = out.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = 255 - d[i];
      d[i + 1] = 255 - d[i + 1];
      d[i + 2] = 255 - d[i + 2];
    }
    return out;
  });
}

export function hueRotate(doc: Document, layer: Layer, degrees: number) {
  if (!layer.bitmap) return;
  applyPixelFilter(doc, layer, (src) => {
    // Use the canvas implementation for color conversion, but only allocate
    // the bounded source region selected by applyPixelFilter.
    const input = newCanvas(src.width, src.height);
    input.getContext("2d")!.putImageData(src, 0, 0);
    const shifted = newCanvas(src.width, src.height);
    const context = shifted.getContext("2d")!;
    context.filter = `hue-rotate(${degrees}deg)`;
    context.drawImage(input, 0, 0);
    return context.getImageData(0, 0, src.width, src.height);
  });
}

export function desaturate(doc: Document, layer: Layer, amount = 1) {
  applyPixelFilter(doc, layer, (src) => {
    const out = new ImageData(new Uint8ClampedArray(src.data), src.width, src.height);
    const d = out.data;
    for (let i = 0; i < d.length; i += 4) {
      const luma = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      d[i] = d[i] * (1 - amount) + luma * amount;
      d[i + 1] = d[i + 1] * (1 - amount) + luma * amount;
      d[i + 2] = d[i + 2] * (1 - amount) + luma * amount;
    }
    return out;
  });
}

export function applySmartFilters(
  source: HTMLCanvasElement,
  filters: SmartFilter[] | undefined,
  displayScale = 1,
) {
  if (!filters?.length) return;
  const layer: Layer = {
    id: "smart-filter-target",
    name: "Smart filter target",
    kind: "raster",
    visible: true,
    opacity: 1,
    blend: "source-over",
    transform: { tx: 0, ty: 0, sx: 1, sy: 1, rotation: 0 },
    bitmap: source,
  };
  const doc: Document = {
    width: source.width,
    height: source.height,
    colorSpace: "srgb",
    bitDepth: 8,
    resolution: { x: 72, y: 72, unit: "ppi" },
    guides: [],
    proofing: { profile: "none", intent: "relative-colorimetric", blackPointCompensation: true, gamutWarning: false },
    layers: [layer],
    selection: null,
  };
  for (const filter of filters) {
    if (!filter.enabled || filter.opacity <= 0) continue;
    const before = filter.opacity < 1 ? new Uint8ClampedArray(source.getContext("2d")!.getImageData(0, 0, source.width, source.height).data) : null;
    const defaults = SMART_FILTER_SPECS[filter.kind].defaults;
    const radius = Math.max(
      0,
      Math.min(
        Math.max(1, Math.min(source.width, source.height) / 4),
        (filter.params.radius ?? defaults.radius ?? 0) * displayScale,
      ),
    );
    if (filter.kind === "blur") gaussianBlur(doc, layer, radius);
    else if (filter.kind === "sharpen") unsharpMask(doc, layer, radius, filter.params.amount ?? 0.6);
    else if (filter.kind === "high-pass") highPass(doc, layer, radius);
    else if (filter.kind === "motion-blur") motionBlur(doc, layer, radius, filter.params.angle ?? 0);
    else if (filter.kind === "surface-blur") surfaceBlur(doc, layer, radius, filter.params.threshold ?? 24);
    else if (filter.kind === "median") medianFilter(doc, layer, radius);
    else if (filter.kind === "dust-scratches") dustAndScratches(doc, layer, radius, filter.params.threshold ?? 18);
    else if (filter.kind === "reduce-noise") reduceNoise(doc, layer, radius, filter.params.strength ?? 0.65, filter.params.preserveDetail ?? 0.55, filter.params.reduceColor ?? 0.7);
    else if (filter.kind === "lens-blur") lensBlur(doc, layer, radius, filter.params.blades ?? 6, filter.params.rotation ?? 0, filter.params.highlights ?? 0.15);
    // Displace is parameterised in pixels like every other filter here, so
    // both its amplitude and its wavelength are display-scale quantities. Left
    // unscaled they stay fixed in output pixels, which halves the ripple in
    // document space at 2x zoom — the preview stops agreeing with the export.
    else if (filter.kind === "displace") displace(doc, layer, (filter.params.amount ?? 12) * displayScale, (filter.params.scale ?? 48) * displayScale, filter.params.angle ?? 0);
    else if (filter.kind === "maximum") maximumFilter(doc, layer, radius);
    else if (filter.kind === "minimum") minimumFilter(doc, layer, radius);
    else if (filter.kind === "invert") invertColors(doc, layer);
    else if (filter.kind === "desaturate") desaturate(doc, layer, filter.params.amount ?? 1);
    else if (filter.kind === "hue") hueRotate(doc, layer, filter.params.degrees ?? 45);
    if (before) {
      const ctx = source.getContext("2d")!;
      const after = ctx.getImageData(0, 0, source.width, source.height);
      const amount = filter.opacity;
      for (let i = 0; i < after.data.length; i++) {
        after.data[i] = before[i] * (1 - amount) + after.data[i] * amount;
      }
      ctx.putImageData(after, 0, 0);
    }
  }
}

function clamp(x: number): number {
  return x < 0 ? 0 : x > 255 ? 255 : x;
}
