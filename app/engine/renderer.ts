import {
  Document,
  Layer,
  ToneParams,
  applyCurvesToImageData,
  applyHslToImageData,
  applyLevelsToImageData,
  drawLayerContent,
  effectiveLayerOpacity,
  effectiveLayerVisible,
  findClippingBase,
  newCanvas,
} from "./document";
import { applySmartFilters } from "./filters";
import { drawSelectionOutline } from "./selection";
import { getDisplayCtx } from "./gl-renderer";

type Scratch = {
  a: HTMLCanvasElement;
  b: HTMLCanvasElement;
  layerBuf: HTMLCanvasElement;
};

function scratch(width: number, height: number, cache: Scratch | null): Scratch {
  if (cache && cache.a.width === width && cache.a.height === height) return cache;
  return {
    a: newCanvas(width, height),
    b: newCanvas(width, height),
    layerBuf: newCanvas(width, height),
  };
}

export function toneToFilter(tone: ToneParams): string {
  const brightness = 1 + tone.exposure * 0.35;
  const contrast = 1 + tone.contrast / 100;
  const saturate = 1 + tone.vibrance / 200;
  const hue = -tone.temperature * 0.4;
  const sepia = Math.max(0, tone.temperature) / 200;
  return `brightness(${brightness}) contrast(${contrast}) saturate(${saturate}) hue-rotate(${hue}deg) sepia(${sepia})`;
}

function applyHighlightsShadows(
  target: CanvasRenderingContext2D,
  width: number,
  height: number,
  highlights: number,
  shadows: number,
) {
  if (highlights === 0 && shadows === 0) return;
  const img = target.getImageData(0, 0, width, height);
  const data = img.data;
  const hi = highlights / 100;
  const sh = shadows / 100;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const wS = Math.pow(1 - l, 2);
    const wH = Math.pow(l, 2);
    const shift = sh * wS * 0.6 + hi * wH * -0.6;
    data[i] = clamp255((r + shift) * 255);
    data[i + 1] = clamp255((g + shift) * 255);
    data[i + 2] = clamp255((b + shift) * 255);
  }
  target.putImageData(img, 0, 0);
}

function clamp255(x: number) {
  return x < 0 ? 0 : x > 255 ? 255 : x;
}

let cachedScratch: Scratch | null = null;
let antsOffset = 0;

export type RenderOptions = {
  checkerboard?: boolean;
  selectionOverlay?: boolean;
};

export function render(
  doc: Document,
  target: HTMLCanvasElement,
  options: RenderOptions = {},
) {
  const checkerboard = options.checkerboard ?? true;
  const selectionOverlay = options.selectionOverlay ?? true;
  if (target.width !== doc.width) target.width = doc.width;
  if (target.height !== doc.height) target.height = doc.height;

  const s = (cachedScratch = scratch(doc.width, doc.height, cachedScratch));
  const composite = s.a.getContext("2d")!;
  composite.save();
  composite.setTransform(1, 0, 0, 1, 0, 0);
  composite.clearRect(0, 0, doc.width, doc.height);
  composite.restore();

  for (let i = doc.layers.length - 1; i >= 0; i--) {
    const sourceLayer = doc.layers[i];
    if (sourceLayer.kind === "group" || !effectiveLayerVisible(doc, sourceLayer)) continue;
    const opacity = effectiveLayerOpacity(doc, sourceLayer);
    if (opacity <= 0) continue;
    const layer = opacity === sourceLayer.opacity ? sourceLayer : { ...sourceLayer, opacity };
    if (layer.kind === "adjustment-tone" && layer.tone) {
      drawAdjustment(composite, s, doc, layer);
    } else if (layer.kind === "adjustment-curves" && layer.curves) {
      drawPixelAdjustment(composite, s, doc, layer, (img) => applyCurvesToImageData(img, layer.curves!));
    } else if (layer.kind === "adjustment-levels" && layer.levels) {
      drawPixelAdjustment(composite, s, doc, layer, (img) => applyLevelsToImageData(img, layer.levels!));
    } else if (layer.kind === "adjustment-hsl" && layer.hsl) {
      drawPixelAdjustment(composite, s, doc, layer, (img) => applyHslToImageData(img, layer.hsl!));
    } else {
      drawContentLayer(composite, s.layerBuf, doc, layer);
    }
  }

  const out = getDisplayCtx(target)!;
  out.save();
  out.setTransform(1, 0, 0, 1, 0, 0);
  out.clearRect(0, 0, doc.width, doc.height);
  if (checkerboard) drawCheckerboard(out, doc.width, doc.height);
  out.drawImage(s.a, 0, 0);
  if (selectionOverlay && doc.selection) {
    antsOffset = (antsOffset + 1) % 20;
    drawSelectionOutline(out, doc.selection, antsOffset);
  }
  out.restore();
}

/** Render only document pixels. UI chrome must never leak into files or batch output. */
export function renderClean(doc: Document, target: HTMLCanvasElement) {
  render(doc, target, { checkerboard: false, selectionOverlay: false });
}

