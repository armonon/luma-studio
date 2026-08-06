// PSD import/export via ag-psd. This is real read/write — layers, masks, blend
// modes, opacity, transforms all preserved on export. Import supports layered
// PSDs by mapping ag-psd layers to raster layers with per-layer bitmaps.

import { readPsd, writePsd, Psd, Layer as PsdLayer, BlendMode as PsdBlend } from "ag-psd";
import {
  BlendMode,
  BLEND_LABELS,
  BlendIf,
  BlendIfRange,
  Document,
  Layer,
  NEUTRAL_TONE,
  TextStyle,
  createAdjustmentLayer,
  createCurvesLayer,
  createRasterLayer,
  createGroupLayer,
  createHslLayer,
  createLevelsLayer,
  createTextLayer,
  drawLayerContent,
  newCanvas,
  resolvedBlendIf,
  resolvedFillOpacity,
  resolvedBlendPasses,
} from "./document";

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
  target.opacity = (source.opacity ?? 255) / 255;
  if (source.fillOpacity !== undefined) target.fillOpacity = source.fillOpacity;
  target.blendIf = blendIfFromPsd(source);
  target.visible = !source.hidden;
  target.clipping = source.clipping;
  target.locked = !!source.protected?.composite;
  const blend = source.blendMode?.toLowerCase();
  if (blend && PSD_TO_BLEND[blend]) target.blend = PSD_TO_BLEND[blend];
  if (source.effects?.dropShadow?.length) {
    target.effects = source.effects.dropShadow.map((effect, index) => {
      const angle = (effect.angle ?? 45) * Math.PI / 180;
      const distance = effect.distance?.value ?? 10;
      return {
        id: `${target.id}-psd-shadow-${index}`,
        kind: "drop-shadow" as const,
        enabled: effect.enabled !== false,
        opacity: effect.opacity ?? 0.75,
        color: psdColorToCss(effect.color),
        blur: effect.size?.value ?? 12,
        offsetX: Math.cos(angle) * distance,
        offsetY: Math.sin(angle) * distance,
      };
    });
  }
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

