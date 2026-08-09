import {
  Document,
  Layer,
  SmartFilter,
  inverseAffineForLayerTransform,
  newCanvas,
} from "./document";

// Apply an ImageData transform to `layer.bitmap`, constrained to `doc.selection`
// (if present). Returns nothing; mutates the layer's bitmap.
function applyPixelFilter(
  doc: Document,
  layer: Layer,
  transform: (src: ImageData) => ImageData,
) {
  if (!layer.bitmap) return;
  const src = layer.bitmap.getContext("2d")!;
  const w = layer.bitmap.width;
  const h = layer.bitmap.height;
  const input = src.getImageData(0, 0, w, h);
  const output = transform(input);

  if (doc.selection) {
    // Blend the filtered pixels into the source by selection alpha.
    const localSelection = newCanvas(w, h);
    const localSelectionContext = localSelection.getContext("2d")!;
    const inverse = inverseAffineForLayerTransform(layer.transform);
    if (!inverse) return;
    localSelectionContext.setTransform(inverse.a, inverse.b, inverse.c, inverse.d, inverse.e, inverse.f);
    localSelectionContext.drawImage(doc.selection.mask, 0, 0);
    const selData = localSelectionContext.getImageData(0, 0, w, h).data;
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
    src.putImageData(input, 0, 0);
  } else {
    src.putImageData(output, 0, 0);
  }
}

// Separable Gaussian via three iterations of a box blur (van Vliet / Wells
// approximation) — cheap and visually indistinguishable at typical radii.
export function gaussianBlur(doc: Document, layer: Layer, radius: number) {
  if (radius <= 0) return;
  applyPixelFilter(doc, layer, (src) => boxBlur3(src, radius));
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
  const w = layer.bitmap.width;
  const h = layer.bitmap.height;
  const ctx = layer.bitmap.getContext("2d")!;
  const src = ctx.getImageData(0, 0, w, h);
  const blur = boxBlur3(new ImageData(new Uint8ClampedArray(src.data), w, h), radius);
  const out = new ImageData(new Uint8ClampedArray(src.data.length), w, h);
  const sd = src.data;
  const bd = blur.data;
  const od = out.data;
  for (let i = 0; i < sd.length; i += 4) {
    od[i] = clamp(sd[i] + amount * (sd[i] - bd[i]));
    od[i + 1] = clamp(sd[i + 1] + amount * (sd[i + 1] - bd[i + 1]));
    od[i + 2] = clamp(sd[i + 2] + amount * (sd[i + 2] - bd[i + 2]));
    od[i + 3] = sd[i + 3];
  }
  applyPixelFilter(doc, layer, () => out);
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
  const w = layer.bitmap.width;
  const h = layer.bitmap.height;
  // Cheap route: use canvas filter to render into a temp, then re-read.
  const tmp = newCanvas(w, h);
  const t = tmp.getContext("2d")!;
  t.filter = `hue-rotate(${degrees}deg)`;
  t.drawImage(layer.bitmap, 0, 0);
  const shifted = t.getImageData(0, 0, w, h);
  applyPixelFilter(doc, layer, () => shifted);
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
    const radius = Math.max(
      0,
      Math.min(
        Math.max(1, Math.min(source.width, source.height) / 4),
        (filter.params.radius ?? (filter.kind === "blur" ? 8 : 2)) * displayScale,
      ),
    );
    if (filter.kind === "blur") gaussianBlur(doc, layer, radius);
    else if (filter.kind === "sharpen") unsharpMask(doc, layer, radius, filter.params.amount ?? 0.6);
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
