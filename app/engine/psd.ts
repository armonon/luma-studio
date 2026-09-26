// Preservation-first PSD/PSB import/export via ag-psd. Native Luma equivalents
// remain editable; descriptors that Luma cannot edit are retained for round-trip
// and surfaced through an explicit compatibility report.
import { pathContours } from "./vector-path";
import { DEFAULT_BLACK_WHITE_MIX, gradientMapStops } from "./pro-adjustments";
import { decodePhotoshopRasterRows } from "./photoshop-channel-rows";
import { assertPhotoshopAlphaExport, readPhotoshopAlphaChannels, writePhotoshopAlphaChannels } from "./psd-alpha-channels";
import { getPhotoshopTileSource, registerPhotoshopTileSource, UnsupportedPhotoshopTileSource } from "./photoshop-tile-source";
import { sourceBackedPhotoshopChannels, assertSourceBackedExportBudget } from "./photoshop-source-export";
import type { PreparedSmartObject } from "./psd-smart-objects";

import type {
  Psd,
  Layer as PsdLayer,
  BlendMode as PsdBlend,
  LayerEffectsInfo,
  LayerTextData,
  LayerVectorMask,
  Justification,
  VectorContent,
  PixelData,
  LayerRawData,
} from "ag-psd";
import { decodeLayerPixels, readPsd, writeNative16BitRgbPsd, writePsd } from "./ag-psd-io";
import { exportHighDepthRgb, highDepthEligibility } from "./high-depth-psd";
import {
  BlendMode,
  BLEND_LABELS,
  BlendIf,
  BlendIfRange,
  Document,
  Layer,
  LayerEffect,
  NEUTRAL_TONE,
  type BevelStyle,
  type CurvePoints,
  TextStyle,
  createAdjustmentLayer,
  createCurvesLayer,
  createRasterLayer,
  createGroupLayer,
  createHslLayer,
  createLevelsLayer,
  createPathLayer,
  createProAdjustmentLayer,
  createTextLayer,
  drawLayerContent,
  paragraphCapHeight,
  affineForLayerTransform,
  newCanvas,
  resolvedBlendIf,
  resolvedFillOpacity,
  resolvedEffectBlendMode,
  resolvedGradientStops,
  resolvedBlendPasses,
} from "./document";
import {
  PhotoshopCompatibilityIssue,
  PhotoshopContainer,
  PhotoshopDecodeError,
  extractPhotoshopImageResources,
  getPhotoshopDocumentMetadata,
  getPhotoshopLayerMetadata,
  inspectPhotoshopHeader,
  mergePhotoshopImageResources,
  pathFingerprint,
  setPhotoshopDocumentMetadata,
  setPhotoshopLayerMetadata,
} from "./psd-metadata";
import { drawLayerContentManaged } from "./precision-renderer";
import {
  hasLayerMask,
  layerMaskSurface,
  setLayerMaskFromCanvas,
} from "./layer-mask";
import { SparseAlphaSurface } from "./alpha-surface";
import type { PixelRect } from "./tile-store";
import { PrecisionTileSurface } from "./tile-store";
import { displaySrgbToWorking, workingToDisplaySrgb } from "./color";
import { exceedsBrowserCanvas } from "./large-documents";
import {
  canvasFontForRun,
  normalizeTextRuns,
  resolvedDefaultTextStyle,
  resolvedTextStyleAt,
} from "./text-model";
import {
  assertSafePhotoshopDecodeBudget,
  estimatePhotoshopFlattenedDecodeBytes,
  inspectPhotoshopHeader as inspectPhotoshopInputHeader,
  PHOTOSHOP_DECODE_MEMORY_CEILING,
  planPhotoshopImport,
} from "./input-limits";

// ag-psd's blend-mode string is spec-compliant Photoshop, e.g. "soft light",
// "multiply". Map to our canvas GlobalCompositeOperation names.
const PSD_TO_BLEND: Record<string, BlendMode> = {
  "normal": "source-over",
  "dissolve": "dissolve",
  "darken": "darken",
  "multiply": "multiply",
  "color burn": "color-burn",
  "linear burn": "linear-burn",
  "darker color": "darker-color",
  "lighten": "lighten",
  "screen": "screen",
  "color dodge": "color-dodge",
  "linear dodge": "linear-dodge",
  "lighter color": "lighter-color",
  "overlay": "overlay",
  "soft light": "soft-light",
  "hard light": "hard-light",
  "vivid light": "vivid-light",
  "linear light": "linear-light",
  "pin light": "pin-light",
  "hard mix": "hard-mix",
  "difference": "difference",
  "exclusion": "exclusion",
  "subtract": "subtract",
  "divide": "divide",
  "hue": "hue",
  "saturation": "saturation",
  "color": "color",
  "luminosity": "luminosity",
};

const BLEND_TO_PSD: Record<BlendMode, PsdBlend> = {
  "source-over": "normal",
  "dissolve": "dissolve",
  "darken": "darken",
  "multiply": "multiply",
  "color-burn": "color burn",
  "linear-burn": "linear burn",
  "darker-color": "darker color",
  "lighten": "lighten",
  "screen": "screen",
  "color-dodge": "color dodge",
  "linear-dodge": "linear dodge",
  "lighter-color": "lighter color",
  "overlay": "overlay",
  "soft-light": "soft light",
  "hard-light": "hard light",
  "vivid-light": "vivid light",
  "linear-light": "linear light",
  "pin-light": "pin light",
  "hard-mix": "hard mix",
  "difference": "difference",
  "exclusion": "exclusion",
  "subtract": "subtract",
  "divide": "divide",
  "hue": "hue",
  "saturation": "saturation",
  "color": "color",
  "luminosity": "luminosity",
};

const PSD_NEUTRAL_RANGE = [0, 0, 255, 255];

function fromPsdRange(range: number[] | undefined): BlendIfRange {
  const values = range?.length === 4 ? range : PSD_NEUTRAL_RANGE;
  return {
    black: values[0] / 255,
    blackFeather: values[1] / 255,
    whiteFeather: values[2] / 255,
    white: values[3] / 255,
  };
}

function toPsdRange(range: BlendIfRange) {
  return [range.black, range.blackFeather, range.whiteFeather, range.white]
    .map((value) => Math.round(Math.max(0, Math.min(1, value)) * 255));
}

function isPsdNeutral(range: number[] | undefined) {
  return !range || range.length !== 4 || range.every((value, index) => value === PSD_NEUTRAL_RANGE[index]);
}

function blendIfFromPsd(layer: PsdLayer): BlendIf | undefined {
  const ranges = layer.blendingRanges;
  if (!ranges) return undefined;
  const graySource = ranges.compositeGrayBlendSource;
  const grayUnderlying = ranges.compositeGraphBlendDestinationRange;
  const channels = ["red", "green", "blue"] as const;
  const channelIndex = ranges.ranges.findIndex((range) => !isPsdNeutral(range.sourceRange) || !isPsdNeutral(range.destRange));
  const grayActive = !isPsdNeutral(graySource) || !isPsdNeutral(grayUnderlying);
  if (!grayActive && (channelIndex < 0 || channelIndex >= channels.length)) return undefined;
  const channelBand = (index: number) => ({
    source: fromPsdRange(ranges.ranges[index]?.sourceRange),
    underlying: fromPsdRange(ranges.ranges[index]?.destRange),
  });
  return {
    activeChannel: grayActive ? "gray" : channels[channelIndex],
    channels: {
      gray: { source: fromPsdRange(graySource), underlying: fromPsdRange(grayUnderlying) },
      red: channelBand(0),
      green: channelBand(1),
      blue: channelBand(2),
    },
  };
}

function blendIfToPsd(layer: Layer): NonNullable<PsdLayer["blendingRanges"]> {
  const settings = resolvedBlendIf(layer);
  const channels = (["red", "green", "blue"] as const).map((channel) => ({
    sourceRange: toPsdRange(settings.channels[channel].source),
    destRange: toPsdRange(settings.channels[channel].underlying),
  }));
  return {
    compositeGrayBlendSource: toPsdRange(settings.channels.gray.source),
    compositeGraphBlendDestinationRange: toPsdRange(settings.channels.gray.underlying),
    ranges: channels,
  };
}

function applyImportedLayerMetadata(target: Layer, source: PsdLayer, parentId?: string) {
  target.parentId = parentId;
  // ag-psd exposes layer opacity as a normalized 0..1 value on both read and
  // write. Keeping it normalized avoids turning an opaque high-depth import
  // into a 1/255-opacity layer on the next Luma export.
  target.opacity = Math.max(0, Math.min(1, source.opacity ?? 1));
  if (source.fillOpacity !== undefined) target.fillOpacity = source.fillOpacity;
  target.blendIf = blendIfFromPsd(source);
  // Photoshop lists the channels a layer may NOT affect; we store the ones it may.
  const restricted = new Set(source.channelBlendingRestrictions ?? []);
  if (restricted.size) {
    target.blendChannels = { r: !restricted.has(0), g: !restricted.has(1), b: !restricted.has(2) };
  }
  target.visible = !source.hidden;
  target.clipping = source.clipping;
  target.locked = !!source.protected?.composite;
  const blend = source.blendMode?.toLowerCase();
  if (blend && PSD_TO_BLEND[blend]) target.blend = PSD_TO_BLEND[blend];
  const effects = effectsFromPsd(target.id, source.effects);
  if (effects.length) target.effects = effects;
}

/** Photoshop's Choke/Spread is in pixels; ours is a fraction of the size. */
function chokeToSpread(choke: { value: number } | undefined, size: { value: number } | undefined) {
  const total = size?.value ?? 0;
  if (!choke?.value || total <= 0) return undefined;
  return Math.max(0, Math.min(1, choke.value / total));
}

function contourFromPsd(contour: { curve: Array<{ x: number; y: number }> } | undefined) {
  if (!contour?.curve?.length) return undefined;
  return contour.curve.map((point) => ({ x: point.x / 255, y: point.y / 255 }));
}

/**
 * Spread rather than assign: ag-psd walks its own keys, so `contour: undefined`
 * is a hole it tries to serialize, not an absent field.
 */
function contourToPsd(contour: CurvePoints | undefined) {
  if (!contour?.length) return {};
  return { contour: { name: "Luma contour", curve: contour.map((point) => ({ x: point.x * 255, y: point.y * 255 })) } };
}

const PSD_BEVEL_STYLE = {
  inner: "inner bevel",
  outer: "outer bevel",
  emboss: "emboss",
  pillow: "pillow emboss",
  stroke: "stroke emboss",
} as const;

const LUMA_BEVEL_STYLE: Record<string, BevelStyle> = {
  "inner bevel": "inner",
  "outer bevel": "outer",
  emboss: "emboss",
  "pillow emboss": "pillow",
  "stroke emboss": "stroke",
};

/** Photoshop stores a shadow as angle + distance; we store a pixel offset. */
function shadowOffset(effect: { angle?: number; distance?: { value: number } }) {
  const angle = (effect.angle ?? 45) * Math.PI / 180;
  const distance = effect.distance?.value ?? 10;
  return { offsetX: Math.cos(angle) * distance, offsetY: Math.sin(angle) * distance };
}

/**
 * Map a PSD layer's effects onto our six kinds.
 *
 * Kinds we have no renderer for (inner glow, satin, gradient and pattern
 * overlay) are deliberately not mapped: they survive the round trip as
 * preserved metadata instead of being flattened into something we would draw
 * wrong. See `mergedEffects`.
 */
function effectsFromPsd(layerId: string, source: PsdLayer["effects"]): LayerEffect[] {
  if (!source) return [];
  const effects: LayerEffect[] = [];
  const base = (
    kind: LayerEffect["kind"],
    index: number,
    source: { enabled?: boolean; opacity?: number; blendMode?: string; contour?: { curve: Array<{ x: number; y: number }> } },
  ) => ({
    id: `${layerId}-psd-${kind}-${index}`,
    kind,
    enabled: source.enabled !== false,
    opacity: source.opacity ?? 0.75,
    blur: 0,
    offsetX: 0,
    offsetY: 0,
    // Photoshop stores the effect's own blend mode; we used to invent one on
    // export and drop the file's on import.
    blendMode: source.blendMode ? PSD_TO_BLEND[source.blendMode.toLowerCase()] : undefined,
    contour: contourFromPsd(source.contour),
  });

  source.dropShadow?.forEach((effect, index) => effects.push({
    ...base("drop-shadow", index, effect),
    color: psdColorToCss(effect.color),
    blur: effect.size?.value ?? 12,
    spread: chokeToSpread(effect.choke, effect.size),
    ...shadowOffset(effect),
  }));

  source.innerShadow?.forEach((effect, index) => effects.push({
    ...base("inner-shadow", index, effect),
    color: psdColorToCss(effect.color),
    blur: effect.size?.value ?? 12,
    ...shadowOffset(effect),
  }));

  if (source.outerGlow) {
    effects.push({
      ...base("outer-glow", 0, source.outerGlow),
      color: psdColorToCss(source.outerGlow.color),
      blur: source.outerGlow.size?.value ?? 12,
    });
  }

  source.solidFill?.forEach((effect, index) => effects.push({
    ...base("color-overlay", index, { ...effect, opacity: effect.opacity ?? 1 }),
    color: psdColorToCss(effect.color),
  }));

  source.stroke?.forEach((effect, index) => effects.push({
    ...base("stroke", index, { ...effect, opacity: effect.opacity ?? 1 }),
    color: psdColorToCss(effect.color),
    width: effect.size?.value ?? 3,
    position: effect.position ?? "outside",
  }));

  if (source.innerGlow) {
    effects.push({
      ...base("inner-glow", 0, source.innerGlow),
      color: psdColorToCss(source.innerGlow.color),
      blur: source.innerGlow.size?.value ?? 12,
      glowSource: source.innerGlow.source === "center" ? "center" : "edge",
    });
  }

  if (source.satin) {
    effects.push({
      ...base("satin", 0, source.satin),
      color: psdColorToCss(source.satin.color),
      blur: source.satin.size?.value ?? 12,
      invert: !!source.satin.invert,
      ...shadowOffset(source.satin),
    });
  }

  source.gradientOverlay?.forEach((effect, index) => {
    const gradient = effect.gradient;
    const stops = gradient && gradient.type === "solid"
      ? gradient.colorStops.map((stop) => ({
        offset: Math.max(0, Math.min(1, stop.location)),
        color: psdColorToCss(stop.color),
      }))
      : undefined;
    effects.push({
      ...base("gradient-overlay", index, { ...effect, opacity: effect.opacity ?? 1 }),
      color: stops?.[0]?.color ?? "#000000",
      stops: stops?.length ? stops : undefined,
      gradientAngle: effect.angle ?? 90,
      gradientStyle: effect.type === "radial" ? "radial" : "linear",
      reverse: !!effect.reverse,
    });
  });

  if (source.bevel) {
    effects.push({
      ...base("bevel-emboss", 0, { ...source.bevel, opacity: source.bevel.highlightOpacity }),
      color: psdColorToCss(source.bevel.shadowColor),
      blur: source.bevel.soften?.value ?? 0,
      depth: source.bevel.size?.value ?? 3,
      angle: source.bevel.angle ?? 135,
      bevelStyle: LUMA_BEVEL_STYLE[source.bevel.style ?? "inner bevel"] ?? "inner",
      direction: source.bevel.direction === "down" ? "down" : "up",
      highlightColor: psdColorToCss(source.bevel.highlightColor ?? { r: 255, g: 255, b: 255 }),
      shadowColor: psdColorToCss(source.bevel.shadowColor ?? { r: 0, g: 0, b: 0 }),
    });
  }

  return effects;
}

/** Inverse of effectsFromPsd, for the kinds we own. */
/** Our blend mode in Photoshop's vocabulary, falling back to normal. */
function psdBlendMode(effect: LayerEffect) {
  return BLEND_TO_PSD[resolvedEffectBlendMode(effect)] ?? "normal";
}

