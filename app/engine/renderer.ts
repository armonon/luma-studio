import {
  Document,
  Layer,
  ToneParams,
  applyCurvesToImageData,
  applyHslToImageData,
  applyLevelsToImageData,
  findClippingBase,
  newCanvas,
  resolvedBlendIf,
  resolvedBlendPasses,
  resolvedFillOpacity,
} from "./document";
import { drawLayerContentManaged } from "./precision-renderer";
import { applySmartFilters } from "./filters";
import { compositeBlendStack } from "./blend";
import { getDisplayCtx } from "./gl-renderer";
import { softProofDisplayRgb } from "./color";
import { DEFAULT_TILE_SIZE } from "./tile-store";
import type { PixelRect } from "./tile-store";
import type { DisplayViewport } from "./viewport";
import {
  DISPLAY_P3_PROFILE,
  SRGB_PROFILE,
  createProofingTransform,
} from "./color-management";

type Scratch = {
  a: HTMLCanvasElement;
  b: HTMLCanvasElement;
  layerBuf: HTMLCanvasElement;
  contentBuf: HTMLCanvasElement;
  effectBuf: HTMLCanvasElement;
  clipBuf: HTMLCanvasElement;
  /** Reused by nesting depth; sibling groups never need distinct buffers. */
  groupBufs: HTMLCanvasElement[];
};

type PreparedLayers = Map<string | undefined, Layer[]>;

type RenderFrame = {
  x: number;
  y: number;
  width: number;
  height: number;
  outputWidth: number;
  outputHeight: number;
};

type ScratchCacheEntry = {
  buffers: Scratch;
  bytes: number;
  used: number;
};

const scratchCache = new Map<string, ScratchCacheEntry>();
const MAX_SCRATCH_CACHE_ENTRIES = 6;
const MAX_SCRATCH_CACHE_BYTES = 32 * 1024 * 1024;
let scratchCacheBytes = 0;
let scratchCacheClock = 0;

function trimScratchCache(protectedKey: string) {
  while ((scratchCache.size > MAX_SCRATCH_CACHE_ENTRIES || scratchCacheBytes > MAX_SCRATCH_CACHE_BYTES) &&
    scratchCache.size > 1) {
    let oldestKey = "";
    let oldestUse = Infinity;
    for (const [candidate, entry] of scratchCache) {
      if (candidate === protectedKey || entry.used >= oldestUse) continue;
      oldestKey = candidate;
      oldestUse = entry.used;
    }
    if (!oldestKey) break;
    scratchCacheBytes -= scratchCache.get(oldestKey)!.bytes;
    scratchCache.delete(oldestKey);
  }
  const protectedEntry = scratchCache.get(protectedKey);
  if (protectedEntry && protectedEntry.bytes > MAX_SCRATCH_CACHE_BYTES) {
    // The active render still owns the buffers, but an oversized full-document
    // scratch set must not remain retained by the cache after the frame.
    scratchCacheBytes -= protectedEntry.bytes;
    scratchCache.delete(protectedKey);
  }
}

function scratch(width: number, height: number): Scratch {
  const key = `${width}:${height}`;
  const hit = scratchCache.get(key);
  if (hit) {
    hit.used = ++scratchCacheClock;
    return hit.buffers;
  }
  const buffers = {
    a: newCanvas(width, height),
    b: newCanvas(width, height),
    layerBuf: newCanvas(width, height),
    contentBuf: newCanvas(width, height),
    effectBuf: newCanvas(width, height),
    clipBuf: newCanvas(width, height),
    groupBufs: [],
  };
  const bytes = width * height * 4 * 6;
  scratchCache.set(key, { buffers, bytes, used: ++scratchCacheClock });
  scratchCacheBytes += bytes;
  trimScratchCache(key);
  return buffers;
}

function groupBuffer(s: Scratch, depth: number, width: number, height: number) {
  let canvas = s.groupBufs[depth];
  if (!canvas) {
    canvas = newCanvas(width, height);
    s.groupBufs[depth] = canvas;
    const key = `${width}:${height}`;
    const entry = scratchCache.get(key);
    if (entry) {
      const bytes = width * height * 4;
      entry.bytes += bytes;
      scratchCacheBytes += bytes;
      trimScratchCache(key);
    }
  }
  clearContext(canvas.getContext("2d")!, width, height);
  return canvas;
}