function importedTextStyle(layer: PsdLayer): TextStyle {
  const text = layer.text!;
  const size = text.style?.fontSize ?? 16;
  const family = text.style?.font?.name ?? "Arial";
  const weight = text.style?.fauxBold ? "700" : "400";
  const italic = text.style?.fauxItalic ? "italic " : "";
  const align = text.paragraphStyle?.justification;
  return {
    text: text.text,
    font: `${italic}${weight} ${size}px ${family}, sans-serif`,
    color: psdColorToCss(text.style?.fillColor),
    align: align?.startsWith("right") ? "right" : align?.startsWith("center") ? "center" : "left",
    lineHeight: text.style?.leading ? text.style.leading / size : 1.2,
    x: 0,
    y: 0,
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
  return null;
}

export async function importPsd(buffer: ArrayBuffer): Promise<Document> {
  const psd: Psd = readPsd(buffer, { skipCompositeImageData: true });
  const doc: Document = {
    width: psd.width,
    height: psd.height,
    colorSpace: "srgb",
    bitDepth: 8,
    resolution: { x: 72, y: 72, unit: "ppi" },
    guides: [],
    layers: [],
    selection: null,
  };

  const visit = (layer: PsdLayer, parentId?: string) => {
    if (layer.children && layer.children.length) {
      const group = createGroupLayer(layer.name || "Group");
      group.parentId = parentId;
      group.opacity = (layer.opacity ?? 255) / 255;
      if (layer.fillOpacity !== undefined) group.fillOpacity = layer.fillOpacity;
      group.blendIf = blendIfFromPsd(layer);
      group.visible = !layer.hidden;
      const groupBlend = layer.blendMode?.toLowerCase();
      if (groupBlend && PSD_TO_BLEND[groupBlend]) group.blend = PSD_TO_BLEND[groupBlend];
      for (const c of layer.children) visit(c, group.id);
      doc.layers.unshift(group);
      return;
    }
    const adjustment = importedAdjustment(layer);
    if (adjustment) {
      applyImportedLayerMetadata(adjustment, layer, parentId);
      if (layer.mask?.canvas) {
        const mask = newCanvas(psd.width, psd.height);
        mask.getContext("2d")!.drawImage(layer.mask.canvas, layer.mask.left ?? 0, layer.mask.top ?? 0);
        adjustment.mask = mask;
      }
      doc.layers.unshift(adjustment);
      return;
    }
    if (layer.text) {
      const textLayer = createTextLayer(layer.name || "Text", importedTextStyle(layer));
      applyImportedLayerMetadata(textLayer, layer, parentId);
      const matrix = layer.text.transform ?? [1, 0, 0, 1, 0, 0];
      textLayer.transform = {
        tx: matrix[4] ?? 0,
        ty: matrix[5] ?? 0,
        sx: Math.hypot(matrix[0] ?? 1, matrix[1] ?? 0),
        sy: Math.hypot(matrix[2] ?? 0, matrix[3] ?? 1),
        rotation: Math.atan2(matrix[1] ?? 0, matrix[0] ?? 1),
      };
      doc.layers.unshift(textLayer);
      return;
    }
    const canvas = newCanvas(psd.width, psd.height);
    const ctx = canvas.getContext("2d")!;
    const src = (layer as { canvas?: HTMLCanvasElement }).canvas;
    if (src) {
      const left = layer.left ?? 0;
      const top = layer.top ?? 0;
      ctx.drawImage(src, left, top);
    }
    const l: Layer = createRasterLayer(layer.name || "Layer", canvas);
    applyImportedLayerMetadata(l, layer, parentId);
    if (layer.mask?.canvas) {
      const mask = newCanvas(psd.width, psd.height);
      mask.getContext("2d")!.drawImage(layer.mask.canvas, layer.mask.left ?? 0, layer.mask.top ?? 0);
      l.mask = mask;
    }
    doc.layers.unshift(l);
  };

  for (const layer of psd.children ?? []) visit(layer);
  return doc;
}

function psdMask(doc: Document, layer: Layer): PsdLayer["mask"] {
  return layer.mask ? {
    canvas: layer.mask,
    top: 0,
    left: 0,
    bottom: doc.height,
    right: doc.width,
    defaultColor: 255,
  } : undefined;
}

function psdLayerMetadata(doc: Document, layer: Layer, mode: BlendMode, opacity = layer.opacity): PsdLayer {
  const shadows = layer.effects?.filter((effect) => effect.kind === "drop-shadow").map((effect) => ({
    present: true,
    showInDialog: true,
    enabled: effect.enabled,
    size: { units: "Pixels" as const, value: effect.blur },
    angle: Math.atan2(effect.offsetY, effect.offsetX) * 180 / Math.PI,
    distance: { units: "Pixels" as const, value: Math.hypot(effect.offsetX, effect.offsetY) },
    color: cssColorToPsd(effect.color),
    blendMode: "multiply" as const,
    opacity: effect.opacity,
    useGlobalLight: false,
  }));
  return {
    name: layer.name,
    opacity: Math.round(opacity * 255),
    fillOpacity: resolvedFillOpacity(layer),
    hidden: !layer.visible,
    blendMode: BLEND_TO_PSD[mode],
    blendingRanges: blendIfToPsd(layer),
    clipping: layer.clipping,
    protected: layer.locked ? { composite: true } : undefined,
    mask: psdMask(doc, layer),
    effects: shadows?.length ? { dropShadow: shadows } : undefined,
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
  return [];
}

function textLayersToPsd(doc: Document, layer: Layer): PsdLayer[] {
  if (!layer.text) return [];
  const style = layer.text;
  const font = parseCanvasFont(style.font);
  const t = layer.transform;
  const cos = Math.cos(t.rotation);
  const sin = Math.sin(t.rotation);
  const a = cos * t.sx;
  const b = sin * t.sx;
  const c = -sin * t.sy;
  const d = cos * t.sy;
  const tx = t.tx + a * style.x + c * style.y;
  const ty = t.ty + b * style.x + d * style.y;
  const canvas = flattenLayerBitmap(doc, layer);
  return resolvedBlendPasses(layer).filter((pass) => pass.enabled && pass.opacity > 0).map((pass) => ({
    ...psdLayerMetadata(doc, layer, pass.mode, layer.opacity * pass.opacity),
    name: resolvedBlendPasses(layer).length > 1 ? `${layer.name} · ${BLEND_LABELS[pass.mode]}` : layer.name,
    canvas: canvas ?? undefined,
    text: {
      text: style.text,
      transform: [a, b, c, d, tx, ty],
      style: {
        font: { name: font.name },
        fontSize: font.size,
        fauxBold: font.bold,
        fauxItalic: font.italic,
        leading: font.size * style.lineHeight,
        fillColor: cssColorToPsd(style.color),
      },
      paragraphStyle: {
        justification: style.align === "right" ? "right" : style.align === "center" ? "center" : "left",
      },
      shapeType: "point",
    },
    left: 0,
    top: 0,
  }));
}

export function exportPsd(doc: Document): ArrayBuffer {
  // One Luma blend stack exports as repeated PSD layers, preserving the same
  // bottom-to-top pass order and per-pass opacity in Photoshop.
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
    if (layer.kind === "text") return textLayersToPsd(doc, layer).reverse();
    const canvas = flattenLayerBitmap(doc, layer);
    if (!canvas) return [];
    const passes = resolvedBlendPasses(layer).filter((pass) => pass.enabled && pass.opacity > 0);
    return passes.map((pass) => ({
      ...psdLayerMetadata(doc, layer, pass.mode, layer.opacity * pass.opacity),
      name: passes.length > 1 ? `${layer.name} · ${BLEND_LABELS[pass.mode]}` : layer.name,
      canvas,
      left: 0,
      top: 0,
    })).reverse();
  };
  // ag-psd expects bottom-to-top; our stack is top-to-bottom.
  const children = doc.layers
    .filter((layer) => !layer.parentId)
    .flatMap(serializeLayer)
    .reverse();
  const psd: Psd = {
    width: doc.width,
    height: doc.height,
    children,
  };
  return writePsd(psd);
}

// Rasterize any layer content (raster / text / shape) to a doc-sized canvas
// with its transform and mask baked in.
function flattenLayerBitmap(doc: Document, layer: Layer): HTMLCanvasElement | null {
  const c = newCanvas(doc.width, doc.height);
  const ctx = c.getContext("2d")!;
  if ((layer.kind === "raster" || layer.kind === "smart-object") && !layer.bitmap) return null;
  drawLayerContent(ctx, layer);
  if (layer.mask) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(layer.mask, 0, 0);
  }
  return c;
}