function effectsToPsd(layer: Layer): Partial<LayerEffectsInfo> {
  const of = (kind: LayerEffect["kind"]) => (layer.effects ?? []).filter((effect) => effect.kind === kind);
  const px = (value: number) => ({ units: "Pixels" as const, value });
  const shadow = (effect: LayerEffect) => ({
    present: true,
    showInDialog: true,
    enabled: effect.enabled,
    size: px(effect.blur),
    angle: Math.atan2(effect.offsetY, effect.offsetX) * 180 / Math.PI,
    distance: px(Math.hypot(effect.offsetX, effect.offsetY)),
    color: cssColorToPsd(effect.color),
    blendMode: psdBlendMode(effect),
    opacity: effect.opacity,
    useGlobalLight: !!effect.useGlobalLight,
    choke: px((effect.spread ?? 0) * effect.blur),
    ...contourToPsd(effect.contour),
  });

  const glow = of("outer-glow")[0];
  const innerGlow = of("inner-glow")[0];
  const satin = of("satin")[0];
  const bevel = of("bevel-emboss")[0];
  const list = <T>(items: T[]) => items.length ? items : undefined;

  return {
    innerGlow: innerGlow && {
      present: true,
      showInDialog: true,
      enabled: innerGlow.enabled,
      size: px(innerGlow.blur),
      color: cssColorToPsd(innerGlow.color),
      blendMode: psdBlendMode(innerGlow),
      opacity: innerGlow.opacity,
      choke: px((innerGlow.spread ?? 0) * innerGlow.blur),
      noise: innerGlow.noise ?? 0,
      ...contourToPsd(innerGlow.contour),
      source: (innerGlow.glowSource ?? "edge") === "center" ? "center" as const : "edge" as const,
    },
    satin: satin && {
      present: true,
      showInDialog: true,
      enabled: satin.enabled,
      size: px(satin.blur),
      color: cssColorToPsd(satin.color),
      blendMode: psdBlendMode(satin),
      opacity: satin.opacity,
      ...contourToPsd(satin.contour),
      invert: !!satin.invert,
      angle: Math.atan2(satin.offsetY, satin.offsetX) * 180 / Math.PI,
      distance: px(Math.hypot(satin.offsetX, satin.offsetY)),
    },
    gradientOverlay: list(of("gradient-overlay").map((effect) => ({
      present: true,
      showInDialog: true,
      enabled: effect.enabled,
      opacity: effect.opacity,
      blendMode: "normal",
      angle: effect.gradientAngle ?? 90,
      type: (effect.gradientStyle ?? "linear") === "radial" ? "radial" as const : "linear" as const,
      reverse: !!effect.reverse,
      gradient: {
        name: "Luma gradient",
        type: "solid" as const,
        colorStops: resolvedGradientStops(effect).map((stop) => ({
          color: cssColorToPsd(stop.color),
          location: stop.offset,
          midpoint: .5,
        })),
        opacityStops: [
          { opacity: 1, location: 0, midpoint: .5 },
          { opacity: 1, location: 1, midpoint: .5 },
        ],
      },
    }))),
    dropShadow: list(of("drop-shadow").map(shadow)),
    innerShadow: list(of("inner-shadow").map(shadow)),
    outerGlow: glow && {
      present: true,
      showInDialog: true,
      enabled: glow.enabled,
      size: px(glow.blur),
      color: cssColorToPsd(glow.color),
      blendMode: psdBlendMode(glow),
      opacity: glow.opacity,
      choke: px((glow.spread ?? 0) * glow.blur),
      noise: glow.noise ?? 0,
      ...contourToPsd(glow.contour),
    },
    solidFill: list(of("color-overlay").map((effect) => ({
      present: true,
      showInDialog: true,
      enabled: effect.enabled,
      blendMode: psdBlendMode(effect),
      color: cssColorToPsd(effect.color),
      opacity: effect.opacity,
    }))),
    stroke: list(of("stroke").map((effect) => ({
      present: true,
      showInDialog: true,
      enabled: effect.enabled,
      size: px(effect.width ?? 3),
      position: effect.position ?? "outside",
      fillType: "color" as const,
      blendMode: psdBlendMode(effect),
      color: cssColorToPsd(effect.color),
      opacity: effect.opacity,
    }))),
    bevel: bevel && {
      present: true,
      showInDialog: true,
      enabled: bevel.enabled,
      size: px(bevel.depth ?? 3),
      soften: px(bevel.blur),
      angle: bevel.angle ?? 135,
      altitude: bevel.altitude ?? 30,
      style: PSD_BEVEL_STYLE[bevel.bevelStyle ?? "inner"],
      direction: (bevel.direction ?? "up") === "down" ? "down" as const : "up" as const,
      ...contourToPsd(bevel.contour),
      highlightColor: cssColorToPsd(bevel.highlightColor ?? "#ffffff"),
      shadowColor: cssColorToPsd(bevel.shadowColor ?? "#000000"),
      highlightOpacity: bevel.opacity,
      shadowOpacity: bevel.opacity,
      useGlobalLight: !!bevel.useGlobalLight,
    },
  };
}

function psdColorToCss(color: unknown) {
  const channels = color as { r?: number; g?: number; b?: number } | undefined;
  const component = (value: number | undefined) => Math.max(0, Math.min(255, Math.round(value ?? 0))).toString(16).padStart(2, "0");
  return `#${component(channels?.r)}${component(channels?.g)}${component(channels?.b)}`;
}

function cssColorToPsd(color: string) {
  const hex = /^#([0-9a-f]{6})$/i.exec(color)?.[1] ?? "ffffff";
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  };
}

function parseCanvasFont(font: string) {
  const size = Number(/([\d.]+)px/.exec(font)?.[1] ?? 16);
  const family = font.split(/\d+(?:\.\d+)?px\s+/)[1]?.split(",")[0]?.replace(/["']/g, "").trim() || "Arial";
  return {
    name: family.replace(/\s+/g, "") || "ArialMT",
    size,
    bold: /\b(?:bold|[6-9]00)\b/i.test(font),
    italic: /\bitalic\b/i.test(font),
  };
}

function textFingerprint(layer: Pick<Layer, "text" | "transform">) {
  return JSON.stringify({ text: layer.text, transform: layer.transform });
}

function effectsFingerprint(layer: Pick<Layer, "effects">) {
  return JSON.stringify(layer.effects ?? []);
}

function hashBytes(hash: number, bytes: ArrayLike<number>) {
  let next = hash >>> 0;
  for (let index = 0; index < bytes.length; index += 1) {
    next ^= bytes[index] & 0xff;
    next = Math.imul(next, 0x01000193) >>> 0;
  }
  return next;
}

function hashText(hash: number, value: string) {
  let next = hash >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    next = hashBytes(next, [code & 0xff, code >>> 8]);
  }
  return next;
}

function fingerprintResult(hash: number) {
  return hash.toString(16).padStart(8, "0");
}

/** Pixel fingerprint used only to prove an imported source is still untouched. */
function canvasFingerprint(canvas: HTMLCanvasElement | undefined) {
  if (!canvas) return undefined;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return "unreadable";
  let hash = hashText(0x811c9dc5, `${canvas.width}x${canvas.height}`);
  try {
    // Keep peak memory bounded even though legacy imported bitmaps are still
    // document-sized compatibility mirrors.
    const rows = 128;
    for (let y = 0; y < canvas.height; y += rows) {
      const height = Math.min(rows, canvas.height - y);
      hash = hashBytes(hash, context.getImageData(0, y, canvas.width, height).data);
    }
  } catch {
    return "unreadable";
  }
  return fingerprintResult(hash);
}

function precisionSurfaceFingerprint(surface: PrecisionTileSurface | undefined) {
  if (!surface) return undefined;
  let hash = hashText(
    0x811c9dc5,
    `${surface.grid.width}x${surface.grid.height}:${surface.format}:${surface.colorSpace}:${surface.grid.tileSize}`,
  );
  const source = surface.store.sourceState();
  if (source) {
    hash = hashText(hash, source.base.fingerprint);
    for (const key of source.deleted.sort()) hash = hashText(hash, `deleted:${key}`);
  }
  for (const { key, data } of [...surface.store.editEntries()].sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }))) {
    hash = hashText(hash, key);
    hash = hashBytes(hash, data);
  }
  return fingerprintResult(hash);
}

function alphaSurfaceFingerprint(surface: SparseAlphaSurface | undefined) {
  if (!surface) return undefined;
  let hash = hashText(0x811c9dc5, `${surface.width}x${surface.height}:${surface.tileSize}:${surface.defaultAlpha}`);
  for (const key of surface.keys().sort()) {
    const record = surface.record(key);
    hash = hashText(hash, key);
    hash = typeof record === "number" ? hashBytes(hash, [record]) : record ? hashBytes(hash, record) : hash;
  }
  return fingerprintResult(hash);
}

function layerMaskFingerprint(layer: Layer) {
  return alphaSurfaceFingerprint(layer.maskSurface) ?? canvasFingerprint(layer.mask);
}

function layerPixelFingerprint(layer: Layer) {
  return precisionSurfaceFingerprint(layer.surface) ?? canvasFingerprint(layer.bitmap);
}

function layerStateFingerprint(layer: Layer) {
  return JSON.stringify({
    name: layer.name,
    kind: layer.kind,
    visible: layer.visible,
    opacity: layer.opacity,
    fillOpacity: layer.fillOpacity,
    blend: layer.blend,
    blendStack: layer.blendStack,
    blendIf: layer.blendIf,
    transform: layer.transform,
    locked: layer.locked,
    clipping: layer.clipping,
    filters: layer.filters,
    effects: layer.effects,
    tone: layer.tone,
    curves: layer.curves,
    levels: layer.levels,
    hsl: layer.hsl,
    text: layer.text,
    shape: layer.shape,
    path: layer.path,
  });
}

function documentStateFingerprint(doc: Document) {
  return JSON.stringify({
    width: doc.width,
    height: doc.height,
    colorSpace: doc.colorSpace,
    bitDepth: doc.bitDepth,
    resolution: doc.resolution,
    guides: doc.guides.map(({ orientation, position }) => ({ orientation, position })),
    proofing: doc.proofing,
    alphaChannels: doc.alphaChannels?.map(channel => ({ id: channel.id, name: channel.name, pixels: alphaSurfaceFingerprint(channel.surface) })),
  });
}

function psdVectorColor(content: VectorContent | undefined, fallback: string) {
  return content?.type === "color" ? psdColorToCss(content.color) : fallback;
}

function unitPixels(value: { value: number; units: string } | undefined, resolution = 72, fallback = 0) {
  if (!value || !Number.isFinite(value.value)) return fallback;
  if (value.units === "Points" || value.units === "Picas") {
    const points = value.units === "Picas" ? value.value * 12 : value.value;
    return points * resolution / 72;
  }
  if (value.units === "Inches") return value.value * resolution;
  if (value.units === "Centimeters") return value.value * resolution / 2.54;
  if (value.units === "Millimeters") return value.value * resolution / 25.4;
  return value.value;
}

function editablePathFromPsd(layer: PsdLayer) {
  const paths = layer.vectorMask?.paths;
  if (!paths || paths.length !== 1 || paths[0].knots.length < 2) return null;
  if (layer.vectorFill && layer.vectorFill.type !== "color") return null;
  if (layer.vectorStroke?.strokeEnabled && layer.vectorStroke.content?.type !== "color") return null;
  const path = paths[0];
  const fill = psdVectorColor(layer.vectorFill, "none");
  const stroke = layer.vectorStroke?.strokeEnabled
    ? psdVectorColor(layer.vectorStroke.content, "#000000")
    : "none";
  return {
    anchors: path.knots.map((knot) => {
      const [inX, inY, x, y, outX, outY] = knot.points;
      return {
        x,
        y,
        hIn: { dx: inX - x, dy: inY - y },
        hOut: { dx: outX - x, dy: outY - y },
      };
    }),
    closed: !path.open,
    fill,
    stroke,
    strokeWidth: layer.vectorStroke?.strokeEnabled
      ? unitPixels(layer.vectorStroke.lineWidth, layer.vectorStroke.resolution ?? 72, 1)
      : 0,
  };
}

function canvasPoint(layer: Layer, x: number, y: number): [number, number] {
  const t = affineForLayerTransform(layer.transform);
  return [
    t.a * x + t.c * y + t.e,
    t.b * x + t.d * y + t.f,
  ];
}

function pathToPsdMask(layer: Layer): LayerVectorMask | undefined {
  if (!layer.path || layer.path.anchors.length < 2) return undefined;
  return {
    paths: pathContours(layer.path).filter(contour => contour.anchors.length >= 2).map(contour => ({
      open: !contour.closed,
      fillRule: layer.path!.fillRule === "evenodd" ? "even-odd" as const : "non-zero" as const,
      operation: "combine",
      knots: contour.anchors.map((anchor) => {
        const incoming = canvasPoint(layer, anchor.x + anchor.hIn.dx, anchor.y + anchor.hIn.dy);
        const point = canvasPoint(layer, anchor.x, anchor.y);
        const outgoing = canvasPoint(layer, anchor.x + anchor.hOut.dx, anchor.y + anchor.hOut.dy);
        return { linked: false, points: [...incoming, ...point, ...outgoing] };
      }),
    })),
  };
}

function shapeToPsdMask(layer: Layer): LayerVectorMask | undefined {
  const shape = layer.shape;
  if (!shape) return undefined;
  if (shape.kind === "ellipse") {
    const cx = shape.x + shape.w / 2;
    const cy = shape.y + shape.h / 2;
    const rx = Math.abs(shape.w) / 2;
    const ry = Math.abs(shape.h) / 2;
    const k = 0.5522847498307936;
    const anchors = [
      { x: cx, y: cy - ry, inX: cx - k * rx, inY: cy - ry, outX: cx + k * rx, outY: cy - ry },
      { x: cx + rx, y: cy, inX: cx + rx, inY: cy - k * ry, outX: cx + rx, outY: cy + k * ry },
      { x: cx, y: cy + ry, inX: cx + k * rx, inY: cy + ry, outX: cx - k * rx, outY: cy + ry },
      { x: cx - rx, y: cy, inX: cx - rx, inY: cy + k * ry, outX: cx - rx, outY: cy - k * ry },
    ];
    return {
      paths: [{
        open: false,
        fillRule: "non-zero",
        operation: "combine",
        knots: anchors.map((anchor) => ({
          linked: true,
          points: [
            ...canvasPoint(layer, anchor.inX, anchor.inY),
            ...canvasPoint(layer, anchor.x, anchor.y),
            ...canvasPoint(layer, anchor.outX, anchor.outY),
          ],
        })),
      }],
    };
  }
  const left = Math.min(shape.x, shape.x + shape.w);
  const top = Math.min(shape.y, shape.y + shape.h);
  const right = Math.max(shape.x, shape.x + shape.w);
  const bottom = Math.max(shape.y, shape.y + shape.h);
  const radius = Math.max(0, Math.min(shape.radius, (right - left) / 2, (bottom - top) / 2));
  const k = 0.5522847498307936;
  const corners = radius > 0 ? [
    { x: left + radius, y: top, inX: left + radius - k * radius, inY: top, outX: left + radius, outY: top },
    { x: right - radius, y: top, inX: right - radius, inY: top, outX: right - radius + k * radius, outY: top },
    { x: right, y: top + radius, inX: right, inY: top + radius - k * radius, outX: right, outY: top + radius },
    { x: right, y: bottom - radius, inX: right, inY: bottom - radius, outX: right, outY: bottom - radius + k * radius },
    { x: right - radius, y: bottom, inX: right - radius + k * radius, inY: bottom, outX: right - radius, outY: bottom },
    { x: left + radius, y: bottom, inX: left + radius, inY: bottom, outX: left + radius - k * radius, outY: bottom },
    { x: left, y: bottom - radius, inX: left, inY: bottom - radius + k * radius, outX: left, outY: bottom - radius },
    { x: left, y: top + radius, inX: left, inY: top + radius, outX: left, outY: top + radius - k * radius },
  ] : [
    { x: left, y: top, inX: left, inY: top, outX: left, outY: top },
    { x: right, y: top, inX: right, inY: top, outX: right, outY: top },
    { x: right, y: bottom, inX: right, inY: bottom, outX: right, outY: bottom },
    { x: left, y: bottom, inX: left, inY: bottom, outX: left, outY: bottom },
  ];
  return {
    paths: [{
      open: false,
      fillRule: "non-zero",
      operation: "combine",
      knots: corners.map((corner) => {
        const incoming = canvasPoint(layer, corner.inX, corner.inY);
        const point = canvasPoint(layer, corner.x, corner.y);
        const outgoing = canvasPoint(layer, corner.outX, corner.outY);
        return { linked: true, points: [...incoming, ...point, ...outgoing] };
      }),
    }],
  };
}