function prepareLayers(doc: Document): PreparedLayers {
  const knownGroups = new Set(doc.layers.filter((layer) => layer.kind === "group").map((layer) => layer.id));
  const prepared: PreparedLayers = new Map();
  for (const layer of doc.layers) {
    const parentId = layer.parentId && knownGroups.has(layer.parentId) ? layer.parentId : undefined;
    const siblings = prepared.get(parentId);
    if (siblings) siblings.push(layer);
    else prepared.set(parentId, [layer]);
  }
  return prepared;
}

function clearContext(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.filter = "none";
  ctx.clearRect(0, 0, width, height);
  ctx.restore();
}

function frameScale(frame: RenderFrame) {
  return {
    x: frame.outputWidth / frame.width,
    y: frame.outputHeight / frame.height,
  };
}

function setFrameTransform(ctx: CanvasRenderingContext2D, frame: RenderFrame) {
  const scale = frameScale(frame);
  ctx.setTransform(scale.x, 0, 0, scale.y, -frame.x * scale.x, -frame.y * scale.y);
}

function frameTransform(frame: RenderFrame) {
  const scale = frameScale(frame);
  return { a: scale.x, b: 0, c: 0, d: scale.y, e: -frame.x * scale.x, f: -frame.y * scale.y };
}

function drawProjectedCanvas(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  frame: RenderFrame,
) {
  ctx.save();
  setFrameTransform(ctx, frame);
  ctx.drawImage(source, 0, 0);
  ctx.restore();
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
    const shift = sh * Math.pow(1 - l, 2) * 0.6 + hi * Math.pow(l, 2) * -0.6;
    data[i] = clamp255((r + shift) * 255);
    data[i + 1] = clamp255((g + shift) * 255);
    data[i + 2] = clamp255((b + shift) * 255);
  }
  target.putImageData(img, 0, 0);
}

function clamp255(x: number) {
  return x < 0 ? 0 : x > 255 ? 255 : x;
}

let antsOffset = 0;

export type RenderOptions = {
  checkerboard?: boolean;
  selectionOverlay?: boolean;
  proofing?: boolean;
  /** Stable document-content revision. Enables bounded viewport tile reuse. */
  cacheRevision?: number;
  /** Document-space regions changed since the last frame on this target. */
  dirtyRegions?: readonly PixelRect[];
  /** Non-destructive channel inspection; omitted for the RGB composite. */
  channelView?: "rgb" | "red" | "green" | "blue" | "alpha";
};

export const INTERACTIVE_PERFORMANCE_TARGETS = {
  brushFrameMs: 16.7,
  navigationFrameMs: 33.3,
  maximumDocumentEdge: 50_000,
} as const;

type ViewportRenderSample = {
  durationMs: number;
  renderedTiles: number;
  totalTiles: number;
  partial: boolean;
};

const viewportRenderSamples: ViewportRenderSample[] = [];
const MAX_RENDER_SAMPLES = 120;
const viewportTargetState = new WeakMap<HTMLCanvasElement, string>();

function viewportSignature(viewport: DisplayViewport) {
  return [
    viewport.x.toFixed(5),
    viewport.y.toFixed(5),
    viewport.width.toFixed(5),
    viewport.height.toFixed(5),
    viewport.outputWidth,
    viewport.outputHeight,
  ].join(":");
}

function recordViewportRender(sample: ViewportRenderSample) {
  viewportRenderSamples.push(sample);
  if (viewportRenderSamples.length > MAX_RENDER_SAMPLES) viewportRenderSamples.shift();
}

