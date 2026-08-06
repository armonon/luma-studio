import { Document, Layer, SmartFilter, newCanvas } from "./document";

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
    const sel = doc.selection.mask.getContext("2d")!;
    const selData = sel.getImageData(0, 0, w, h).data;
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
  const iarr = 1 / (r + r + 1);
  for (let y = 0; y < h; y++) {
    let ti = y * w;
    let li = ti;
    let ri = ti + r;
    const rowStart = y * w;
    const first = src.subarray(rowStart * 4, rowStart * 4 + 4);
    const last = src.subarray((rowStart + w - 1) * 4, (rowStart + w - 1) * 4 + 4);
    const fv0 = first[0], fv1 = first[1], fv2 = first[2], fv3 = first[3];
    const lv0 = last[0], lv1 = last[1], lv2 = last[2], lv3 = last[3];
    let val0 = (r + 1) * fv0;
    let val1 = (r + 1) * fv1;
    let val2 = (r + 1) * fv2;
    let val3 = (r + 1) * fv3;
    for (let j = 0; j < r; j++) {
      const idx = (rowStart + j) * 4;
      val0 += src[idx];
      val1 += src[idx + 1];
      val2 += src[idx + 2];
      val3 += src[idx + 3];
    }
    for (let j = 0; j <= r; j++) {
      const idx = (rowStart + j + r) * 4;
      val0 += src[idx] - fv0;
      val1 += src[idx + 1] - fv1;
      val2 += src[idx + 2] - fv2;
      val3 += src[idx + 3] - fv3;
      const to = ti * 4;
      dst[to] = val0 * iarr;
      dst[to + 1] = val1 * iarr;
      dst[to + 2] = val2 * iarr;
      dst[to + 3] = val3 * iarr;
      ti++;
    }
    for (let j = r + 1; j < w - r; j++) {
      const ai = (li + r + 1) * 4;
      const bi = li * 4;
      val0 += src[(ri + 1) * 4] - src[bi];
      val1 += src[(ri + 1) * 4 + 1] - src[bi + 1];
      val2 += src[(ri + 1) * 4 + 2] - src[bi + 2];
      val3 += src[(ri + 1) * 4 + 3] - src[bi + 3];
      const to = ti * 4;
      dst[to] = val0 * iarr;
      dst[to + 1] = val1 * iarr;
      dst[to + 2] = val2 * iarr;
      dst[to + 3] = val3 * iarr;
      li++;
      ri++;
      ti++;
      void ai;
    }
    for (let j = w - r; j < w; j++) {
      const bi = li * 4;
      val0 += lv0 - src[bi];
      val1 += lv1 - src[bi + 1];
      val2 += lv2 - src[bi + 2];
      val3 += lv3 - src[bi + 3];
      const to = ti * 4;
      dst[to] = val0 * iarr;
      dst[to + 1] = val1 * iarr;
      dst[to + 2] = val2 * iarr;
      dst[to + 3] = val3 * iarr;
      li++;
      ti++;
    }
  }
}

function boxBlurV(src: Uint8ClampedArray, dst: Uint8ClampedArray, w: number, h: number, r: number) {
  const iarr = 1 / (r + r + 1);
  for (let x = 0; x < w; x++) {
    let ti = x;
    let li = ti;
    let ri = ti + r * w;
    const firstIdx = x * 4;
    const lastIdx = ((h - 1) * w + x) * 4;
    const fv0 = src[firstIdx], fv1 = src[firstIdx + 1], fv2 = src[firstIdx + 2], fv3 = src[firstIdx + 3];
    const lv0 = src[lastIdx], lv1 = src[lastIdx + 1], lv2 = src[lastIdx + 2], lv3 = src[lastIdx + 3];
    let val0 = (r + 1) * fv0;
    let val1 = (r + 1) * fv1;
    let val2 = (r + 1) * fv2;
    let val3 = (r + 1) * fv3;
    for (let j = 0; j < r; j++) {
      const idx = (j * w + x) * 4;
      val0 += src[idx];
      val1 += src[idx + 1];
      val2 += src[idx + 2];
      val3 += src[idx + 3];
    }
    for (let j = 0; j <= r; j++) {
      const rIdx = ((j + r) * w + x) * 4;
      val0 += src[rIdx] - fv0;
      val1 += src[rIdx + 1] - fv1;
      val2 += src[rIdx + 2] - fv2;
      val3 += src[rIdx + 3] - fv3;
      const to = ti * 4;
      dst[to] = val0 * iarr;
      dst[to + 1] = val1 * iarr;
      dst[to + 2] = val2 * iarr;
      dst[to + 3] = val3 * iarr;
      ti += w;
    }
    for (let j = r + 1; j < h - r; j++) {
      const rIdx = ((ri + w) * 4);
      const lIdx = li * 4;
      val0 += src[rIdx] - src[lIdx];
      val1 += src[rIdx + 1] - src[lIdx + 1];
      val2 += src[rIdx + 2] - src[lIdx + 2];
      val3 += src[rIdx + 3] - src[lIdx + 3];
      const to = ti * 4;
      dst[to] = val0 * iarr;
      dst[to + 1] = val1 * iarr;
      dst[to + 2] = val2 * iarr;
      dst[to + 3] = val3 * iarr;
      li += w;
      ri += w;
      ti += w;
    }
    for (let j = h - r; j < h; j++) {
      const lIdx = li * 4;
      val0 += lv0 - src[lIdx];
      val1 += lv1 - src[lIdx + 1];
      val2 += lv2 - src[lIdx + 2];
      val3 += lv3 - src[lIdx + 3];
      const to = ti * 4;
      dst[to] = val0 * iarr;
      dst[to + 1] = val1 * iarr;
      dst[to + 2] = val2 * iarr;
      dst[to + 3] = val3 * iarr;
      li += w;
      ti += w;
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
    if (filter.kind === "blur") gaussianBlur(doc, layer, filter.params.radius ?? 8);
    else if (filter.kind === "sharpen") unsharpMask(doc, layer, filter.params.radius ?? 2, filter.params.amount ?? 0.6);
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