function vectorFill(color: string): VectorContent | undefined {
  return color && color !== "none" ? { type: "color", color: cssColorToPsd(color) } : undefined;
}

function vectorStroke(color: string, width: number): PsdLayer["vectorStroke"] {
  if (!color || color === "none" || width <= 0) return undefined;
  return {
    strokeEnabled: true,
    fillEnabled: true,
    lineWidth: { units: "Pixels", value: width },
    lineCapType: "round",
    lineJoinType: "round",
    lineAlignment: "center",
    opacity: 1,
    content: { type: "color", color: cssColorToPsd(color) },
    resolution: 72,
  };
}

function normalizedPixelValue(value: number, depth: number) {
  return depth === 16 ? value / 65535 : depth === 8 ? value / 255 : value;
}

function applyImportedMask(target: Layer, source: PsdLayer, doc: Pick<Document, "width" | "height" | "bitDepth">) {
  if ((!source.mask?.canvas && !source.mask?.imageData) || source.mask.disabled) return;
  const left = source.mask.left ?? 0;
  const top = source.mask.top ?? 0;
  const defaultAlpha = source.mask.defaultColor ?? 255;
  if (source.mask.canvas) {
    setLayerMaskFromCanvas(target, source.mask.canvas, doc.width, doc.height, left, top, defaultAlpha);
  } else if (source.mask.imageData) {
    const sourceData = source.mask.imageData;
    const surface = new SparseAlphaSurface(doc.width, doc.height, { defaultAlpha });
    for (const address of surface.grid.tilesIntersecting({ x: left, y: top, width: sourceData.width, height: sourceData.height })) {
      const alpha = surface.readTile(address.key);
      const x0 = Math.max(left, address.x), y0 = Math.max(top, address.y);
      const x1 = Math.min(left + sourceData.width, address.x + address.width);
      const y1 = Math.min(top + sourceData.height, address.y + address.height);
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const sample = sourceData.data[((y - top) * sourceData.width + x - left) * 4];
        alpha[(y - address.y) * address.width + x - address.x] = Math.round(Math.max(0, Math.min(1, normalizedPixelValue(sample, doc.bitDepth))) * 255);
      }
      surface.writeTile(address.key, alpha);
    }
    target.mask = undefined;
    target.maskSurface = surface;
  }
}

export function precisionSurfaceFromPsdPixels(
  pixels: PixelData,
  doc: Document,
  left: number,
  top: number,
) {
  return precisionSurfaceFromPsdPixelsInBounds(pixels, doc, doc.width, doc.height, left, top);
}

function precisionSurfaceFromPsdPixelsInBounds(
  pixels: PixelData,
  doc: Document,
  width: number,
  height: number,
  left: number,
  top: number,
) {
  const surface = new PrecisionTileSurface(
    width,
    height,
    doc.bitDepth === 32 ? "rgba32f" : doc.bitDepth === 16 ? "rgba16f" : "rgba8",
    doc.colorSpace,
  );
  const working = new Float32Array(pixels.width * pixels.height * 4);
  for (let pixel = 0; pixel < pixels.width * pixels.height; pixel += 1) {
    const offset = pixel * 4;
    const alpha = normalizedPixelValue(pixels.data[offset + 3], doc.bitDepth);
    const sourceRgb = [
      normalizedPixelValue(pixels.data[offset], doc.bitDepth),
      normalizedPixelValue(pixels.data[offset + 1], doc.bitDepth),
      normalizedPixelValue(pixels.data[offset + 2], doc.bitDepth),
    ] as [number, number, number];
    const rgb = doc.bitDepth === 32 ? sourceRgb : displaySrgbToWorking(sourceRgb, doc.colorSpace);
    working.set([rgb[0], rgb[1], rgb[2], alpha], offset);
  }
  surface.updateFromWorkingFloat32({ width: pixels.width, height: pixels.height, data: working }, left, top);
  return surface;
}

function drawPrecisionPreview(target: HTMLCanvasElement, surface: PrecisionTileSurface) {
  const context = target.getContext("2d")!;
  for (const key of surface.store.keys()) {
    const tile = surface.grid.parseKey(key);
    const preview = surface.tileToRgba8(key);
    const image = context.createImageData(preview.width, preview.height);
    image.data.set(preview.data);
    context.putImageData(image, tile.x, tile.y);
  }
}

/** Fold Luma's separate alignment and justify flag back into one PSD value. */
function psdJustification(style: TextStyle): Justification {
  const align = style.align === "right" ? "right" : style.align === "center" ? "center" : "left";
  return style.justify ? (`justify-${align}` as Justification) : align;
}

function importedTextStyle(layer: PsdLayer): TextStyle {
  const text = layer.text!;
  const firstStyle = { ...(text.style ?? {}), ...(text.styleRuns?.[0]?.style ?? {}) };
  const firstParagraph = { ...(text.paragraphStyle ?? {}), ...(text.paragraphStyleRuns?.[0]?.style ?? {}) };
  const size = firstStyle.fontSize ?? 16;
  const family = firstStyle.font?.name ?? "Arial";
  const weight = firstStyle.fauxBold ? "700" : "400";
  const italic = firstStyle.fauxItalic ? "italic " : "";
  // Photoshop's justification is alignment and justification in one value:
  // "justify-center" means justified, with the last line centred. Splitting it
  // apart is what lets both survive the trip in.
  const align = firstParagraph.justification ?? "left";
  const lastLine = align.startsWith("justify-") ? align.slice("justify-".length) : align;
  const box = text.shapeType === "box" ? text.boxBounds : undefined;
  if (text.shapeType === "box" && (!box || box.length !== 4 || !box.every(Number.isFinite) ||
    box[2] <= box[0] || box[3] <= box[1] || box[2] - box[0] > 100_000 || box[3] - box[1] > 100_000)) {
    throw new Error(`${layer.name || "Text"}: the Photoshop paragraph frame is invalid or exceeds 100,000 pixels`);
  }
  let paragraphOffset = 0;
  const paragraphRuns = text.paragraphStyleRuns?.length ? text.paragraphStyleRuns : [{ length: text.text.length, style: firstParagraph }];
  const paragraphs = paragraphRuns.map(source => {
    const paragraph = { ...(text.paragraphStyle ?? {}), ...source.style };
    const start = paragraphOffset; paragraphOffset += source.length;
    const justification = paragraph.justification ?? "left";
    return { start, end: Math.min(text.text.length, paragraphOffset), style: {
      align: (justification.startsWith("justify") ? "justify" : justification === "center" ? "center" : justification === "right" ? "right" : "left") as "left" | "center" | "right" | "justify",
      firstLineIndent: paragraph.firstLineIndent ?? 0, startIndent: paragraph.startIndent ?? 0,
      endIndent: paragraph.endIndent ?? 0, spaceBefore: paragraph.spaceBefore ?? 0,
      spaceAfter: paragraph.spaceAfter ?? 0,
    } };
  }).filter(run => run.end > run.start);
  let runOffset = 0;
  const runs = (text.styleRuns ?? []).map((source) => {
    const sourceStyle = { ...(text.style ?? {}), ...source.style };
    const start = runOffset;
    runOffset += source.length;
    return {
      start,
      end: Math.min(text.text.length, runOffset),
      style: {
        fontFamily: sourceStyle.font?.name ?? family,
        fontSize: sourceStyle.fontSize ?? size,
        fontWeight: sourceStyle.fauxBold ? 700 : 400,
        fontStyle: sourceStyle.fauxItalic ? "italic" as const : "normal" as const,
        fontStretch: (sourceStyle.horizontalScale ?? 1) * 100,
        color: psdColorToCss(sourceStyle.fillColor),
        tracking: sourceStyle.tracking ?? 0,
        baselineShift: sourceStyle.baselineShift ?? 0,
        decoration: sourceStyle.underline ? "underline" as const : sourceStyle.strikethrough ? "line-through" as const : "none" as const,
        features: { liga: sourceStyle.ligatures !== false, kern: sourceStyle.autoKerning !== false },
        axes: {
          wght: sourceStyle.fauxBold ? 700 : 400,
          opsz: sourceStyle.fontSize ?? size,
        },
      },
    };
  }).filter((run) => run.end > run.start);
  return {
    schemaVersion: 2,
    text: text.text,
    font: `${italic}${weight} ${size}px ${family}, sans-serif`,
    color: psdColorToCss(firstStyle.fillColor),
    align: lastLine === "right" ? "right" : lastLine === "center" ? "center" : "left",
    // Photoshop retains a manual placeholder (sometimes 0.01) even while
    // automatic leading is enabled. Only the selected mode is authoritative.
    lineHeight: firstStyle.autoLeading ? firstParagraph.autoLeading ?? 1.2
      : firstStyle.leading ? firstStyle.leading / size : 1.2,
    // Photoshop measures tracking in thousandths of an em, which is the unit
    // TextStyle.tracking already uses, so it carries across unconverted.
    tracking: firstStyle.tracking,
    paragraphSpacing: firstParagraph.spaceAfter ? firstParagraph.spaceAfter / size : undefined,
    justify: align.startsWith("justify") || undefined,
    x: box ? box[0] + (lastLine === "center" ? (box[2] - box[0]) / 2 : lastLine === "right" ? box[2] - box[0] : 0) : 0,
    y: box?.[1] ?? 0,
    ...(box ? { layout: "paragraph" as const, frameOrigin: "top" as const, boxWidth: box[2] - box[0], boxHeight: box[3] - box[1] } : {}),
    ...(box || text.paragraphStyleRuns?.length || paragraphs.some(run => run.style.firstLineIndent || run.style.startIndent || run.style.endIndent || run.style.spaceBefore)
      ? { paragraphs } : {}),
    direction: "auto",
    writingMode: text.orientation === "vertical" ? "vertical-rl" : "horizontal-tb",
    defaultStyle: {
      fontFamily: family,
      fontSize: size,
      fontWeight: firstStyle.fauxBold ? 700 : 400,
      fontStyle: firstStyle.fauxItalic ? "italic" : "normal",
      fontStretch: (firstStyle.horizontalScale ?? 1) * 100,
      color: psdColorToCss(firstStyle.fillColor),
      tracking: firstStyle.tracking ?? 0,
      baselineShift: firstStyle.baselineShift ?? 0,
      decoration: firstStyle.underline ? "underline" : firstStyle.strikethrough ? "line-through" : "none",
      features: { liga: firstStyle.ligatures !== false, kern: firstStyle.autoKerning !== false },
      // Photoshop horizontalScale stretches geometry; mapping it to a font
      // variation axis as well would apply width twice during outlining.
      axes: { wght: firstStyle.fauxBold ? 700 : 400, opsz: size },
    },
    runs: runs.length > 1 ? runs : undefined,
  };
}

function importedAdjustment(layer: PsdLayer) {
  const adjustment = layer.adjustment;
  if (!adjustment) return null;
  if (adjustment.type === "levels") {
    const rgb = adjustment.rgb;
    return createLevelsLayer(layer.name || "Levels", rgb ? {
      inBlack: rgb.shadowInput / 255,
      inWhite: rgb.highlightInput / 255,
      gamma: rgb.midtoneInput,
      outBlack: rgb.shadowOutput / 255,
      outWhite: rgb.highlightOutput / 255,
    } : undefined);
  }
  if (adjustment.type === "curves") {
    const points = (channel: typeof adjustment.rgb) => channel?.length
      ? channel.map((point) => ({ x: point.input / 255, y: point.output / 255 }))
      : [{ x: 0, y: 0 }, { x: 1, y: 1 }];
    return createCurvesLayer(layer.name || "Curves", {
      rgb: points(adjustment.rgb),
      r: points(adjustment.red),
      g: points(adjustment.green),
      b: points(adjustment.blue),
    });
  }
  if (adjustment.type === "hue/saturation") {
    return createHslLayer(layer.name || "Hue/Saturation", {
      hue: adjustment.master?.hue ?? 0,
      saturation: adjustment.master?.saturation ?? 0,
      lightness: adjustment.master?.lightness ?? 0,
    });
  }
  if (adjustment.type === "brightness/contrast" || adjustment.type === "exposure" || adjustment.type === "vibrance") {
    return createAdjustmentLayer(layer.name || "Tone", {
      ...NEUTRAL_TONE,
      exposure: adjustment.type === "exposure" ? adjustment.exposure ?? 0 : 0,
      contrast: adjustment.type === "brightness/contrast" ? adjustment.contrast ?? 0 : 0,
      highlights: adjustment.type === "brightness/contrast" ? adjustment.brightness ?? 0 : 0,
      vibrance: adjustment.type === "vibrance" ? adjustment.vibrance ?? 0 : 0,
    });
  }
  if (adjustment.type === "black & white") {
    return createProAdjustmentLayer(layer.name || "Black & White", {
      kind: "black-white",
      amount: 1,
      tint: psdColorToCss(adjustment.tintColor),
      tintAmount: adjustment.useTint ? 1 : 0,
      colorMix: [adjustment.reds ?? 40, adjustment.yellows ?? 60, adjustment.greens ?? 40,
        adjustment.cyans ?? 60, adjustment.blues ?? 20, adjustment.magentas ?? 80].map((v) => Math.max(-200, Math.min(300, v))) as [number, number, number, number, number, number],
    });
  }
  if (adjustment.type === "color balance") {
    const values = (value: typeof adjustment.shadows): [number, number, number] => [
      (value?.cyanRed ?? 0) / 100,
      (value?.magentaGreen ?? 0) / 100,
      (value?.yellowBlue ?? 0) / 100,
    ];
    return createProAdjustmentLayer(layer.name || "Color Balance", {
      kind: "color-balance",
      shadows: values(adjustment.shadows),
      midtones: values(adjustment.midtones),
      highlights: values(adjustment.highlights),
      preserveLuminosity: adjustment.preserveLuminosity ?? true,
    });
  }
  if (adjustment.type === "photo filter") {
    return createProAdjustmentLayer(layer.name || "Photo Filter", {
      kind: "photo-filter",
      color: psdColorToCss(adjustment.color),
      density: (adjustment.density ?? 25) / 100,
      preserveLuminosity: adjustment.preserveLuminosity ?? true,
    });
  }
  if (adjustment.type === "channel mixer") {
    const values = (value: typeof adjustment.red, fallback: [number, number, number, number]) => [
      (value?.red ?? fallback[0]) / 100,
      (value?.green ?? fallback[1]) / 100,
      (value?.blue ?? fallback[2]) / 100,
      (value?.constant ?? fallback[3]) / 100,
    ] as const;
    return createProAdjustmentLayer(layer.name || "Channel Mixer", {
      kind: "channel-mixer",
      matrix: [
        ...values(adjustment.red, [100, 0, 0, 0]),
        ...values(adjustment.green, [0, 100, 0, 0]),
        ...values(adjustment.blue, [0, 0, 100, 0]),
      ],
    });
  }
  if (adjustment.type === "gradient map") {
    const stops = [...(adjustment.colorStops ?? [])].sort((a, b) => a.location - b.location);
    return createProAdjustmentLayer(layer.name || "Gradient Map", {
      kind: "gradient-map",
      shadow: psdColorToCss(stops[0]?.color),
      highlight: psdColorToCss(stops.at(-1)?.color),
      reverse: adjustment.reverse ?? false,
      smoothness: Math.max(0, Math.min(1, (adjustment.smoothness ?? 4096) / 4096)),
      ...(stops.length >= 2 && stops.length <= 16 ? { stops: stops.map((s) => ({ position: Math.max(0, Math.min(1, s.location / 4096)), color: psdColorToCss(s.color) })) } : {}),
    });
  }
  if (adjustment.type === "threshold") {
    return createProAdjustmentLayer(layer.name || "Threshold", { kind: "threshold", level: (adjustment.level ?? 128) / 255 });
  }
  if (adjustment.type === "posterize") {
    return createProAdjustmentLayer(layer.name || "Posterize", { kind: "posterize", levels: adjustment.levels ?? 4 });
  }
  if (adjustment.type === "invert") {
    return createProAdjustmentLayer(layer.name || "Invert", { kind: "invert" });
  }
  return null;
}