export function viewportRenderPerformanceStats() {
  const durations = viewportRenderSamples.map((sample) => sample.durationMs).sort((a, b) => a - b);
  const latest = viewportRenderSamples.at(-1);
  const averageMs = durations.length
    ? durations.reduce((sum, duration) => sum + duration, 0) / durations.length
    : 0;
  const p95Ms = durations.length
    ? durations[Math.min(durations.length - 1, Math.floor(durations.length * 0.95))]
    : 0;
  return {
    samples: durations.length,
    latestMs: latest?.durationMs ?? 0,
    averageMs,
    p95Ms,
    latestRenderedTiles: latest?.renderedTiles ?? 0,
    latestTotalTiles: latest?.totalTiles ?? 0,
    latestPartial: latest?.partial ?? false,
    targets: INTERACTIVE_PERFORMANCE_TARGETS,
  };
}

/** Screen-tile keys intersecting document-space dirty regions. */
export function viewportTileKeysForDirtyRegions(
  viewport: DisplayViewport,
  dirtyRegions: readonly PixelRect[],
  overscanPixels = 0,
  tilePixels = DEFAULT_TILE_SIZE,
) {
  const keys = new Set<string>();
  const scaleX = viewport.outputWidth / viewport.width;
  const scaleY = viewport.outputHeight / viewport.height;
  const columns = Math.ceil(viewport.outputWidth / tilePixels);
  const rows = Math.ceil(viewport.outputHeight / tilePixels);
  for (const region of dirtyRegions) {
    if (region.width <= 0 || region.height <= 0) continue;
    const left = (region.x - viewport.x) * scaleX - overscanPixels;
    const top = (region.y - viewport.y) * scaleY - overscanPixels;
    const right = (region.x + region.width - viewport.x) * scaleX + overscanPixels;
    const bottom = (region.y + region.height - viewport.y) * scaleY + overscanPixels;
    if (right <= 0 || bottom <= 0 || left >= viewport.outputWidth || top >= viewport.outputHeight) continue;
    const firstColumn = Math.max(0, Math.floor(left / tilePixels));
    const lastColumn = Math.min(columns - 1, Math.floor(Math.max(0, right - 0.000001) / tilePixels));
    const firstRow = Math.max(0, Math.floor(top / tilePixels));
    const lastRow = Math.min(rows - 1, Math.floor(Math.max(0, bottom - 0.000001) / tilePixels));
    for (let row = firstRow; row <= lastRow; row += 1) {
      for (let column = firstColumn; column <= lastColumn; column += 1) keys.add(`${column}:${row}`);
    }
  }
  return keys;
}

type ViewportCacheEntry = { canvas: HTMLCanvasElement; used: number; bytes: number };
type ViewportCacheState = { tiles: Map<string, ViewportCacheEntry>; bytes: number };
const viewportCaches = new WeakMap<Document, ViewportCacheState>();
const MAX_VIEWPORT_CACHE_TILES = 96;
const MAX_VIEWPORT_CACHE_BYTES = 32 * 1024 * 1024;
let viewportCacheClock = 0;
let viewportCacheHits = 0;
let viewportCacheMisses = 0;
let viewportCacheEvictions = 0;

function viewportCacheKey(frame: RenderFrame, options: RenderOptions) {
  return [
    options.cacheRevision,
    frame.x.toFixed(5),
    frame.y.toFixed(5),
    frame.width.toFixed(5),
    frame.height.toFixed(5),
    frame.outputWidth,
    frame.outputHeight,
    options.proofing ?? true,
    options.channelView ?? "rgb",
  ].join(":");
}

function viewportTile(
  doc: Document,
  frame: RenderFrame,
  options: RenderOptions,
  preparedLayers: () => PreparedLayers,
) {
  if (options.cacheRevision === undefined) return renderCompositeRegion(doc, frame, options, preparedLayers());
  let state = viewportCaches.get(doc);
  if (!state) {
    state = { tiles: new Map(), bytes: 0 };
    viewportCaches.set(doc, state);
  }
  const cache = state.tiles;
  const key = viewportCacheKey(frame, options);
  viewportCacheClock += 1;
  const hit = cache.get(key);
  if (hit) {
    hit.used = viewportCacheClock;
    viewportCacheHits += 1;
    return hit.canvas;
  }
  viewportCacheMisses += 1;
  const rendered = renderCompositeRegion(doc, frame, options, preparedLayers());
  const canvas = newCanvas(frame.outputWidth, frame.outputHeight);
  canvas.getContext("2d")!.drawImage(rendered, 0, 0);
  const bytes = frame.outputWidth * frame.outputHeight * 4;
  cache.set(key, { canvas, used: viewportCacheClock, bytes });
  state.bytes += bytes;
  while ((cache.size > MAX_VIEWPORT_CACHE_TILES || state.bytes > MAX_VIEWPORT_CACHE_BYTES) && cache.size > 1) {
    let oldestKey = "";
    let oldestUse = Infinity;
    for (const [candidate, entry] of cache) {
      if (candidate === key || entry.used >= oldestUse) continue;
      oldestKey = candidate;
      oldestUse = entry.used;
    }
    if (oldestKey) {
      state.bytes -= cache.get(oldestKey)!.bytes;
      cache.delete(oldestKey);
      viewportCacheEvictions += 1;
    } else break;
  }
  return canvas;
}