function drawContentLayer(
  composite: CanvasRenderingContext2D,
  layerBuf: HTMLCanvasElement,
  doc: Document,
  layer: Layer,
) {
  const bctx = layerBuf.getContext("2d")!;
  bctx.save();
  bctx.setTransform(1, 0, 0, 1, 0, 0);
  bctx.globalCompositeOperation = "source-over";
  bctx.globalAlpha = 1;
  bctx.clearRect(0, 0, doc.width, doc.height);
  for (const effect of layer.effects ?? []) {
    if (!effect.enabled || effect.opacity <= 0 || effect.kind !== "drop-shadow") continue;
    bctx.save();
    bctx.globalAlpha = effect.opacity;
    bctx.shadowColor = effect.color;
    bctx.shadowBlur = effect.blur;
    bctx.shadowOffsetX = effect.offsetX;
    bctx.shadowOffsetY = effect.offsetY;
    drawLayerContent(bctx, layer);
    bctx.restore();
  }
  drawLayerContent(bctx, layer);
  applySmartFilters(layerBuf, layer.filters);
  if (layer.clipping) {
    const base = findClippingBase(doc, layer);
    if (base) {
      const clip = newCanvas(doc.width, doc.height);
      drawLayerContent(clip.getContext("2d")!, base);
      bctx.globalCompositeOperation = "destination-in";
      bctx.drawImage(clip, 0, 0);
      bctx.globalCompositeOperation = "source-over";
    }
  }
  if (layer.mask) {
    bctx.setTransform(1, 0, 0, 1, 0, 0);
    bctx.globalCompositeOperation = "destination-in";
    bctx.drawImage(layer.mask, 0, 0);
  }
  bctx.restore();

  composite.save();
  composite.globalCompositeOperation = layer.blend;
  composite.globalAlpha = layer.opacity;
  composite.drawImage(layerBuf, 0, 0);
  composite.restore();
}

function drawAdjustment(
  composite: CanvasRenderingContext2D,
  s: Scratch,
  doc: Document,
  layer: Layer,
) {
  if (!layer.tone) return;
  const snap = s.b;
  const sctx = snap.getContext("2d")!;
  sctx.save();
  sctx.setTransform(1, 0, 0, 1, 0, 0);
  sctx.filter = "none";
  sctx.globalCompositeOperation = "source-over";
  sctx.globalAlpha = 1;
  sctx.clearRect(0, 0, doc.width, doc.height);
  sctx.filter = toneToFilter(layer.tone);
  sctx.drawImage(s.a, 0, 0);
  sctx.filter = "none";
  applyHighlightsShadows(sctx, doc.width, doc.height, layer.tone.highlights, layer.tone.shadows);
  sctx.restore();

  if (layer.mask) {
    const bctx = s.layerBuf.getContext("2d")!;
    bctx.save();
    bctx.setTransform(1, 0, 0, 1, 0, 0);
    bctx.globalCompositeOperation = "source-over";
    bctx.globalAlpha = 1;
    bctx.clearRect(0, 0, doc.width, doc.height);
    bctx.drawImage(snap, 0, 0);
    bctx.globalCompositeOperation = "destination-in";
    bctx.drawImage(layer.mask, 0, 0);
    bctx.restore();

    composite.save();
    composite.globalCompositeOperation = layer.blend;
    composite.globalAlpha = layer.opacity;
    composite.drawImage(s.layerBuf, 0, 0);
    composite.restore();
    return;
  }

  composite.save();
  composite.globalCompositeOperation = layer.blend;
  composite.globalAlpha = layer.opacity;
  composite.drawImage(snap, 0, 0);
  composite.restore();
}

function drawPixelAdjustment(
  composite: CanvasRenderingContext2D,
  s: Scratch,
  doc: Document,
  layer: Layer,
  op: (img: ImageData) => ImageData,
) {
  const snap = s.b;
  const sctx = snap.getContext("2d")!;
  sctx.save();
  sctx.setTransform(1, 0, 0, 1, 0, 0);
  sctx.globalCompositeOperation = "source-over";
  sctx.globalAlpha = 1;
  sctx.clearRect(0, 0, doc.width, doc.height);
  sctx.drawImage(s.a, 0, 0);
  const img = sctx.getImageData(0, 0, doc.width, doc.height);
  op(img);
  sctx.putImageData(img, 0, 0);
  sctx.restore();

  if (layer.mask) {
    const bctx = s.layerBuf.getContext("2d")!;
    bctx.save();
    bctx.setTransform(1, 0, 0, 1, 0, 0);
    bctx.globalCompositeOperation = "source-over";
    bctx.globalAlpha = 1;
    bctx.clearRect(0, 0, doc.width, doc.height);
    bctx.drawImage(snap, 0, 0);
    bctx.globalCompositeOperation = "destination-in";
    bctx.drawImage(layer.mask, 0, 0);
    bctx.restore();
    composite.save();
    composite.globalCompositeOperation = layer.blend;
    composite.globalAlpha = layer.opacity;
    composite.drawImage(s.layerBuf, 0, 0);
    composite.restore();
    return;
  }
  composite.save();
  composite.globalCompositeOperation = layer.blend;
  composite.globalAlpha = layer.opacity;
  composite.drawImage(snap, 0, 0);
  composite.restore();
}

function drawCheckerboard(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const tile = 16;
  ctx.save();
  ctx.fillStyle = "#1c1c22";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#26262e";
  for (let y = 0; y < h; y += tile) {
    for (let x = 0; x < w; x += tile) {
      if (((x / tile) ^ (y / tile)) & 1) ctx.fillRect(x, y, tile, tile);
    }
  }
  ctx.restore();
}