export type PhotoshopImportOptions = {
  /** Auto preserves layers when bounded and otherwise opens the composite safely. */
  mode?: "auto" | "layered" | "flattened";
  /** Override automatic source-backed selection for qualification. */
  sourceBacked?: boolean;
};

function displayImageData(context: CanvasRenderingContext2D, pixels: PixelData): ImageData {
  if (typeof ImageData !== "undefined") {
    const data = pixels.data;
    return new ImageData(new Uint8ClampedArray(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength), pixels.width, pixels.height);
  }
  // DOM-optional canvas adapters may expose createImageData but no constructor.
  const image = context.createImageData(pixels.width, pixels.height);
  image.data.set(pixels.data as Uint8ClampedArray);
  return image;
}

export async function importPsd(buffer: ArrayBuffer, options: PhotoshopImportOptions = {}): Promise<Document> {
  const inputHeader = inspectPhotoshopInputHeader(buffer);
  const requestedMode = options.mode ?? "auto";
  const sourceBacked = options.sourceBacked === true;
  const sourceEligible = inputHeader.depth === 8 && inputHeader.colorMode === 3 && inputHeader.layers > 0 && inputHeader.layers <= 4096 && inputHeader.largestLayerPixels !== undefined && buffer.byteLength + 192 * 1024 * 1024 <= 512 * 1024 * 1024;
  if (sourceBacked && !sourceEligible) throw new Error("Photoshop source-backed import exceeds its format or memory boundary");
  const importMode = sourceBacked ? "layered" : requestedMode === "auto"
    ? planPhotoshopImport(inputHeader, buffer.byteLength).mode
    : requestedMode;
  if (options.sourceBacked === undefined && requestedMode === "auto" && importMode === "flattened" && sourceEligible) {
    try { return await importPsd(buffer, { mode: "layered", sourceBacked: true }); }
    catch (error) {
      if (!(error instanceof UnsupportedPhotoshopTileSource)) throw error;
      return importPsd(buffer, { mode: "flattened" });
    }
  }
  if (importMode === "layered" && !sourceBacked) {
    assertSafePhotoshopDecodeBudget(inputHeader, buffer.byteLength);
  } else if (importMode !== "layered") {
    const estimated = estimatePhotoshopFlattenedDecodeBytes(inputHeader, buffer.byteLength);
    if (!Number.isSafeInteger(estimated) || estimated > PHOTOSHOP_DECODE_MEMORY_CEILING) {
      throw new Error(
        `Even a flattened Photoshop decode would require approximately ${Math.ceil(estimated / 1024 / 1024)} MB; `
        + `the safe import ceiling is ${Math.floor(PHOTOSHOP_DECODE_MEMORY_CEILING / 1024 / 1024)} MB.`,
      );
    }
  }
  const flattenedFallback = importMode === "flattened" && inputHeader.layers > 0;
  const serialPixels = inputHeader.depth === 8 && inputHeader.colorMode === 3 && inputHeader.largestLayerPixels !== undefined && !flattenedFallback;
  const header = inspectPhotoshopHeader(buffer);
  if (header.channels < 1 || header.channels > 56 || header.width < 1 || header.height < 1 ||
      header.width > 300_000 || header.height > 300_000 || ![1, 8, 16, 32].includes(header.bitsPerChannel) ||
      ![0, 1, 2, 3, 4, 7, 8, 9].includes(header.colorMode) || exceedsBrowserCanvas(header.width, header.height)) {
    throw new PhotoshopDecodeError(header, new Error("Photoshop document exceeds the safe import limits"));
  }
  // ag-psd endian-swaps 16/32-bit raw channels in place while decoding. Keep
  // both the caller's bytes and our preservation source immutable.
  const originalSource = new Uint8Array(buffer.slice(0));
  let psd: Psd;
  try {
    const decode = (skipCompositeImageData: boolean, skipLayerImageData = false) => readPsd(header.bitsPerChannel <= 8 ? originalSource.buffer : buffer.slice(0), {
      skipLayerImageData,
      skipCompositeImageData,
      skipThumbnail: sourceBacked,
      // Preserve embedded smart-object bytes for editable imports. A bounded
      // composite fallback keeps the complete original container instead, so
      // decoding duplicate linked payloads would only spend memory on content
      // that is not exposed as an editable layer.
      skipLinkedFilesData: flattenedFallback,
      totalMemoryLimit: sourceBacked ? 64 * 1024 * 1024 : PHOTOSHOP_DECODE_MEMORY_CEILING,
      throwForMissingFeatures: false,
      logMissingFeatures: false,
      useImageData: true,
      useRawData: serialPixels && !skipLayerImageData,
    });
    const compositeOnly = inputHeader.layers === 0;
    psd = flattenedFallback || compositeOnly ? decode(false, true) : decode(true);
    // A flattened PSD has no layer records; its only artwork is the composite.
    // Decode that payload only for this case so layered documents keep the
    // lower-memory path and do not hold a redundant full-document image.
    if (!flattenedFallback && !compositeOnly && !(psd.children?.length) && !psd.imageData && !psd.canvas) psd = decode(false, true);
  } catch (error) {
    throw new PhotoshopDecodeError(header, error);
  }
  const importedIssues: PhotoshopCompatibilityIssue[] = [];
  if (sourceBacked) importedIssues.push({
    code: "RGB8_SOURCE_BACKED_MASTER", severity: "info",
    message: "Raster layers decode tiles on demand from the shared compressed source. Local edits use bounded tile history; source bytes remain in memory. Unsupported dense operations fail safely.",
  });
  if (header.container === "psb") {
    importedIssues.push({
      code: "PSB_IMPORTED",
      severity: "info",
      message: "Large Document Format structure was imported; choose PSB explicitly when exporting to retain that container.",
    });
  }
  if (flattenedFallback) {
    importedIssues.push({
      code: "LAYERED_COMPOSITE_FALLBACK",
      severity: "warning",
      message: `The editable ${inputHeader.layers}-record stack would exceed Luma's import or native-project restore memory ceiling, so this document opened from its flattened composite. The original source remains preserved until the preview is edited.`,
    });
  }
  if (![8, 16, 32].includes(header.bitsPerChannel)) {
    importedIssues.push({
      code: "UNSUPPORTED_SOURCE_DEPTH",
      severity: "warning",
      message: `The ${header.bitsPerChannel}-bit source was decoded as an 8-bit compatibility preview.`,
    });
  } else if (header.bitsPerChannel !== 8) {
    importedIssues.push({
      code: "HIGH_DEPTH_LAYER_MASTER",
      severity: "info",
      message: `The ${header.bitsPerChannel}-bit layer channels are decoded into Luma precision-tile masters; the canvas is only a display preview.`,
    });
  }
  if (header.colorMode !== 3) { // PSD color-mode code 3 = RGB.
    importedIssues.push({
      code: "SOURCE_COLOR_MODE_CONVERTED",
      severity: "warning",
      message: "The source color mode is retained as metadata, but its editable preview is converted to Luma's RGB working space.",
    });
  }
  const doc: Document = {
    width: psd.width,
    height: psd.height,
    colorSpace: "srgb",
    bitDepth: header.bitsPerChannel === 16 || header.bitsPerChannel === 32 ? header.bitsPerChannel : 8,
    resolution: {
      x: psd.imageResources?.resolutionInfo?.horizontalResolution ?? 72,
      y: psd.imageResources?.resolutionInfo?.verticalResolution ?? 72,
      unit: "ppi",
    },
    guides: psd.imageResources?.gridAndGuidesInformation?.guides?.map((guide, index) => ({
      id: `psd-guide-${index}`,
      orientation: guide.direction,
      position: guide.location,
    })) ?? [],
    proofing: { profile: "none", intent: "relative-colorimetric", blackPointCompensation: true, gamutWarning: false },
    layers: [],
    selection: null,
  };

  const resources = extractPhotoshopImageResources(buffer);
  if (psd.imageResources?.alphaChannelNames?.length) {
    try {
      doc.alphaChannels = readPhotoshopAlphaChannels(originalSource.buffer as ArrayBuffer, psd.imageResources.alphaChannelNames);
      if (header.bitsPerChannel !== 8) importedIssues.push({ code: "ALPHA_CHANNEL_PRECISION_8", severity: "warning", message: "Saved alpha channels are editable at 8-bit mask precision; native image layer samples retain their original depth." });
      if (resources.some(resource => resource.id === 1007 || resource.id === 1077)) importedIssues.push({ code: "ALPHA_DISPLAY_DESCRIPTORS_PRESERVED", severity: "warning", message: "Channel pixels are editable, but spot-ink/display descriptors remain original-source metadata only. Newly written PSD/PSB channels are ordinary alpha, not spot separations." });
    } catch (error) {
      importedIssues.push({ code: "ALPHA_CHANNELS_SOURCE_ONLY", severity: "warning", message: `Named alpha channels remain in the preserved original source only: ${error instanceof Error ? error.message : "unsupported data"}. New PSD/PSB output cannot retain those channels; save the .luma master.` });
    }
  }
  setPhotoshopDocumentMetadata(doc, {
    header,
    importMode: flattenedFallback ? "flattened" : "layered",
    originalSource,
    originalDocumentFingerprint: documentStateFingerprint(doc),
    imageResources: psd.imageResources,
    engineData: psd.engineData,
    linkedFiles: psd.linkedFiles,
    rawImageResources: resources,
    importedIssues,
  });

  let sourceIndex = 0;
  if (sourceBacked) registerPhotoshopTileSource(originalSource, psd.children ?? []);
  const sourceIndexByLayerId = new Map<string, number>();
  // Views into the retained immutable source; no decoded RGBA or duplicate bytes.
  const originalTextPixels = new WeakMap<PsdLayer, PsdLayer["rawData"]>();
  const capture = (
    target: Layer,
    source: PsdLayer,
    preservation: "editable" | "descriptor-preserved" | "preview-only",
  ) => {
    const currentSourceIndex = sourceIndex++;
    target.photoshop = { sourceIndex: currentSourceIndex };
    sourceIndexByLayerId.set(target.id, currentSourceIndex);
    // Pixels are owned by Luma's bitmap/precision surfaces and the immutable
    // original container. Retaining decoder pixels here doubles the live image
    // working set, and group children would retain the entire decoder tree.
    const descriptor = { ...source };
    delete descriptor.canvas; delete descriptor.imageData; delete descriptor.rawData; delete descriptor.children;
    if (originalTextPixels.has(source)) descriptor.rawData = originalTextPixels.get(source);
    if (descriptor.mask && !descriptor.mask.disabled && hasLayerMask(target)) {
      descriptor.mask = { ...descriptor.mask };
      delete descriptor.mask.canvas; delete descriptor.mask.imageData;
    }
    setPhotoshopLayerMetadata(target, {
      source: descriptor,
      originalText: source.text?.text,
      originalTextFingerprint: target.text ? textFingerprint(target) : undefined,
      originalPathFingerprint: pathFingerprint(target),
      originalEffectsFingerprint: effectsFingerprint(target),
      originalStateFingerprint: layerStateFingerprint(target),
      originalSurfaceFingerprint: layerPixelFingerprint(target),
      originalMaskFingerprint: layerMaskFingerprint(target),
      originalParentSourceIndex: target.parentId ? sourceIndexByLayerId.get(target.parentId) : undefined,
      preservation,
    });
    // Release this decoder plane before moving to the next source layer.
    delete source.imageData; delete source.canvas;
    if (source.mask && !source.mask.disabled && hasLayerMask(target)) {
      delete source.mask.imageData; delete source.mask.canvas;
    }
  };

  let decodedLayerPixels = 0;
  const visit = (layer: PsdLayer, parentId?: string) => {
    if (serialPixels && layer.text && !layer.mask && !layer.realMask && layer.rawData) originalTextPixels.set(layer, layer.rawData);
    const adjustment = importedAdjustment(layer);
    const editablePath = editablePathFromPsd(layer);
    let lazySurface: PrecisionTileSurface | undefined;
    if (sourceBacked) {
      // Masks retain their separate bounded decoder until sparse source masks
      // can be qualified. Never silently allocate them under the source budget.
      if (layer.mask || layer.realMask) throw new UnsupportedPhotoshopTileSource("Source-backed Photoshop masks are not yet qualified");
      if (!(layer.children || adjustment || layer.text || editablePath) && (layer.right ?? 0) > (layer.left ?? 0) && (layer.bottom ?? 0) > (layer.top ?? 0)) {
        const base = getPhotoshopTileSource(originalSource, sourceIndex);
        lazySurface = new PrecisionTileSurface(base.grid.width, base.grid.height, "rgba32f", "srgb");
        lazySurface.store.attachSource(base);
      }
    }
    if (serialPixels && layer.rawData) {
      if (layer.rawData.bitsPerChannel !== 8 || layer.rawData.colorMode !== 3) throw new Error("Photoshop channel format changed after admission");
      const area = (bounds: PsdLayer | NonNullable<PsdLayer["mask"]>) => {
        const width = (bounds.right ?? 0) - (bounds.left ?? 0);
        const height = (bounds.bottom ?? 0) - (bounds.top ?? 0);
        if (width < 0 || height < 0 || exceedsBrowserCanvas(Math.max(1, width), Math.max(1, height))) throw new Error("Unsafe Photoshop layer bounds");
        return width * height;
      };
      const pixels = area(layer) + (layer.mask ? area(layer.mask) : 0) + (layer.realMask ? area(layer.realMask) : 0);
      decodedLayerPixels += pixels;
      if (!Number.isSafeInteger(decodedLayerPixels) || pixels > inputHeader.largestLayerPixels! || decodedLayerPixels > inputHeader.layerPixels!) throw new Error("Photoshop layer exceeds admitted decode bounds");
      const semantic = Boolean(layer.children || adjustment || layer.text || editablePath);
      const streamed = semantic || lazySurface ? null : decodePhotoshopRasterRows(layer);
      try { decodeLayerPixels(layer, semantic || Boolean(streamed) || Boolean(lazySurface)); }
      catch (error) { if (streamed) { streamed.width = 1; streamed.height = 1; } throw error; }
      if (streamed) layer.canvas = streamed;
    }
    if (Array.isArray(layer.children)) {
      const group = createGroupLayer(layer.name || "Group");
      applyImportedLayerMetadata(group, layer, parentId);
      applyImportedMask(group, layer, doc);
      capture(group, layer, "editable");
      for (const c of layer.children) visit(c, group.id);
      doc.layers.unshift(group);
      return;
    }
    if (adjustment) {
      applyImportedLayerMetadata(adjustment, layer, parentId);
      applyImportedMask(adjustment, layer, doc);
      capture(adjustment, layer, "editable");
      doc.layers.unshift(adjustment);
      return;
    }
    if (layer.text) {
      const textLayer = createTextLayer(layer.name || "Text", importedTextStyle(layer));
      applyImportedLayerMetadata(textLayer, layer, parentId);
      const matrix = layer.text.transform ?? [1, 0, 0, 1, 0, 0];
      const [a, b, c, d] = matrix;
      const scaleX = Math.hypot(a, b);
      const determinant = a * d - b * c;
      textLayer.transform = {
        tx: matrix[4] ?? 0,
        ty: matrix[5] ?? 0,
        sx: scaleX,
        sy: scaleX > 1e-12 ? determinant / scaleX : Math.hypot(c, d),
        skewX: Math.abs(determinant) > 1e-12 ? (a * c + b * d) / determinant : 0,
        rotation: Math.atan2(matrix[1] ?? 0, matrix[0] ?? 1),
      };
      applyImportedMask(textLayer, layer, doc);
      capture(textLayer, layer, "editable");
      doc.layers.unshift(textLayer);
      return;
    }
    if (editablePath) {
      const pathLayer = createPathLayer(layer.name || "Vector path", editablePath);
      applyImportedLayerMetadata(pathLayer, layer, parentId);
      applyImportedMask(pathLayer, layer, doc);
      capture(pathLayer, layer, "editable");
      doc.layers.unshift(pathLayer);
      return;
    }
    const src = (layer as { canvas?: HTMLCanvasElement }).canvas;
    const left = layer.left ?? 0;
    const top = layer.top ?? 0;
    const pixelData = layer.imageData;
    const localWidth = Math.max(1, pixelData?.width ?? src?.width ?? (layer.right ?? left) - left);
    const localHeight = Math.max(1, pixelData?.height ?? src?.height ?? (layer.bottom ?? top) - top);
    // A row-decoded canvas is already the owned display master. Transfer it,
    // rather than draw into a second equally sized native backing store.
    const canvas = lazySurface ? undefined : !pixelData && src && doc.bitDepth === 8 ? src : newCanvas(localWidth, localHeight);
    const ctx = canvas?.getContext("2d");
    let precisionSurface: PrecisionTileSurface | undefined = lazySurface;
    if (pixelData && doc.bitDepth > 8) {
      precisionSurface = precisionSurfaceFromPsdPixelsInBounds(pixelData, doc, localWidth, localHeight, 0, 0);
      drawPrecisionPreview(canvas!, precisionSurface);
    } else if (pixelData) {
      const image = displayImageData(ctx!, pixelData);
      ctx!.putImageData(image, 0, 0);
    } else if (src && src !== canvas) {
      ctx!.drawImage(src, 0, 0);
    }
    const l: Layer = createRasterLayer(layer.name || "Layer", canvas);
    if (precisionSurface) l.surface = precisionSurface;
    if (layer.placedLayer) l.kind = "smart-object";
    applyImportedLayerMetadata(l, layer, parentId);
    l.transform = { ...l.transform, tx: left, ty: top };
    applyImportedMask(l, layer, doc);
    const preservation = layer.placedLayer || layer.adjustment || layer.vectorMask
      ? "descriptor-preserved"
      : "editable";
    capture(l, layer, preservation);
    if (layer.adjustment && !importedAdjustment(layer)) {
      importedIssues.push({
        code: "ADJUSTMENT_DESCRIPTOR_ONLY",
        severity: "warning",
        layerId: l.id,
        message: `${layer.adjustment.type} remains a Photoshop adjustment on round-trip, but Luma edits its rendered preview only.`,
      });
    }
    if (layer.vectorMask && !editablePath) {
      importedIssues.push({
        code: "COMPLEX_VECTOR_DESCRIPTOR_ONLY",
        severity: "warning",
        layerId: l.id,
        message: "This compound, gradient, or pattern vector layer is retained for Photoshop round-trip and shown as a rendered preview in Luma.",
      });
    }
    doc.layers.unshift(l);
  };

  if (!flattenedFallback) {
    for (const layer of psd.children ?? []) visit(layer);
  }
  if (!doc.layers.length) {
    const canvas = newCanvas(psd.width, psd.height);
    const context = canvas.getContext("2d")!;
    const pixelData = psd.imageData;
    let precisionSurface: PrecisionTileSurface | undefined;
    if (pixelData && doc.bitDepth > 8) {
      precisionSurface = precisionSurfaceFromPsdPixels(pixelData, doc, 0, 0);
      drawPrecisionPreview(canvas, precisionSurface);
    } else if (pixelData) {
      const image = displayImageData(context, pixelData);
      context.putImageData(image, 0, 0);
    } else if (psd.canvas) {
      context.drawImage(psd.canvas, 0, 0);
    } else {
      throw new PhotoshopDecodeError(header, new Error("Flattened Photoshop document has no readable composite image"));
    }
    const flattened = createRasterLayer("Background", canvas);
    if (precisionSurface) flattened.surface = precisionSurface;
    doc.layers.push(flattened);
    capture(flattened, { name: "Flattened composite" }, "preview-only");
    importedIssues.push({
      code: flattenedFallback ? "LAYERED_COMPOSITE_IMPORTED" : "FLATTENED_COMPOSITE_IMPORTED",
      severity: flattenedFallback ? "warning" : "info",
      layerId: flattened.id,
      message: flattenedFallback
        ? "The Photoshop composite was imported as one editable Background layer; edit a copy if exact layered source passthrough matters."
        : "This Photoshop file has no layer table; its composite image was imported as one editable Background layer.",
    });
  }
  for (const [index, layer] of doc.layers.entries()) {
    const metadata = getPhotoshopLayerMetadata(layer);
    if (metadata) setPhotoshopLayerMetadata(layer, { ...metadata, originalStackPosition: index });
  }
  const importedMetadata = getPhotoshopDocumentMetadata(doc);
  if (importedMetadata) importedMetadata.originalLayerCount = doc.layers.length;
  return doc;
}