export function viewportRenderCacheStats() {
  return {
    hits: viewportCacheHits,
    misses: viewportCacheMisses,
    evictions: viewportCacheEvictions,
    maxTilesPerDocument: MAX_VIEWPORT_CACHE_TILES,
    maxBytesPerDocument: MAX_VIEWPORT_CACHE_BYTES,
    scratchCacheEntries: scratchCache.size,
    scratchCacheBytes,
    maxScratchCacheBytes: MAX_SCRATCH_CACHE_BYTES,
  };
}

function renderCompositeRegion(
  doc: Document,
  frame: RenderFrame,
  options: RenderOptions,
  preparedLayers = prepareLayers(doc),
) {
  const s = scratch(frame.outputWidth, frame.outputHeight);
  const composite = s.a.getContext("2d")!;
  clearContext(composite, frame.outputWidth, frame.outputHeight);

  renderLayerSequence(composite, s, doc, frame, preparedLayers, undefined, 0);

  if (options.proofing ?? true) applySoftProof(composite, doc, frame.outputWidth, frame.outputHeight);
  applyChannelView(composite, frame.outputWidth, frame.outputHeight, options.channelView ?? "rgb");
  return s.a;
}

function applyChannelView(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  channel: NonNullable<RenderOptions["channelView"]>,
) {
  if (channel === "rgb") return;
  const image = context.getImageData(0, 0, width, height);
  const index = channel === "red" ? 0 : channel === "green" ? 1 : channel === "blue" ? 2 : 3;
  for (let offset = 0; offset < image.data.length; offset += 4) {
    const value = image.data[offset + index];
    image.data[offset] = value;
    image.data[offset + 1] = value;
    image.data[offset + 2] = value;
    if (channel === "alpha") image.data[offset + 3] = 255;
  }
  context.putImageData(image, 0, 0);
}

function renderLayerSequence(
  composite: CanvasRenderingContext2D,
  s: Scratch,
  doc: Document,
  frame: RenderFrame,
  preparedLayers: PreparedLayers,
  parentId: string | undefined,
  groupDepth: number,
) {
  const siblings = preparedLayers.get(parentId) ?? [];
  for (let i = siblings.length - 1; i >= 0; i--) {
    const layer = siblings[i];
    if (!layer.visible || layer.opacity <= 0) continue;
    if (layer.kind === "group") {
      if (groupIsPassThrough(layer)) {
        renderLayerSequence(composite, s, doc, frame, preparedLayers, layer.id, groupDepth);
      } else {
        const groupCanvas = groupBuffer(s, groupDepth, frame.outputWidth, frame.outputHeight);
        const groupContext = groupCanvas.getContext("2d")!;
        renderLayerSequence(groupContext, s, doc, frame, preparedLayers, layer.id, groupDepth + 1);
        if (layer.mask) {
          groupContext.globalCompositeOperation = "destination-in";
          drawProjectedCanvas(groupContext, layer.mask, frame);
          groupContext.globalCompositeOperation = "source-over";
        }
        compositeBlendStack(
          composite,
          groupCanvas,
          resolvedBlendPasses(layer),
          layer.opacity * resolvedFillOpacity(layer),
          resolvedBlendIf(layer),
        );
      }
      continue;
    }
    if (layer.kind === "adjustment-tone" && layer.tone) {
      drawAdjustment(composite, s, layer, frame);
    } else if (layer.kind === "adjustment-curves" && layer.curves) {
      drawPixelAdjustment(composite, s, layer, frame, (img) => applyCurvesToImageData(img, layer.curves!));
    } else if (layer.kind === "adjustment-levels" && layer.levels) {
      drawPixelAdjustment(composite, s, layer, frame, (img) => applyLevelsToImageData(img, layer.levels!));
    } else if (layer.kind === "adjustment-hsl" && layer.hsl) {
      drawPixelAdjustment(composite, s, layer, frame, (img) => applyHslToImageData(img, layer.hsl!));
    } else {
      drawContentLayer(composite, s, doc, layer, frame);
    }
  }
}

function groupIsPassThrough(layer: Layer) {
  const passes = resolvedBlendPasses(layer);
  return layer.opacity === 1 && resolvedFillOpacity(layer) === 1 && !layer.mask &&
    !(layer.effects?.some((effect) => effect.enabled)) &&
    !(layer.filters?.some((filter) => filter.enabled)) &&
    passes.length === 1 && passes[0].enabled && passes[0].mode === "source-over" && passes[0].opacity === 1;
}

export function render(
  doc: Document,
  target: HTMLCanvasElement,
  options: RenderOptions = {},
) {
  const frame: RenderFrame = {
    x: 0,
    y: 0,
    width: doc.width,
    height: doc.height,
    outputWidth: doc.width,
    outputHeight: doc.height,
  };
  if (target.width !== doc.width) target.width = doc.width;
  if (target.height !== doc.height) target.height = doc.height;
  const composite = renderCompositeRegion(doc, frame, options);
  const out = getDisplayCtx(target)!;
  clearContext(out, target.width, target.height);
  if (options.checkerboard ?? true) drawDocumentCheckerboard(out, doc, frame);
  out.drawImage(composite, 0, 0);
  if ((options.selectionOverlay ?? true) && doc.selection) drawProjectedSelection(out, doc, frame);
}

/**
 * Production preview compositor. Its backing store is bounded to the visible
 * stage and every layer is evaluated in small screen-space tiles. Overscan is
 * cropped away after compositing, preserving blur and shadow continuity while
 * keeping the working set independent of document dimensions.
 */