/**
 * A mask as Photoshop stores it: coverage in the RED channel.
 *
 * Luma's own alpha surfaces put coverage in the *alpha* channel with white RGB
 * (see imageDataFromAlpha in selection.ts), which is what a canvas wants. But
 * ag-psd writes the mask from channel 0 — `writeDataZipWithoutPrediction(imageData,
 * [0])` in psdWriter.js — so handing it that canvas exported red = 255
 * everywhere, i.e. every mask came back reveal-all. The import side already
 * reads red (`data[pixel * 4]`), so red is unambiguously the intended carrier.
 *
 * Building the ImageData directly from the surface also keeps this off a
 * canvas entirely, so premultiplication can never round the coverage.
 */
function psdMaskImageData(surface: SparseAlphaSurface, region: PixelRect): PixelData {
  const coverage = surface.readRegion(region);
  // A plain PixelData, not an ImageData: the engine is DOM-optional and the
  // `ImageData` global is absent in headless hosts. ag-psd only reads
  // data/width/height off this.
  const data = new Uint8ClampedArray(region.width * region.height * 4);
  for (let pixel = 0; pixel < coverage.length; pixel += 1) {
    const offset = pixel * 4;
    data[offset] = coverage[pixel];
    data[offset + 1] = coverage[pixel];
    data[offset + 2] = coverage[pixel];
    data[offset + 3] = 255;
  }
  return { data, width: region.width, height: region.height };
}

function psdMask(doc: Document, layer: Layer): PsdLayer["mask"] {
  const preserved = getPhotoshopLayerMetadata(layer)?.source.mask;
  if (!hasLayerMask(layer)) return preserved ? { ...preserved } : undefined;
  const surface = layerMaskSurface(layer, doc.width, doc.height)!;
  const records = surface.recordBounds();
  const region = records.width && records.height
    ? records
    : { x: 0, y: 0, width: 1, height: 1 };
  return {
    ...preserved,
    canvas: undefined,
    imageData: psdMaskImageData(surface, region),
    top: region.y,
    left: region.x,
    bottom: region.y + region.height,
    right: region.x + region.width,
    defaultColor: surface.defaultAlpha,
    disabled: false,
  };
}

function preservedLayerFields(layer: Layer): PsdLayer {
  const source = getPhotoshopLayerMetadata(layer)?.source;
  if (!source) return {};
  const copy: PsdLayer = { ...source };
  delete copy.canvas;
  delete copy.imageData;
  delete copy.rawData;
  delete copy.children;
  delete copy.mask;
  delete copy.text;
  return copy;
}

/**
 * Combine what the user has in Luma with what the source file carried.
 *
 * An untouched import round-trips byte-for-byte through `preserved`, keeping
 * descriptor details we do not model (choke, contours, global light). Once the
 * effects are edited we regenerate every kind we own — including absent ones,
 * so removing a stroke in Luma actually removes it — while kinds we cannot
 * render still come through from `preserved`.
 */
/** The effect keys `effectsToPsd` is authoritative for. The rest pass through. */
const OWNED_EFFECT_KEYS = [
  "dropShadow", "innerShadow", "outerGlow", "innerGlow", "satin",
  "solidFill", "gradientOverlay", "stroke", "bevel",
] as const;

function mergedEffects(layer: Layer, generated: Partial<LayerEffectsInfo>): LayerEffectsInfo | undefined {
  const metadata = getPhotoshopLayerMetadata(layer);
  const preserved = metadata?.source.effects;
  const filled = (value: unknown) => Array.isArray(value) ? value.length > 0 : !!value;
  const hasGenerated = Object.values(generated).some(filled);
  if (!preserved && !hasGenerated) return undefined;
  if (preserved && metadata?.originalEffectsFingerprint === effectsFingerprint(layer)) return preserved;

  const merged: LayerEffectsInfo = { ...preserved };
  for (const key of OWNED_EFFECT_KEYS) {
    const value = generated[key];
    // Delete rather than assign undefined: ag-psd walks its own keys and
    // would try to serialize the hole. An absent key is also what "the user
    // removed this effect" has to mean, or a deleted stroke comes back from
    // the preserved descriptor.
    if (filled(value)) Object.assign(merged, { [key]: value });
    else delete merged[key];
  }
  return Object.values(merged).some(filled) ? merged : undefined;
}

function exportedBlendMode(layer: Layer, mode: BlendMode): PsdBlend {
  const original = getPhotoshopLayerMetadata(layer)?.source.blendMode;
  if (original === "pass through" && layer.kind === "group" && mode === "source-over") return original;
  if (original && !PSD_TO_BLEND[original] && mode === "source-over") return original;
  return BLEND_TO_PSD[mode];
}

function psdLayerMetadata(doc: Document, layer: Layer, mode: BlendMode, opacity = layer.opacity): PsdLayer {
  const preserved = preservedLayerFields(layer);
  return {
    ...preserved,
    name: layer.name,
    opacity: Math.max(0, Math.min(1, opacity)),
    fillOpacity: resolvedFillOpacity(layer),
    hidden: !layer.visible,
    blendMode: exportedBlendMode(layer, mode),
    blendingRanges: blendIfToPsd(layer),
    clipping: layer.clipping,
    protected: layer.locked
      ? { ...preserved.protected, composite: true }
      : preserved.protected ? { ...preserved.protected, composite: undefined } : undefined,
    mask: psdMask(doc, layer),
    effects: mergedEffects(layer, effectsToPsd(layer)),
  };
}

function adjustmentLayersToPsd(doc: Document, layer: Layer): PsdLayer[] {
  const base = () => psdLayerMetadata(doc, layer, layer.blend);
  if (layer.kind === "adjustment-levels" && layer.levels) {
    const levels = layer.levels;
    return [{
      ...base(),
      adjustment: {
        type: "levels",
        rgb: {
          shadowInput: Math.round(levels.inBlack * 255),
          highlightInput: Math.round(levels.inWhite * 255),
          midtoneInput: levels.gamma,
          shadowOutput: Math.round(levels.outBlack * 255),
          highlightOutput: Math.round(levels.outWhite * 255),
        },
      },
    }];
  }
  if (layer.kind === "adjustment-curves" && layer.curves) {
    const points = (channel: typeof layer.curves.rgb) => channel.map((point) => ({
      input: Math.round(point.x * 255),
      output: Math.round(point.y * 255),
    }));
    return [{
      ...base(),
      adjustment: {
        type: "curves",
        rgb: points(layer.curves.rgb),
        red: points(layer.curves.r),
        green: points(layer.curves.g),
        blue: points(layer.curves.b),
      },
    }];
  }
  if (layer.kind === "adjustment-hsl" && layer.hsl) {
    return [{
      ...base(),
      adjustment: {
        type: "hue/saturation",
        master: { a: 0, b: 0, c: 0, d: 0, hue: layer.hsl.hue, saturation: layer.hsl.saturation, lightness: layer.hsl.lightness },
      },
    }];
  }
  if (layer.kind === "adjustment-tone" && layer.tone) {
    const tone = layer.tone;
    const results: PsdLayer[] = [];
    if (tone.exposure) results.push({
      ...base(),
      name: `${layer.name} · Exposure`,
      adjustment: { type: "exposure", exposure: tone.exposure, offset: 0, gamma: 1 },
    });
    if (tone.contrast || tone.highlights || tone.shadows) results.push({
      ...base(),
      name: `${layer.name} · Brightness/Contrast`,
      adjustment: {
        type: "brightness/contrast",
        brightness: Math.round((tone.highlights + tone.shadows) / 2),
        contrast: tone.contrast,
        useLegacy: false,
      },
    });
    if (tone.vibrance) results.push({
      ...base(),
      name: `${layer.name} · Vibrance`,
      adjustment: { type: "vibrance", vibrance: tone.vibrance, saturation: 0 },
    });
    if (tone.temperature) results.push({
      ...base(),
      name: `${layer.name} · Temperature`,
      adjustment: {
        type: "photo filter",
        color: tone.temperature > 0 ? { r: 255, g: 145, b: 45 } : { r: 80, g: 150, b: 255 },
        density: Math.abs(tone.temperature),
        preserveLuminosity: true,
      },
    });
    return results.length ? results : [{ ...base(), adjustment: { type: "brightness/contrast", brightness: 0, contrast: 0 } }];
  }
  if (layer.kind === "adjustment-pro" && layer.proAdjustment) {
    const adjustment = layer.proAdjustment;
    switch (adjustment.kind) {
      case "black-white": return [{
        ...base(),
        opacity: Math.max(0, Math.min(1, layer.opacity * adjustment.amount)),
        adjustment: {
          type: "black & white",
          reds: (adjustment.colorMix ?? DEFAULT_BLACK_WHITE_MIX)[0], yellows: (adjustment.colorMix ?? DEFAULT_BLACK_WHITE_MIX)[1],
          greens: (adjustment.colorMix ?? DEFAULT_BLACK_WHITE_MIX)[2], cyans: (adjustment.colorMix ?? DEFAULT_BLACK_WHITE_MIX)[3],
          blues: (adjustment.colorMix ?? DEFAULT_BLACK_WHITE_MIX)[4], magentas: (adjustment.colorMix ?? DEFAULT_BLACK_WHITE_MIX)[5],
          useTint: adjustment.tintAmount > 0,
          tintColor: cssColorToPsd(adjustment.tint),
        },
      }];
      case "color-balance": {
        const values = (rgb: [number, number, number]) => ({
          cyanRed: Math.round(rgb[0] * 100),
          magentaGreen: Math.round(rgb[1] * 100),
          yellowBlue: Math.round(rgb[2] * 100),
        });
        return [{ ...base(), adjustment: {
          type: "color balance",
          shadows: values(adjustment.shadows),
          midtones: values(adjustment.midtones),
          highlights: values(adjustment.highlights),
          preserveLuminosity: adjustment.preserveLuminosity,
        } }];
      }
      case "photo-filter": return [{ ...base(), adjustment: {
        type: "photo filter",
        color: cssColorToPsd(adjustment.color),
        density: adjustment.density * 100,
        preserveLuminosity: adjustment.preserveLuminosity,
      } }];
      case "channel-mixer": {
        const channel = (offset: number) => ({
          red: adjustment.matrix[offset] * 100,
          green: adjustment.matrix[offset + 1] * 100,
          blue: adjustment.matrix[offset + 2] * 100,
          constant: adjustment.matrix[offset + 3] * 100,
        });
        return [{ ...base(), adjustment: { type: "channel mixer", red: channel(0), green: channel(4), blue: channel(8) } }];
      }
      case "color-lookup": return [{ ...base(), opacity: layer.opacity * adjustment.intensity, adjustment: {
        type: "color lookup",
        lookupType: "3dlut",
        name: `Luma ${adjustment.preset}`,
      } }];
      case "gradient-map": return [{ ...base(), adjustment: {
        type: "gradient map",
        name: layer.name,
        gradientType: "solid",
        reverse: adjustment.reverse,
        smoothness: Math.round(adjustment.smoothness * 4096),
        colorStops: gradientMapStops(adjustment).map((stop) => ({ color: cssColorToPsd(stop.color), location: Math.round(stop.position * 4096), midpoint: 50 })),
        opacityStops: [
          { opacity: 1, location: 0, midpoint: 50 },
          { opacity: 1, location: 4096, midpoint: 50 },
        ],
      } }];
      case "relight-field": return [{
        ...base(),
        opacity: layer.opacity * Math.max(0.05, Math.min(1, adjustment.radius)),
        adjustment: {
          type: "exposure",
          exposure: adjustment.intensity * 1.65,
          offset: adjustment.temperature * 0.02,
          gamma: 1,
        },
      }];
      case "threshold": return [{ ...base(), adjustment: { type: "threshold", level: Math.round(adjustment.level * 255) } }];
      case "posterize": return [{ ...base(), adjustment: { type: "posterize", levels: Math.round(adjustment.levels) } }];
      case "invert": return [{ ...base(), adjustment: { type: "invert" } }];
    }
  }
  return [];
}