export function renderViewport(
  doc: Document,
  target: HTMLCanvasElement,
  viewport: DisplayViewport,
  options: RenderOptions = {},
) {
  const startedAt = typeof performance === "undefined" ? Date.now() : performance.now();
  const signature = viewportSignature(viewport);
  const sameViewport = viewportTargetState.get(target) === signature;
  const resized = target.width !== viewport.outputWidth || target.height !== viewport.outputHeight;
  if (target.width !== viewport.outputWidth) target.width = viewport.outputWidth;
  if (target.height !== viewport.outputHeight) target.height = viewport.outputHeight;
  const out = getDisplayCtx(target)!;
  const fullFrame: RenderFrame = viewport;
  let preparedLayers: PreparedLayers | null = null;
  // Resolve lazily so a frame served entirely from the tile cache never walks
  // the layer hierarchy. Misses still share one prepared hierarchy per frame.
  const getPreparedLayers = () => (preparedLayers ??= prepareLayers(doc));

  const tilePixels = DEFAULT_TILE_SIZE;
  const overscan = renderOverscanPixels(doc, viewport.zoom);
  const scaleX = viewport.outputWidth / viewport.width;
  const scaleY = viewport.outputHeight / viewport.height;
  const totalTiles = Math.ceil(viewport.outputWidth / tilePixels) * Math.ceil(viewport.outputHeight / tilePixels);
  const dirtyTileKeys = options.dirtyRegions?.length
    ? viewportTileKeysForDirtyRegions(viewport, options.dirtyRegions, overscan, tilePixels)
    : null;
  // Selection ants animate independently of document pixels, so selection
  // frames currently use a full redraw. Dirty rendering is safe only when the
  // target still contains the exact same viewport from the preceding frame.
  const partial = !resized && sameViewport && !doc.selection && !!dirtyTileKeys;

  if (!partial) {
    clearContext(out, viewport.outputWidth, viewport.outputHeight);
    if (options.checkerboard ?? true) drawDocumentCheckerboard(out, doc, fullFrame);
  }

  let renderedTiles = 0;

  for (let top = 0, row = 0; top < viewport.outputHeight; top += tilePixels, row += 1) {
    const height = Math.min(tilePixels, viewport.outputHeight - top);
    for (let left = 0, column = 0; left < viewport.outputWidth; left += tilePixels, column += 1) {
      if (partial && !dirtyTileKeys!.has(`${column}:${row}`)) continue;
      const width = Math.min(tilePixels, viewport.outputWidth - left);
      if (partial) {
        out.save();
        out.beginPath();
        out.rect(left, top, width, height);
        out.clip();
        clearContext(out, viewport.outputWidth, viewport.outputHeight);
        if (options.checkerboard ?? true) drawDocumentCheckerboard(out, doc, fullFrame);
      }
      const expandedLeft = Math.max(0, left - overscan);
      const expandedTop = Math.max(0, top - overscan);
      const expandedRight = Math.min(viewport.outputWidth, left + width + overscan);
      const expandedBottom = Math.min(viewport.outputHeight, top + height + overscan);
      const expandedWidth = expandedRight - expandedLeft;
      const expandedHeight = expandedBottom - expandedTop;
      const frame: RenderFrame = {
        x: viewport.x + expandedLeft / scaleX,
        y: viewport.y + expandedTop / scaleY,
        width: expandedWidth / scaleX,
        height: expandedHeight / scaleY,
        outputWidth: expandedWidth,
        outputHeight: expandedHeight,
      };
      const composite = viewportTile(doc, frame, options, getPreparedLayers);
      out.drawImage(
        composite,
        left - expandedLeft,
        top - expandedTop,
        width,
        height,
        left,
        top,
        width,
        height,
      );
      if (partial) out.restore();
      renderedTiles += 1;
    }
  }

  if ((options.selectionOverlay ?? true) && doc.selection) drawProjectedSelection(out, doc, fullFrame);
  viewportTargetState.set(target, signature);
  const finishedAt = typeof performance === "undefined" ? Date.now() : performance.now();
  recordViewportRender({
    durationMs: Math.max(0, finishedAt - startedAt),
    renderedTiles,
    totalTiles,
    partial,
  });
}

/** Render only document pixels. UI chrome must never leak into files or batch output. */
export function renderClean(doc: Document, target: HTMLCanvasElement) {
  render(doc, target, { checkerboard: false, selectionOverlay: false, proofing: false });
}

function renderOverscanPixels(doc: Document, displayScale: number) {
  let extent = 2;
  for (const layer of doc.layers) {
    for (const filter of layer.filters ?? []) {
      if (!filter.enabled) continue;
      if (filter.kind === "blur" || filter.kind === "sharpen") {
        extent = Math.max(extent, (filter.params.radius ?? 8) * displayScale * 3);
      }
    }
    for (const effect of layer.effects ?? []) {
      if (!effect.enabled || effect.kind !== "drop-shadow") continue;
      extent = Math.max(
        extent,
        (effect.blur * 2 + Math.abs(effect.offsetX) + Math.abs(effect.offsetY)) * displayScale,
      );
    }
  }
  return Math.max(2, Math.min(96, Math.ceil(extent)));
}

function applySoftProof(ctx: CanvasRenderingContext2D, doc: Document, width: number, height: number) {
  const settings = doc.proofing;
  if (settings.profile === "none" && !settings.gamutWarning) return;
  const managedProof = settings.profile === "srgb" || settings.profile === "display-p3"
    ? createProofingTransform(
      SRGB_PROFILE,
      settings.profile === "display-p3" ? DISPLAY_P3_PROFILE : SRGB_PROFILE,
      SRGB_PROFILE,
      {
        renderingIntent: settings.intent,
        blackPointCompensation: settings.blackPointCompensation,
      },
    )
    : null;
  for (let y = 0; y < height; y += DEFAULT_TILE_SIZE) {
    for (let x = 0; x < width; x += DEFAULT_TILE_SIZE) {
      const tileWidth = Math.min(DEFAULT_TILE_SIZE, width - x);
      const tileHeight = Math.min(DEFAULT_TILE_SIZE, height - y);
      const image = ctx.getImageData(x, y, tileWidth, tileHeight);
      for (let offset = 0; offset < image.data.length; offset += 4) {
        if (image.data[offset + 3] === 0) continue;
        const alpha = image.data[offset + 3] / 255;
        const source = [
          image.data[offset] / 255,
          image.data[offset + 1] / 255,
          image.data[offset + 2] / 255,
        ] as [number, number, number];
        const managed = managedProof?.applyRgba([source[0], source[1], source[2], alpha]);
        const proof = managed ? {
          rgb: managed.rgba.slice(0, 3) as [number, number, number],
          outOfGamut: managed.outOfGamut,
        } : softProofDisplayRgb(source, settings.profile, settings.intent, settings.blackPointCompensation);
        if (settings.gamutWarning && proof.outOfGamut) {
          image.data[offset] = 255;
          image.data[offset + 1] = 0;
          image.data[offset + 2] = 255;
        } else if (settings.profile !== "none") {
          image.data[offset] = Math.round(proof.rgb[0] * 255);
          image.data[offset + 1] = Math.round(proof.rgb[1] * 255);
          image.data[offset + 2] = Math.round(proof.rgb[2] * 255);
        }
      }
      ctx.putImageData(image, x, y);
    }
  }
}

function drawContentLayer(
  composite: CanvasRenderingContext2D,
  scratchBuffers: Scratch,
  doc: Document,
  layer: Layer,
  frame: RenderFrame,
) {
  const { layerBuf, contentBuf, effectBuf, clipBuf } = scratchBuffers;
  const bctx = layerBuf.getContext("2d")!;
  const contentCtx = contentBuf.getContext("2d")!;
  clearContext(bctx, frame.outputWidth, frame.outputHeight);
  clearContext(contentCtx, frame.outputWidth, frame.outputHeight);

  drawLayerContentManaged(contentCtx, layer, frameTransform(frame));
  const scale = frameScale(frame);
  applySmartFilters(contentBuf, layer.filters, Math.sqrt(scale.x * scale.y));

  for (const effect of layer.effects ?? []) {
    if (!effect.enabled || effect.opacity <= 0 || effect.kind !== "drop-shadow") continue;
    const ectx = effectBuf.getContext("2d")!;
    clearContext(ectx, frame.outputWidth, frame.outputHeight);
    ectx.save();
    ectx.globalCompositeOperation = "source-over";
    ectx.globalAlpha = effect.opacity;
    ectx.shadowColor = effect.color;
    ectx.shadowBlur = effect.blur * Math.sqrt(scale.x * scale.y);
    ectx.shadowOffsetX = effect.offsetX * scale.x;
    ectx.shadowOffsetY = effect.offsetY * scale.y;
    ectx.drawImage(contentBuf, 0, 0);
    ectx.shadowColor = "transparent";
    ectx.globalCompositeOperation = "destination-out";
    ectx.globalAlpha = 1;
    ectx.drawImage(contentBuf, 0, 0);
    ectx.restore();
    bctx.drawImage(effectBuf, 0, 0);
  }
  bctx.globalAlpha = resolvedFillOpacity(layer);
  bctx.drawImage(contentBuf, 0, 0);
  bctx.globalAlpha = 1;

  if (layer.clipping) {
    const base = findClippingBase(doc, layer);
    if (base) {
      const clipCtx = clipBuf.getContext("2d")!;
      clearContext(clipCtx, frame.outputWidth, frame.outputHeight);
      drawLayerContentManaged(clipCtx, base, frameTransform(frame));
      bctx.globalCompositeOperation = "destination-in";
      bctx.drawImage(clipBuf, 0, 0);
      bctx.globalCompositeOperation = "source-over";
    }
  }
  if (layer.mask) {
    bctx.globalCompositeOperation = "destination-in";
    drawProjectedCanvas(bctx, layer.mask, frame);
    bctx.globalCompositeOperation = "source-over";
  }

  compositeBlendStack(composite, layerBuf, resolvedBlendPasses(layer), layer.opacity, resolvedBlendIf(layer));
}