function preservedTextPixels(doc: Document, layer: Layer, container: PhotoshopContainer) {
  const metadata = getPhotoshopLayerMetadata(layer), source = metadata?.source, raw = source?.rawData;
  if (!source || !raw || raw.bitsPerChannel !== 8 || raw.colorMode !== 3 || raw.large !== (container === "psb") ||
      (source.right ?? 0) <= (source.left ?? 0) || (source.bottom ?? 0) <= (source.top ?? 0) ||
      doc.bitDepth !== 8 || doc.colorSpace !== "srgb" || metadata.originalTextFingerprint !== textFingerprint(layer) ||
      source.mask || source.realMask || hasLayerMask(layer) || layer.vectorMask || layer.spatial?.enabled ||
      layer.filters?.length || layer.tone || layer.curves || layer.levels || layer.hsl ||
      metadata.originalEffectsFingerprint !== effectsFingerprint(layer) ||
      !raw.channels.length || raw.channels.some(channel => ![-1, 0, 1, 2].includes(channel.id))) return undefined;
  return { rawData: raw, left: source.left, top: source.top, right: source.right, bottom: source.bottom };
}

function textLayersToPsd(doc: Document, layer: Layer, container: PhotoshopContainer): PsdLayer[] {
  if (!layer.text) return [];
  const style = layer.text;
  const baseRun = resolvedDefaultTextStyle(style);
  const font = parseCanvasFont(canvasFontForRun(baseRun));
  const t = layer.transform;
  const { a, b, c, d } = affineForLayerTransform(t);
  const tx = t.tx + a * style.x + c * style.y;
  const ty = t.ty + b * style.x + d * style.y;
  const pixels = preservedTextPixels(doc, layer, container);
  const rasterized = pixels ? null : flattenLayerBitmap(doc, layer);
  const metadata = getPhotoshopLayerMetadata(layer);
  const originalText = metadata?.source.text;
  const textUnchanged = metadata?.originalTextFingerprint === textFingerprint(layer);
  const psdRunStyle = (offset: number) => {
    const run = resolvedTextStyleAt(style, offset);
    const runFont = parseCanvasFont(canvasFontForRun(run));
    return {
      font: { name: runFont.name },
      fontSize: run.fontSize,
      fauxBold: run.fontWeight >= 700,
      fauxItalic: run.fontStyle !== "normal",
      horizontalScale: run.fontStretch / 100,
      autoLeading: false,
      leading: run.fontSize * style.lineHeight,
      fillColor: cssColorToPsd(run.color),
      ...(run.tracking ? { tracking: run.tracking } : {}),
      ...(run.baselineShift ? { baselineShift: run.baselineShift } : {}),
      ...(run.decoration === "underline" ? { underline: true } : {}),
      ...(run.decoration === "line-through" ? { strikethrough: true } : {}),
      ligatures: run.features.liga !== false,
      autoKerning: run.features.kern !== false,
    };
  };
  const normalizedRuns = normalizeTextRuns(style.runs, style.text.length);
  const runBoundaries = [...new Set([0, style.text.length, ...normalizedRuns.flatMap((run) => [run.start, run.end])])].sort((a, b) => a - b);
  const generatedStyleRuns = runBoundaries.slice(0, -1).map((start, index) => ({
    length: runBoundaries[index + 1] - start,
    style: psdRunStyle(start),
  })).filter((run) => run.length > 0);
  let paragraphStart = 0;
  const generatedParagraphRuns = style.text.split("\n").map((paragraph, index, all) => {
    const start = paragraphStart, end = start + paragraph.length;
    const override = style.paragraphs?.find(run => run.start <= start && run.end >= end)?.style;
    const length = paragraph.length + (index < all.length - 1 ? 1 : 0);
    paragraphStart += length;
    return { length, style: {
      justification: override?.align === "justify" ? psdJustification({ ...style, justify: true }) : override?.align ?? psdJustification(style),
      firstLineIndent: override?.firstLineIndent ?? 0, startIndent: override?.startIndent ?? 0,
      endIndent: override?.endIndent ?? 0, spaceBefore: override?.spaceBefore ?? 0,
      spaceAfter: override?.spaceAfter ?? (style.paragraphSpacing ?? 0) * font.size,
    } };
  }).filter(run => run.length > 0);
  const frameLeft = style.align === "center" ? -(style.boxWidth ?? 0) / 2 : style.align === "right" ? -(style.boxWidth ?? 0) : 0;
  const frameTop = style.layout === "paragraph" && style.frameOrigin !== "top" ? -paragraphCapHeight(newCanvas(1, 1).getContext("2d")!, style) : 0;
  const simpleText: LayerTextData = textUnchanged && originalText ? { ...originalText } : {
    text: style.text,
    transform: [a, b, c, d, tx, ty],
    style: psdRunStyle(0),
    ...(generatedStyleRuns.length > 1 ? { styleRuns: generatedStyleRuns } : {}),
    paragraphStyle: {
      justification: psdJustification(style),
      ...(style.paragraphSpacing ? { spaceAfter: style.paragraphSpacing * font.size } : {}),
    },
    ...(style.paragraphs?.length ? { paragraphStyleRuns: generatedParagraphRuns } : {}),
    shapeType: style.layout === "paragraph" ? "box" : "point",
    ...(style.layout === "paragraph" ? { boxBounds: [frameLeft, frameTop, frameLeft + style.boxWidth!, frameTop + style.boxHeight!] } : {}),
  };
  return resolvedBlendPasses(layer).filter((pass) => pass.enabled && pass.opacity > 0).map((pass) => ({
    ...psdLayerMetadata(doc, layer, pass.mode, layer.opacity * pass.opacity),
    name: resolvedBlendPasses(layer).length > 1 ? `${layer.name} · ${BLEND_LABELS[pass.mode]}` : layer.name,
    canvas: rasterized?.canvas,
    text: simpleText,
    left: rasterized?.left ?? 0,
    top: rasterized?.top ?? 0,
    ...pixels,
  }));
}

function vectorLayersToPsd(doc: Document, layer: Layer): PsdLayer[] {
  if (layer.path?.appearance) throw new Error(`${layer.name}: appearance stacks require SVG or raster delivery; PSD stack conversion is not yet supported`);
  const rasterized = flattenLayerBitmap(doc, layer);
  const metadata = getPhotoshopLayerMetadata(layer);
  const originalVector = metadata?.source;
  const preserveOriginalPath = layer.kind === "path"
    && metadata?.originalPathFingerprint === pathFingerprint(layer)
    && !!originalVector?.vectorMask;
  const mask = preserveOriginalPath
    ? originalVector?.vectorMask
    : layer.kind === "path" ? pathToPsdMask(layer) : shapeToPsdMask(layer);
  const fill = preserveOriginalPath
    ? originalVector?.vectorFill
    : vectorFill(layer.kind === "path" ? layer.path?.fill ?? "none" : layer.shape?.fill ?? "none");
  const stroke = preserveOriginalPath
    ? originalVector?.vectorStroke
    : vectorStroke(
      layer.kind === "path" ? layer.path?.stroke ?? "none" : layer.shape?.stroke ?? "none",
      layer.kind === "path" ? layer.path?.strokeWidth ?? 0 : layer.shape?.strokeWidth ?? 0,
    );
  return resolvedBlendPasses(layer).filter((pass) => pass.enabled && pass.opacity > 0).map((pass) => ({
    ...psdLayerMetadata(doc, layer, pass.mode, layer.opacity * pass.opacity),
    name: resolvedBlendPasses(layer).length > 1 ? `${layer.name} · ${BLEND_LABELS[pass.mode]}` : layer.name,
    canvas: rasterized?.canvas,
    left: rasterized?.left ?? 0,
    top: rasterized?.top ?? 0,
    vectorMask: mask,
    vectorFill: fill,
    vectorStroke: stroke,
    vectorOrigination: preserveOriginalPath ? originalVector?.vectorOrigination : undefined,
    transparencyShapesLayer: true,
  }));
}

export type PhotoshopExportOptions = {
  /** Auto selects PSB only when PSD's 30,000px limit requires it. */
  format?: "auto" | "source" | PhotoshopContainer;
  compress?: boolean;
  /** Owned by the guarded asynchronous export pipeline; never persisted. */
  preparedSmartObjects?: ReadonlyMap<string, PreparedSmartObject>;
  /** Clean merged pixels, without editor overlays or soft-proof simulation. */
  mergedPreview?: HTMLCanvasElement;
};

export type PhotoshopCompatibilityReport = {
  container: PhotoshopContainer;
  canExport: boolean;
  issues: PhotoshopCompatibilityIssue[];
};

function resolvedContainer(doc: Document, format: PhotoshopExportOptions["format"] = "auto"): PhotoshopContainer {
  if (format === "psd" || format === "psb") return format;
  if (format === "source") return getPhotoshopDocumentMetadata(doc)?.header.container ?? (doc.width > 30000 || doc.height > 30000 ? "psb" : "psd");
  return doc.width > 30000 || doc.height > 30000 ? "psb" : "psd";
}

type Native16BitEligibility = { eligible: true } | { eligible: false; reason: string };

const native16SurfaceChecks = new WeakMap<PrecisionTileSurface, {
  revision: number;
  result: Native16BitEligibility;
}>();

function native16SurfaceEligibility(surface: PrecisionTileSurface): Native16BitEligibility {
  const revision = surface.store.stats().revision;
  const cached = native16SurfaceChecks.get(surface);
  if (cached?.revision === revision) return cached.result;
  let result: Native16BitEligibility = { eligible: true };
  for (let y = 0; y < surface.grid.height && result.eligible; y += 1) {
    for (let x = 0; x < surface.grid.width; x += 1) {
      const pixel = surface.readPixel(x, y);
      if (Math.abs(pixel[3] - 1) > 1 / 65535) {
        result = { eligible: false, reason: "the precision surface contains transparency" };
        break;
      }
      const encoded = workingToDisplaySrgb([pixel[0], pixel[1], pixel[2]], surface.colorSpace);
      if (encoded.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) {
        result = { eligible: false, reason: "the precision surface contains HDR or out-of-gamut samples" };
        break;
      }
    }
  }
  native16SurfaceChecks.set(surface, { revision, result });
  return result;
}

/**
 * This gate is intentionally conservative. The current native path has no
 * high-depth compositor, so it may only write a document whose merged result
 * is exactly its one precision raster layer. Everything else remains on the
 * explicitly reported compatibility path instead of mislabeling 8-bit data.
 */
function native16BitEligibility(doc: Document): Native16BitEligibility {
  if (doc.bitDepth !== 16) return { eligible: false, reason: "the document is not 16-bit" };
  if (doc.colorSpace !== "srgb") return { eligible: false, reason: "native output currently supports sRGB only" };
  if (doc.layers.length !== 1) return { eligible: false, reason: "native output currently requires exactly one layer" };
  const layer = doc.layers[0];
  if (layer.kind !== "raster" || !layer.surface || layer.surface.format === "rgba8") {
    return { eligible: false, reason: "the raster layer does not have a high-depth precision master" };
  }
  if (layer.surface.grid.width !== doc.width || layer.surface.grid.height !== doc.height || layer.surface.colorSpace !== doc.colorSpace) {
    return { eligible: false, reason: "the precision master does not match the document geometry or color space" };
  }
  const transform = layer.transform;
  if (transform.tx !== 0 || transform.ty !== 0 || transform.sx !== 1 || transform.sy !== 1 || transform.rotation !== 0 || (transform.skewX ?? 0) !== 0) {
    return { eligible: false, reason: "the raster layer has a transform that requires high-depth resampling" };
  }
  const passes = resolvedBlendPasses(layer).filter((pass) => pass.enabled && pass.opacity > 0);
  if (!layer.visible || layer.opacity !== 1 || resolvedFillOpacity(layer) !== 1 || passes.length !== 1 ||
      passes[0].mode !== "source-over" || passes[0].opacity !== 1 || layer.clipping || layer.blendIf ||
      hasLayerMask(layer) || layer.vectorMask || layer.spatial?.enabled || layer.raw || layer.parentId ||
      layer.blendChannels || (layer.knockout ?? "none") !== "none" ||
      layer.filters?.some((filter) => filter.enabled) || layer.effects?.some((effect) => effect.enabled)) {
    return { eligible: false, reason: "the layer requires high-depth compositing, masking, or effects" };
  }
  const source = getPhotoshopLayerMetadata(layer)?.source;
  if (source?.effects || source?.filterEffectsMasks || source?.filterMask || source?.adjustment ||
      source?.placedLayer || source?.text || source?.vectorMask || source?.vectorFill || source?.vectorStroke) {
    return { eligible: false, reason: "the preserved Photoshop layer has appearance descriptors that require high-depth compositing" };
  }
  return native16SurfaceEligibility(layer.surface);
}

function native16RgbChannels(surface: PrecisionTileSurface) {
  const sampleBytes = surface.grid.width * surface.grid.height * 2;
  const channels = [
    new Uint8Array(sampleBytes),
    new Uint8Array(sampleBytes),
    new Uint8Array(sampleBytes),
  ] as const;
  const views = channels.map((channel) => new DataView(channel.buffer, channel.byteOffset, channel.byteLength));
  for (let y = 0; y < surface.grid.height; y += 1) {
    for (let x = 0; x < surface.grid.width; x += 1) {
      const pixel = surface.readPixel(x, y);
      const encoded = workingToDisplaySrgb([pixel[0], pixel[1], pixel[2]], surface.colorSpace);
      const byteOffset = (y * surface.grid.width + x) * 2;
      for (let channel = 0; channel < 3; channel += 1) {
        views[channel].setUint16(byteOffset, Math.round(Math.max(0, Math.min(1, encoded[channel])) * 65535), false);
      }
    }
  }
  return channels;
}

/**
 * Source mode is deliberately strict: every editable property, hierarchy slot,
 * precision tile, bitmap, and layer mask must still match the import snapshot.
 * If any proof is unavailable we use the normal writer instead of risking stale
 * source bytes.
 */
function canReturnOriginalPhotoshopSource(doc: Document, container: PhotoshopContainer) {
  const metadata = getPhotoshopDocumentMetadata(doc);
  if (!metadata?.originalSource || metadata.header.container !== container) return false;
  if (metadata.originalDocumentFingerprint !== documentStateFingerprint(doc)) return false;

  const seenSourceIndices = new Set<number>();
  for (const [stackPosition, layer] of doc.layers.entries()) {
    const layerMetadata = getPhotoshopLayerMetadata(layer);
    // Embedded native edits can change layer structure without changing the
    // rendered preview. Never return stale original Photoshop source bytes.
    if (layer.smartSource) return false;
    const sourceLayerIndex = layer.photoshop?.sourceIndex;
    if (!layerMetadata || sourceLayerIndex === undefined || seenSourceIndices.has(sourceLayerIndex)) return false;
    seenSourceIndices.add(sourceLayerIndex);
    if (layerMetadata.originalStackPosition !== stackPosition) return false;
    if (layerMetadata.originalStateFingerprint !== layerStateFingerprint(layer)) return false;

    const surfaceFingerprint = layerPixelFingerprint(layer);
    const maskFingerprint = layerMaskFingerprint(layer);
    if (layerMetadata.originalSurfaceFingerprint === "unreadable" || surfaceFingerprint === "unreadable") return false;
    if (layerMetadata.originalMaskFingerprint === "unreadable" || maskFingerprint === "unreadable") return false;
    if (layerMetadata.originalSurfaceFingerprint !== surfaceFingerprint) return false;
    if (layerMetadata.originalMaskFingerprint !== maskFingerprint) return false;

    const parentSourceIndex = layer.parentId
      ? doc.layers.find((candidate) => candidate.id === layer.parentId)?.photoshop?.sourceIndex
      : undefined;
    if (layerMetadata.originalParentSourceIndex !== parentSourceIndex) return false;
  }
  return seenSourceIndices.size === doc.layers.length;
}

export function photoshopCompatibilityReport(
  doc: Document,
  options: PhotoshopExportOptions = {},
): PhotoshopCompatibilityReport {
  const container = resolvedContainer(doc, options.format);
  const issues: PhotoshopCompatibilityIssue[] = [
    ...(getPhotoshopDocumentMetadata(doc)?.importedIssues ?? []),
  ];
  const sourceMetadata = getPhotoshopDocumentMetadata(doc);
  const hasPreservedIcc = sourceMetadata?.rawImageResources.some((resource) => resource.id === 1039);
  if (sourceMetadata && hasPreservedIcc) {
    issues.push(sourceMetadata.header.colorMode === 3 && doc.colorSpace === "srgb" ? {
      code: "ICC_PROFILE_PRESERVED",
      severity: "info",
      message: "The source RGB ICC profile is preserved byte-for-byte for Photoshop round-trip.",
    } : {
      code: "ICC_PROFILE_NOT_REATTACHED",
      severity: "warning",
      message: "The source ICC profile is not attached because the source/output color modes do not match.",
    });
  }
  if (doc.width <= 0 || doc.height <= 0) {
    issues.push({ code: "INVALID_DIMENSIONS", severity: "error", message: "Photoshop documents require positive dimensions." });
  }
  // Photoshop pattern overlays reference a pattern from its library. Ours are
  // procedural, so there is no asset to write; say so rather than dropping the
  // effect silently, which is what every other unmapped kind used to do.
  const patternLayers = doc.layers.filter((layer) =>
    layer.effects?.some((effect) => effect.kind === "pattern-overlay" && effect.enabled));
  if (patternLayers.length) {
    issues.push({
      code: "PATTERN_OVERLAY_NOT_EXPORTED",
      severity: "warning",
      message: `Pattern Overlay is procedural in Luma and has no Photoshop pattern asset, so it is not written to the file (${patternLayers.length} layer${patternLayers.length === 1 ? "" : "s"}). Rasterize those layers to keep the look.`,
    });
  }
  // Photoshop has no live backdrop effect at all — there you duplicate, merge
  // and blur by hand — so there is nothing to write and it must be said.
  const backdropKinds: ReadonlyArray<LayerEffect["kind"]> = ["backdrop-blur", "refraction", "reflection", "contact-shadow"];
  const backdropLayers = doc.layers.filter((layer) =>
    layer.effects?.some((effect) => effect.enabled && backdropKinds.includes(effect.kind)));
  if (backdropLayers.length) {
    issues.push({
      code: "BACKDROP_EFFECT_NOT_EXPORTED",
      severity: "warning",
      message: `Backdrop Blur, Refraction, Reflection and Contact Shadow read the layers underneath and have no Photoshop layer style equivalent, so they are not written to the file (${backdropLayers.length} layer${backdropLayers.length === 1 ? "" : "s"}). Rasterize those layers to keep the look.`,
    });
  }
  // Knockout has no ag-psd layer field at all, and channelBlendingRestrictions
  // exists in its types but does not survive its writer — a round trip returns
  // an empty array. Both are read on import; neither can be written back.
  const advancedLayers = doc.layers.filter((layer) =>
    (layer.knockout ?? "none") !== "none" || layer.blendChannels || layer.maskHidesEffects);
  if (advancedLayers.length) {
    issues.push({
      code: "ADVANCED_BLENDING_NOT_EXPORTED",
      severity: "warning",
      message: `Knockout, channel restrictions and mask-hides-effects are set on ${advancedLayers.length} layer${advancedLayers.length === 1 ? "" : "s"} and cannot be written to PSD. The flattened composite is unaffected; the editable settings are lost.`,
    });
  }
  // Bloom, Relief and Long Shadow are ours; Photoshop has no slot for them.
  const luminanceKinds: ReadonlyArray<LayerEffect["kind"]> = ["bloom", "relief", "long-shadow"];
  const luminanceLayers = doc.layers.filter((layer) =>
    layer.effects?.some((effect) => effect.enabled && luminanceKinds.includes(effect.kind)));
  if (luminanceLayers.length) {
    issues.push({
      code: "LUMA_ONLY_EFFECT_NOT_EXPORTED",
      severity: "warning",
      message: `Bloom, Relief and Long Shadow have no Photoshop layer style equivalent, so they are not written to the file (${luminanceLayers.length} layer${luminanceLayers.length === 1 ? "" : "s"}). Rasterize those layers to keep the look.`,
    });
  }
  // A "color lookup" descriptor names a LUT; it does not carry one. Photoshop
  // resolves the name against its own library, where "Luma <preset>" does not
  // exist, so the layer arrives inert. Intensity is folded into layer opacity
  // as the closest available approximation.
  const lookupLayers = doc.layers.filter((layer) => layer.proAdjustment?.kind === "color-lookup");
  if (lookupLayers.length) {
    issues.push({
      code: "COLOR_LOOKUP_NOT_EXPORTED",
      severity: "warning",
      message: `Color Lookup is written as a named 3D LUT reference, and Photoshop has no LUT by that name, so ${lookupLayers.length} layer${lookupLayers.length === 1 ? " arrives" : "s arrive"} with no effect. The flattened composite keeps the exact Luma rendering; rasterize those layers to keep the look in a layered file.`,
    });
  }
  const relightLayers = doc.layers.filter((layer) => layer.proAdjustment?.kind === "relight-field");
  if (relightLayers.length) {
    issues.push({
      code: "RELIGHT_FIELD_APPROXIMATED",
      severity: "warning",
      message: `Relight Field has no native Photoshop adjustment descriptor, so ${relightLayers.length} field${relightLayers.length === 1 ? " is" : "s are"} exported as editable Exposure approximations. The flattened composite keeps the exact Luma rendering.`,
    });
  }
  if (container === "psd" && (doc.width > 30000 || doc.height > 30000)) {
    issues.push({ code: "PSD_DIMENSION_LIMIT", severity: "error", message: "PSD is limited to 30,000 pixels per side; export as PSB." });
  }
  if (doc.width > 300000 || doc.height > 300000) {
    issues.push({ code: "PSB_DIMENSION_LIMIT", severity: "error", message: "Photoshop PSB is limited to 300,000 pixels per side." });
  }
  const sourcePassthrough = options.format === "source"
    && canReturnOriginalPhotoshopSource(doc, container)
    && !issues.some((issue) => issue.severity === "error");
  if (sourcePassthrough) {
    issues.push({
      code: "ORIGINAL_SOURCE_PASSTHROUGH",
      severity: "info",
      message: `The untouched ${container.toUpperCase()} will be exported byte-for-byte, preserving its original depth, color mode, resources, and descriptors.`,
    });
    return { container, canExport: true, issues };
  }
  if (doc.alphaChannels?.length) {
    try {
      assertPhotoshopAlphaExport(doc);
      issues.push({ code: "SAVED_ALPHA_CHANNELS_EXPORTED", severity: "info", message: "Saved alpha channels will be written as named Photoshop alpha planes. Luma's editable mask precision is 8-bit, including in high-depth containers." });
    } catch (error) { issues.push({ code: "ALPHA_CHANNEL_EXPORT_BOUND", severity: "error", message: error instanceof Error ? error.message : "Alpha export exceeds its safe boundary" }); }
  }
  const native16 = native16BitEligibility(doc);
  const expandedNative = native16.eligible ? native16 : highDepthEligibility(doc);
  if (expandedNative.eligible) {
    issues.push({
      code: doc.bitDepth === 32 ? "OUTPUT_32_BIT_NATIVE" : "OUTPUT_16_BIT_NATIVE",
      severity: "info",
      message: `The supported raster stack will be written as native ${doc.bitDepth}-bit RGB layers and composite samples. Native high-depth support remains bounded; this is not general Photoshop descriptor parity.`,
    });
  } else if (doc.bitDepth !== 8) {
    issues.push({
      code: "OUTPUT_DEPTH_CONVERTED_TO_8_BIT",
      severity: "warning",
      message: `Native ${doc.bitDepth}-bit output is gated because ${expandedNative.reason}; this document will be compatibility-converted to 8-bit RGB.`,
    });
  }
  if (doc.colorSpace !== "srgb") {
    issues.push({
      code: "OUTPUT_COLOR_SPACE_CONVERTED_TO_SRGB",
      severity: "warning",
      message: `${doc.colorSpace} pixels are exported through the 8-bit RGB compatibility mirror; an ICC profile is not embedded by the current writer.`,
    });
  }
  if (!expandedNative.eligible && !options.mergedPreview) issues.push({ code: "COMPOSITE_PREVIEW_UNAVAILABLE", severity: "warning", message: "A merged compatibility preview is not generated on this export path. Open the editable layers; composite-only readers may display an empty image. The desktop export pipeline supplies previews for supported documents up to 4 MP." });
  for (const layer of doc.layers) {
    const metadata = getPhotoshopLayerMetadata(layer);
    const prepared = options.preparedSmartObjects?.get(layer.id);
    if (layer.vectorMask) issues.push({ code: "EDITABLE_VECTOR_MASK_NOT_EXPORTED", severity: "error", layerId: layer.id,
      message: `${layer.name}: this editable vector mask cannot yet be preserved by the Photoshop writer. Save the Luma master or export a flattened image; no masked content has been discarded.` });
    if (prepared && (prepared.source !== layer.smartSource || prepared.bitmap !== layer.bitmap)) throw new Error("Smart Object contents changed during Photoshop preparation");
    if (layer.path?.appearance) issues.push({ code: "VECTOR_APPEARANCE_UNSUPPORTED", severity: "error", layerId: layer.id, message: `${layer.name}: use SVG or raster export for vector appearance stacks; PSD conversion is not supported.` });
    if (layer.path?.symbolId) issues.push({ code: "SYMBOL_LINKS_EXPANDED", severity: "warning", layerId: layer.id, message: `${layer.name}: geometry is preserved, but linked-instance behavior requires the .luma project.` });
    if (layer.kind === "smart-object" && prepared) {
      issues.push({ code: "NATIVE_SMART_OBJECT_EMBEDDED", severity: "info", layerId: layer.id, message: `${layer.name}'s editable contents are embedded as a layered PSB with affine placement.` }, ...prepared.issues);
    } else if (layer.kind === "smart-object" && !metadata?.source.placedLayer) {
      issues.push({
        code: "SMART_OBJECT_PREVIEW_ONLY",
        severity: "warning",
        layerId: layer.id,
        message: `${layer.name} has no Photoshop placed-layer payload and will export as its raster preview.`,
      });
    } else if (layer.kind === "smart-object" && metadata?.source.placedLayer && layer.smartSource) {
      issues.push({ code: "SMART_CONTENT_REQUIRES_PREPARATION", severity: "error", layerId: layer.id, message: `${layer.name}'s edited contents require the guarded asynchronous Photoshop exporter. Its original embedded payload must not overwrite the edits.` });
    } else if (layer.kind === "smart-object" && metadata?.source.placedLayer) {
      issues.push({
        code: "SMART_OBJECT_PAYLOAD_PRESERVED",
        severity: "info",
        layerId: layer.id,
        message: `${layer.name}'s placed-layer descriptor and linked payload are preserved; Luma edits do not rewrite its embedded source document.`,
      });
    }
    if (layer.kind === "smart-object" && layer.filters?.length) {
      issues.push({
        code: "LUMA_SMART_FILTERS_PREVIEW_ONLY",
        severity: "warning",
        layerId: layer.id,
        message: `${layer.name}'s Luma smart filters are visible in its compatibility preview but are not translated into Photoshop smart-filter descriptors.`,
      });
    }
    if (layer.kind === "text" && metadata?.source.text && !preservedTextPixels(doc, layer, container)) {
      issues.push({ code: "IMPORTED_TEXT_PREVIEW_REGENERATED", severity: "warning", layerId: layer.id,
        message: `${layer.name}: editable text is retained, but its rendered preview is rebuilt by Luma. Font appearance, line layout and text effects may differ from the original Photoshop rendering. Check the exported copy in the receiving application before delivery.` });
    }
    if (layer.text?.layout === "paragraph") {
      if (![layer.text.boxWidth, layer.text.boxHeight].every(value => typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 100_000)) {
        issues.push({ code: "TEXT_FRAME_INVALID", severity: "error", layerId: layer.id, message: `${layer.name}: paragraph export requires a finite, positive frame width and height up to 100,000 pixels.` });
      } else if (metadata?.originalTextFingerprint !== textFingerprint(layer)) {
        issues.push({ code: "PARAGRAPH_LAYOUT_REQUIRES_REVIEW", severity: "warning", layerId: layer.id, message: `${layer.name}: the text story and frame remain editable. Photoshop recomposes paragraph baselines, wrapping and justification; their visual fidelity is not qualified. Review the receiving application's rendering before delivery.` });
      }
    }
    if (layer.kind === "text" && metadata?.source.text?.styleRuns?.length
      && metadata.originalTextFingerprint !== textFingerprint(layer)) {
      issues.push({
        code: layer.text?.runs?.length ? "RICH_TEXT_RUNS_REBUILT" : "RICH_TEXT_RUNS_REPLACED",
        severity: layer.text?.runs?.length ? "info" : "warning",
        layerId: layer.id,
        message: layer.text?.runs?.length
          ? `${layer.name}'s edited character runs are rebuilt as editable Photoshop text styles.`
          : `${layer.name} was edited without character ranges, so its Photoshop runs are replaced by one valid editable style.`,
      });
    }
    if (resolvedBlendPasses(layer).filter((pass) => pass.enabled && pass.opacity > 0).length > 1) {
      issues.push({
        code: "BLEND_STACK_EXPANDED",
        severity: "info",
        layerId: layer.id,
        message: `${layer.name}'s Luma blend stack is exported as ordered Photoshop layers.`,
      });
    }
    if (layer.surface?.store.sourceState()) {
      const t = layer.transform;
      if (hasLayerMask(layer) || layer.spatial || t.sx !== 1 || t.sy !== 1 || t.rotation !== 0 || (t.skewX ?? 0) || !Number.isInteger(t.tx) || !Number.isInteger(t.ty)) issues.push({
        code: "SOURCE_BACKED_EXPORT_REQUIRES_PROJECT", severity: "error", layerId: layer.id,
        message: `${layer.name} has source-backed pixels with masks or a transform that the bounded Photoshop writer cannot yet encode. Save the editable Luma project instead.`,
      });
    }
    if ((layer.kind === "raster" || layer.kind === "smart-object") && layer.surface && !layer.bitmap &&
        exceedsBrowserCanvas(doc.width, doc.height)) {
      issues.push({
        code: "SPARSE_LAYER_REQUIRES_STREAMING_WRITER",
        severity: "error",
        layerId: layer.id,
        message: `${layer.name} is a sparse large-document layer; exporting it requires the streaming PSB writer rather than a browser-sized compatibility canvas.`,
      });
    }
  }
  return {
    container,
    canExport: !issues.some((issue) => issue.severity === "error"),
    issues,
  };
}