function drawAdjustment(
  composite: CanvasRenderingContext2D,
  s: Scratch,
  layer: Layer,
  frame: RenderFrame,
) {
  if (!layer.tone) return;
  const snap = s.b;
  const sctx = snap.getContext("2d")!;
  clearContext(sctx, frame.outputWidth, frame.outputHeight);
  sctx.save();
  sctx.filter = toneToFilter(layer.tone);
  sctx.drawImage(composite.canvas, 0, 0);
  sctx.filter = "none";
  applyHighlightsShadows(sctx, frame.outputWidth, frame.outputHeight, layer.tone.highlights, layer.tone.shadows);
  sctx.restore();
  compositeAdjustment(composite, s, snap, layer, frame);
}

function drawPixelAdjustment(
  composite: CanvasRenderingContext2D,
  s: Scratch,
  layer: Layer,
  frame: RenderFrame,
  op: (img: ImageData) => ImageData,
) {
  const snap = s.b;
  const sctx = snap.getContext("2d")!;
  clearContext(sctx, frame.outputWidth, frame.outputHeight);
  sctx.drawImage(composite.canvas, 0, 0);
  const img = sctx.getImageData(0, 0, frame.outputWidth, frame.outputHeight);
  op(img);
  sctx.putImageData(img, 0, 0);
  compositeAdjustment(composite, s, snap, layer, frame);
}

function compositeAdjustment(
  composite: CanvasRenderingContext2D,
  s: Scratch,
  source: HTMLCanvasElement,
  layer: Layer,
  frame: RenderFrame,
) {
  let adjusted = source;
  if (layer.mask) {
    const bctx = s.layerBuf.getContext("2d")!;
    clearContext(bctx, frame.outputWidth, frame.outputHeight);
    bctx.drawImage(source, 0, 0);
    bctx.globalCompositeOperation = "destination-in";
    drawProjectedCanvas(bctx, layer.mask, frame);
    bctx.globalCompositeOperation = "source-over";
    adjusted = s.layerBuf;
  }
  compositeBlendStack(
    composite,
    adjusted,
    resolvedBlendPasses(layer),
    layer.opacity * resolvedFillOpacity(layer),
    resolvedBlendIf(layer),
  );
}

function drawDocumentCheckerboard(
  ctx: CanvasRenderingContext2D,
  doc: Document,
  frame: RenderFrame,
) {
  const scale = frameScale(frame);
  const left = -frame.x * scale.x;
  const top = -frame.y * scale.y;
  const width = doc.width * scale.x;
  const height = doc.height * scale.y;
  const tile = 16;
  ctx.save();
  ctx.beginPath();
  ctx.rect(left, top, width, height);
  ctx.clip();
  ctx.fillStyle = "#e9eaed";
  ctx.fillRect(left, top, width, height);
  ctx.fillStyle = "#dfe1e5";
  const firstX = Math.floor(left / tile) * tile;
  const firstY = Math.floor(top / tile) * tile;
  for (let y = firstY; y < top + height; y += tile) {
    for (let x = firstX; x < left + width; x += tile) {
      if (((Math.floor((x - left) / tile)) ^ Math.floor((y - top) / tile)) & 1) {
        ctx.fillRect(x, y, tile, tile);
      }
    }
  }
  ctx.restore();
}

function drawProjectedSelection(
  ctx: CanvasRenderingContext2D,
  doc: Document,
  frame: RenderFrame,
) {
  if (!doc.selection) return;
  const scale = frameScale(frame);
  const bounds = doc.selection.bounds;
  antsOffset = (antsOffset + 1) % 20;
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 4]);
  ctx.lineDashOffset = -antsOffset;
  ctx.strokeRect(
    (bounds.x - frame.x) * scale.x + 0.5,
    (bounds.y - frame.y) * scale.y + 0.5,
    Math.max(1, bounds.w * scale.x - 1),
    Math.max(1, bounds.h * scale.y - 1),
  );
  ctx.restore();
}