export function exportPhotoshopDocument(
  doc: Document,
  options: PhotoshopExportOptions = {},
): { buffer: ArrayBuffer; report: PhotoshopCompatibilityReport } {
  const report = photoshopCompatibilityReport(doc, options);
  if (!report.canExport) {
    throw new Error(report.issues.filter((issue) => issue.severity === "error").map((issue) => issue.message).join(" "));
  }
  const preservedSource = getPhotoshopDocumentMetadata(doc)?.originalSource;
  if (report.issues.some((issue) => issue.code === "ORIGINAL_SOURCE_PASSTHROUGH") && preservedSource) {
    const bytes = preservedSource.slice();
    return {
      buffer: bytes.buffer as ArrayBuffer,
      report,
    };
  }
  const native16 = native16BitEligibility(doc);
  if (!native16.eligible && highDepthEligibility(doc).eligible) {
    const preserved = getPhotoshopDocumentMetadata(doc);
    const written = exportHighDepthRgb(doc, report.container);
    return { buffer: writePhotoshopAlphaChannels(mergePhotoshopImageResources(written, preserved?.rawImageResources ?? [], {
      includeIccProfile: preserved?.header.colorMode === 3 && doc.colorSpace === "srgb",
    }), doc), report };
  }
  // One Luma blend stack exports as repeated PSD layers, preserving the same
  // bottom-to-top pass order and per-pass opacity in Photoshop.
  let sourceExportBytes = 0;
  const serializeLayer = (layer: Layer): PsdLayer[] => {
    if (layer.kind.startsWith("adjustment-")) return adjustmentLayersToPsd(doc, layer).reverse();
    if (layer.kind === "group") {
      const children = doc.layers
        .filter((candidate) => candidate.parentId === layer.id)
        .flatMap(serializeLayer)
        .reverse();
      return [{
        ...psdLayerMetadata(doc, layer, layer.blend),
        children,
        opened: true,
      }];
    }
    if (layer.kind === "text") return textLayersToPsd(doc, layer, report.container).reverse();
    if (layer.kind === "shape" || layer.kind === "path") return vectorLayersToPsd(doc, layer).reverse();
    if (layer.surface?.store.sourceState()) {
      const t = layer.transform;
      // No surprise dense rasterization under the source-backed admission.
      if (hasLayerMask(layer) || layer.spatial || t.sx !== 1 || t.sy !== 1 || t.rotation !== 0 || (t.skewX ?? 0) || !Number.isInteger(t.tx) || !Number.isInteger(t.ty)) throw new Error("Source-backed Photoshop export currently requires an unmasked raster at its original scale and rotation; save the editable Luma project instead");
      const rawData = sourceBackedPhotoshopChannels(layer.surface, report.container === "psb", bytes => {
        if (sourceExportBytes + bytes > 384 * 1024 * 1024) throw new Error("Photoshop edited-channel export exceeds its memory ceiling; save the Luma project instead");
        sourceExportBytes += bytes;
      });
      const passes = resolvedBlendPasses(layer).filter(pass => pass.enabled && pass.opacity > 0);
      return passes.map(pass => ({
        ...psdLayerMetadata(doc, layer, pass.mode, layer.opacity * pass.opacity),
        name: passes.length > 1 ? `${layer.name} · ${BLEND_LABELS[pass.mode]}` : layer.name,
        left: t.tx, top: t.ty, right: t.tx + layer.surface!.grid.width, bottom: t.ty + layer.surface!.grid.height,
        canvas: undefined, imageData: undefined, rawData,
      })).reverse();
    }
    const rasterized = flattenLayerBitmap(doc, layer);
    if (!rasterized) return [];
    const passes = resolvedBlendPasses(layer).filter((pass) => pass.enabled && pass.opacity > 0);
    return passes.map((pass) => ({
      ...psdLayerMetadata(doc, layer, pass.mode, layer.opacity * pass.opacity),
      ...(options.preparedSmartObjects?.has(layer.id) ? { placedLayer: options.preparedSmartObjects.get(layer.id)!.placedLayer } : {}),
      name: passes.length > 1 ? `${layer.name} · ${BLEND_LABELS[pass.mode]}` : layer.name,
      canvas: rasterized.canvas,
      left: rasterized.left,
      top: rasterized.top,
    })).reverse();
  };
  const native16Channels = native16.eligible ? native16RgbChannels(doc.layers[0].surface!) : undefined;
  let native16RawData: LayerRawData | undefined;
  if (native16Channels) {
    native16RawData = {
      colorMode: 3,
      bitsPerChannel: 16,
      large: report.container === "psb",
      channels: [
        { id: 0, compression: 0, data: native16Channels[0] },
        { id: 1, compression: 0, data: native16Channels[1] },
        { id: 2, compression: 0, data: native16Channels[2] },
      ],
    };
  }
  // ag-psd expects bottom-to-top; our stack is top-to-bottom. The native path
  // is separately gated to exactly one document-sized precision raster layer.
  const children: PsdLayer[] = native16RawData ? [{
    ...psdLayerMetadata(doc, doc.layers[0], "source-over", 1),
    mask: undefined,
    canvas: undefined,
    imageData: undefined,
    top: 0,
    left: 0,
    right: doc.width,
    bottom: doc.height,
    rawData: native16RawData,
  }] : doc.layers
    .filter((layer) => !layer.parentId)
    .flatMap(serializeLayer)
    .reverse();
  const preserved = getPhotoshopDocumentMetadata(doc);
  const originalResources = preserved?.imageResources;
  // Txt2 addresses text by the original layer/index mapping. Never reuse it
  // after text, geometry, stack, or blend-pass expansion changes.
  const preserveTextEngine = !!preserved?.engineData && preserved.originalLayerCount === doc.layers.length &&
    preserved.originalDocumentFingerprint === documentStateFingerprint(doc) &&
    doc.layers.every((layer, index) => {
      const metadata = getPhotoshopLayerMetadata(layer);
      return metadata?.originalStackPosition === index &&
        !!metadata.source.text === (layer.kind === "text") &&
        metadata.originalParentSourceIndex === (layer.parentId ? doc.layers.find(parent => parent.id === layer.parentId)?.photoshop?.sourceIndex : undefined) &&
        resolvedBlendPasses(layer).filter(pass => pass.enabled && pass.opacity > 0).length === 1 &&
        (layer.kind !== "text" || !!preservedTextPixels(doc, layer, report.container));
    });
  if (options.mergedPreview && (options.mergedPreview.width !== doc.width || options.mergedPreview.height !== doc.height)) throw new Error("Photoshop composite dimensions do not match the document");
  const psd: Psd = {
    width: doc.width,
    height: doc.height,
    bitsPerChannel: native16RawData ? 16 : 8,
    colorMode: 3, // RGB
    engineData: preserveTextEngine ? preserved?.engineData : undefined,
    children,
    canvas: native16RawData ? undefined : options.mergedPreview,
    linkedFiles: [...(preserved?.linkedFiles ?? []), ...Array.from(options.preparedSmartObjects?.values() ?? [], object => object.file)],
    imageResources: {
      ...originalResources,
      resolutionInfo: {
        horizontalResolution: doc.resolution.x,
        horizontalResolutionUnit: "PPI",
        widthUnit: originalResources?.resolutionInfo?.widthUnit ?? "Inches",
        verticalResolution: doc.resolution.y,
        verticalResolutionUnit: "PPI",
        heightUnit: originalResources?.resolutionInfo?.heightUnit ?? "Inches",
      },
      gridAndGuidesInformation: {
        ...originalResources?.gridAndGuidesInformation,
        guides: doc.guides.map((guide) => ({ location: guide.position, direction: guide.orientation })),
      },
    },
  };
  const writeOptions = {
    psb: report.container === "psb",
    compress: options.compress,
    invalidateTextLayers: !preserveTextEngine,
    noBackground: true,
  };
  try {
    if (doc.layers.some(layer => layer.surface?.store.sourceState())) {
      let encodedBytes = 0;
      const count = (layers: PsdLayer[]) => { for (const layer of layers) {
        if (layer.rawData) for (const channel of layer.rawData.channels) encodedBytes += channel.data?.byteLength ?? 0;
        else if (layer.canvas) encodedBytes += layer.canvas.width * layer.canvas.height * 5;
        else if (layer.imageData) encodedBytes += layer.imageData.data.byteLength * 1.25;
        if (layer.children) count(layer.children);
      } };
      count(children);
      for (const file of preserved?.linkedFiles ?? []) encodedBytes += file.data?.byteLength ?? 0;
      assertSourceBackedExportBudget(doc.width, doc.height, encodedBytes, preservedSource?.length ?? 0, sourceExportBytes);
    }
    const written = native16Channels
      ? writeNative16BitRgbPsd(psd, native16Channels, writeOptions)
      : writePsd(psd, writeOptions);
    const buffer = mergePhotoshopImageResources(written, preserved?.rawImageResources ?? [], {
      // An RGB source profile still describes the unconverted channel values.
      // Never attach a CMYK/Lab source profile to the RGB compatibility output.
      includeIccProfile: preserved?.header.colorMode === 3 && doc.colorSpace === "srgb",
    });
    return { buffer: writePhotoshopAlphaChannels(buffer, doc), report };
  } finally {
    // Non-transformed bitmap layers borrow their existing pixels read-only.
    // Release only export-owned rasterizations; never resize a document bitmap.
    const borrowed = new Set(doc.layers.map(layer => layer.bitmap).filter(Boolean));
    // Do not leave
    // a duplicate native backing-store stack resident until the host next runs
    // GC (particularly when the exported file is immediately reopened). Masks
    // and linked assets may alias preservation metadata and are not touched.
    const released = new Set<HTMLCanvasElement>();
    const release = (layers: PsdLayer[]) => {
      for (const layer of layers) {
        if (layer.canvas && !borrowed.has(layer.canvas) && !released.has(layer.canvas)) {
          released.add(layer.canvas);
          layer.canvas.width = 1; layer.canvas.height = 1;
        }
        if (layer.children) release(layer.children);
      }
    };
    release(children);
  }
}

export function exportPsd(doc: Document, options: PhotoshopExportOptions = {}): ArrayBuffer {
  return exportPhotoshopDocument(doc, options).buffer;
}

function transformedRasterBounds(doc: Document, layer: Layer) {
  if (layer.kind !== "raster" && layer.kind !== "smart-object") {
    return { left: 0, top: 0, width: doc.width, height: doc.height };
  }
  const width = layer.bitmap?.width ?? layer.surface?.grid.width ?? 0;
  const height = layer.bitmap?.height ?? layer.surface?.grid.height ?? 0;
  if (!width || !height) return null;
  const matrix = affineForLayerTransform(layer.transform);
  const transform = (x: number, y: number) => ({
    x: matrix.a * x + matrix.c * y + matrix.e,
    y: matrix.b * x + matrix.d * y + matrix.f,
  });
  const corners = [transform(0, 0), transform(width, 0), transform(width, height), transform(0, height)];
  const left = Math.floor(Math.min(...corners.map((corner) => corner.x)));
  const top = Math.floor(Math.min(...corners.map((corner) => corner.y)));
  const right = Math.ceil(Math.max(...corners.map((corner) => corner.x)));
  const bottom = Math.ceil(Math.max(...corners.map((corner) => corner.y)));
  const outputWidth = Math.max(1, right - left);
  const outputHeight = Math.max(1, bottom - top);
  if (exceedsBrowserCanvas(outputWidth, outputHeight)) {
    throw new Error(`${layer.name} is too large to rasterize safely for Photoshop export`);
  }
  return { left, top, width: outputWidth, height: outputHeight };
}

// Rasterize into the smallest document-space rectangle that contains the
// transformed pixels. Imported PSD layers normally keep local-sized bitmaps,
// so export no longer recreates one document-sized canvas for every layer.
function flattenLayerBitmap(doc: Document, layer: Layer): { canvas: HTMLCanvasElement; left: number; top: number } | null {
  if ((layer.kind === "raster" || layer.kind === "smart-object") && !layer.bitmap && !layer.surface) return null;
  const t = layer.transform;
  if ((layer.kind === "raster" || layer.kind === "smart-object") && layer.bitmap && !layer.surface && !layer.spatial &&
      t.sx === 1 && t.sy === 1 && t.rotation === 0 && !(t.skewX ?? 0) &&
      Number.isInteger(t.tx) && Number.isInteger(t.ty)) {
    return { canvas: layer.bitmap, left: t.tx, top: t.ty };
  }
  const bounds = transformedRasterBounds(doc, layer);
  if (!bounds) return null;
  const c = newCanvas(bounds.width, bounds.height);
  const ctx = c.getContext("2d")!;
  const projection = { a: 1, b: 0, c: 0, d: 1, e: -bounds.left, f: -bounds.top };
  if (layer.surface) drawLayerContentManaged(ctx, layer, projection);
  else drawLayerContent(ctx, layer, projection);
  if (layer.text) {
    // Text descriptors stay editable and retain their absolute transform. Its
    // fallback bitmap must not turn a few glyphs into another document-sized
    // layer on export/reopen. Scan bounded strips, then discard the padding.
    let left = c.width, top = c.height, right = -1, bottom = -1;
    for (let y = 0; y < c.height; y += 32) {
      const rows = Math.min(32, c.height - y);
      const data = ctx.getImageData(0, y, c.width, rows).data;
      for (let row = 0; row < rows; row++) for (let x = 0; x < c.width; x++) {
        if (data[(row * c.width + x) * 4 + 3]) {
          left = Math.min(left, x); right = Math.max(right, x);
          top = Math.min(top, y + row); bottom = Math.max(bottom, y + row);
        }
      }
    }
    if (right < left) { left = 0; top = 0; right = 0; bottom = 0; }
    const width = right - left + 1, height = bottom - top + 1;
    if (width !== c.width || height !== c.height) {
      const cropped = newCanvas(width, height);
      cropped.getContext("2d")!.drawImage(c, left, top, width, height, 0, 0, width, height);
      c.width = 1; c.height = 1;
      return { canvas: cropped, left: bounds.left + left, top: bounds.top + top };
    }
  }
  // The mask is deliberately NOT applied here. Photoshop stores a layer's
  // pixels unmasked and the mask as a separate channel (psdMask above), so
  // baking it into the pixels too would apply it twice — a 50% mask would
  // reopen at 25%. This was previously masked-in only because the exported
  // mask channel was broken and always read back as reveal-all.
  return { canvas: c, left: bounds.left, top: bounds.top };
}
