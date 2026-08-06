// Preservation-first PSD/PSB import/export via ag-psd. Native Luma equivalents
// remain editable; descriptors that Luma cannot edit are retained for round-trip
// and surfaced through an explicit compatibility report.

import {
  readPsd,
  writePsd,
  Psd,
  Layer as PsdLayer,
  BlendMode as PsdBlend,
  LayerEffectsInfo,
  LayerTextData,
  LayerVectorMask,
  VectorContent,
} from "ag-psd";
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
  createPathLayer,
  createTextLayer,
  drawLayerContent,
  newCanvas,
  resolvedBlendIf,
  resolvedFillOpacity,
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

function textFingerprint(layer: Pick<Layer, "text" | "transform">) {
  return JSON.stringify({ text: layer.text, transform: layer.transform });
}

function effectsFingerprint(layer: Pick<Layer, "effects">) {
  return JSON.stringify(layer.effects ?? []);
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
  const t = layer.transform;
  const cos = Math.cos(t.rotation);
  const sin = Math.sin(t.rotation);
  return [
    cos * t.sx * x - sin * t.sy * y + t.tx,
    sin * t.sx * x + cos * t.sy * y + t.ty,
  ];
}

function pathToPsdMask(layer: Layer): LayerVectorMask | undefined {
  if (!layer.path || layer.path.anchors.length < 2) return undefined;
  return {
    paths: [{
      open: !layer.path.closed,
      fillRule: "non-zero",
      operation: "combine",
      knots: layer.path.anchors.map((anchor) => {
        const incoming = canvasPoint(layer, anchor.x + anchor.hIn.dx, anchor.y + anchor.hIn.dy);
        const point = canvasPoint(layer, anchor.x, anchor.y);
        const outgoing = canvasPoint(layer, anchor.x + anchor.hOut.dx, anchor.y + anchor.hOut.dy);
        return { linked: false, points: [...incoming, ...point, ...outgoing] };
      }),
    }],
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

function applyImportedMask(target: Layer, source: PsdLayer, doc: Pick<Document, "width" | "height">) {
  if (!source.mask?.canvas || source.mask.disabled) return;
  const mask = newCanvas(doc.width, doc.height);
  const context = mask.getContext("2d")!;
  if ((source.mask.defaultColor ?? 255) > 0) {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, doc.width, doc.height);
  }
  context.drawImage(source.mask.canvas, source.mask.left ?? 0, source.mask.top ?? 0);
  target.mask = mask;
}

function importedTextStyle(layer: PsdLayer): TextStyle {
  const text = layer.text!;
  const firstStyle = { ...(text.style ?? {}), ...(text.styleRuns?.[0]?.style ?? {}) };
  const firstParagraph = { ...(text.paragraphStyle ?? {}), ...(text.paragraphStyleRuns?.[0]?.style ?? {}) };
  const size = firstStyle.fontSize ?? 16;
  const family = firstStyle.font?.name ?? "Arial";
  const weight = firstStyle.fauxBold ? "700" : "400";
  const italic = firstStyle.fauxItalic ? "italic " : "";
  const align = firstParagraph.justification;
  return {
    text: text.text,
    font: `${italic}${weight} ${size}px ${family}, sans-serif`,
    color: psdColorToCss(firstStyle.fillColor),
    align: align?.startsWith("right") ? "right" : align?.startsWith("center") ? "center" : "left",
    lineHeight: firstStyle.leading ? firstStyle.leading / size : 1.2,
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
  const header = inspectPhotoshopHeader(buffer);
  let psd: Psd;
  try {
    psd = readPsd(buffer, {
      skipCompositeImageData: true,
      // Preserve embedded smart-object bytes. This is intentionally false and
      // stated explicitly because ag-psd otherwise permits skipping them.
      skipLinkedFilesData: false,
      throwForMissingFeatures: false,
      logMissingFeatures: false,
    });
  } catch (error) {
    throw new PhotoshopDecodeError(header, error);
  }
  const importedIssues: PhotoshopCompatibilityIssue[] = [];
  if (header.container === "psb") {
    importedIssues.push({
      code: "PSB_IMPORTED",
      severity: "info",
      message: "Large Document Format structure was imported; choose PSB explicitly when exporting to retain that container.",
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
      code: "HIGH_DEPTH_LAYER_PREVIEW",
      severity: "warning",
      message: `The ${header.bitsPerChannel}-bit document depth is retained, but ag-psd supplies layer canvases through an 8-bit compatibility preview.`,
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

  setPhotoshopDocumentMetadata(doc, {
    header,
    originalSource: new Uint8Array(buffer.slice(0)),
    imageResources: psd.imageResources,
    linkedFiles: psd.linkedFiles,
    rawImageResources: extractPhotoshopImageResources(buffer),
    importedIssues,
  });

  let sourceIndex = 0;
  const capture = (
    target: Layer,
    source: PsdLayer,
    preservation: "editable" | "descriptor-preserved" | "preview-only",
  ) => {
    target.photoshop = { sourceIndex: sourceIndex++ };
    setPhotoshopLayerMetadata(target, {
      source,
      originalText: source.text?.text,
      originalTextFingerprint: target.text ? textFingerprint(target) : undefined,
      originalPathFingerprint: pathFingerprint(target),
      originalEffectsFingerprint: effectsFingerprint(target),
      preservation,
    });
  };

  const visit = (layer: PsdLayer, parentId?: string) => {
    if (Array.isArray(layer.children)) {
      const group = createGroupLayer(layer.name || "Group");
      applyImportedLayerMetadata(group, layer, parentId);
      applyImportedMask(group, layer, doc);
      capture(group, layer, "editable");
      for (const c of layer.children) visit(c, group.id);
      doc.layers.unshift(group);
      return;
    }
    const adjustment = importedAdjustment(layer);
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
      textLayer.transform = {
        tx: matrix[4] ?? 0,
        ty: matrix[5] ?? 0,
        sx: Math.hypot(matrix[0] ?? 1, matrix[1] ?? 0),
        sy: Math.hypot(matrix[2] ?? 0, matrix[3] ?? 1),
        rotation: Math.atan2(matrix[1] ?? 0, matrix[0] ?? 1),
      };
      applyImportedMask(textLayer, layer, doc);
      capture(textLayer, layer, "editable");
      doc.layers.unshift(textLayer);
      return;
    }
    const editablePath = editablePathFromPsd(layer);
    if (editablePath) {
      const pathLayer = createPathLayer(layer.name || "Vector path", editablePath);
      applyImportedLayerMetadata(pathLayer, layer, parentId);
      applyImportedMask(pathLayer, layer, doc);
      capture(pathLayer, layer, "editable");
      doc.layers.unshift(pathLayer);
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
    if (layer.placedLayer) l.kind = "smart-object";
    applyImportedLayerMetadata(l, layer, parentId);
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

  for (const layer of psd.children ?? []) visit(layer);
  return doc;
}

function psdMask(doc: Document, layer: Layer): PsdLayer["mask"] {
  const preserved = getPhotoshopLayerMetadata(layer)?.source.mask;
  if (!layer.mask) return preserved ? { ...preserved } : undefined;
  return {
    ...preserved,
    canvas: layer.mask,
    imageData: undefined,
    top: 0,
    left: 0,
    bottom: doc.height,
    right: doc.width,
    defaultColor: preserved?.defaultColor ?? 255,
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

function mergedEffects(layer: Layer, shadows: LayerEffectsInfo["dropShadow"]): LayerEffectsInfo | undefined {
  const metadata = getPhotoshopLayerMetadata(layer);
  const preserved = metadata?.source.effects;
  if (!preserved && !shadows?.length) return undefined;
  if (preserved && metadata?.originalEffectsFingerprint === effectsFingerprint(layer)) return preserved;
  return {
    ...preserved,
    dropShadow: shadows?.length ? shadows : preserved?.dropShadow,
  };
}

function exportedBlendMode(layer: Layer, mode: BlendMode): PsdBlend {
  const original = getPhotoshopLayerMetadata(layer)?.source.blendMode;
  if (original === "pass through" && layer.kind === "group" && mode === "source-over") return original;
  if (original && !PSD_TO_BLEND[original] && mode === "source-over") return original;
  return BLEND_TO_PSD[mode];
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
  const preserved = preservedLayerFields(layer);
  return {
    ...preserved,
    name: layer.name,
    opacity: Math.round(opacity * 255),
    fillOpacity: resolvedFillOpacity(layer),
    hidden: !layer.visible,
    blendMode: exportedBlendMode(layer, mode),
    blendingRanges: blendIfToPsd(layer),
    clipping: layer.clipping,
    protected: layer.locked
      ? { ...preserved.protected, composite: true }
      : preserved.protected ? { ...preserved.protected, composite: undefined } : undefined,
    mask: psdMask(doc, layer),
    effects: mergedEffects(layer, shadows),
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
  const metadata = getPhotoshopLayerMetadata(layer);
  const originalText = metadata?.source.text;
  const textUnchanged = metadata?.originalTextFingerprint === textFingerprint(layer);
  const simpleText: LayerTextData = textUnchanged && originalText ? { ...originalText } : {
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
    // Existing rich runs are valid only while the complete Luma text model is
    // unchanged. Once edited, emit a valid single-style text layer rather than
    // writing stale run lengths that Photoshop could misinterpret.
    shapeType: "point",
  };
  return resolvedBlendPasses(layer).filter((pass) => pass.enabled && pass.opacity > 0).map((pass) => ({
    ...psdLayerMetadata(doc, layer, pass.mode, layer.opacity * pass.opacity),
    name: resolvedBlendPasses(layer).length > 1 ? `${layer.name} · ${BLEND_LABELS[pass.mode]}` : layer.name,
    canvas: canvas ?? undefined,
    text: simpleText,
    left: 0,
    top: 0,
  }));
}

function vectorLayersToPsd(doc: Document, layer: Layer): PsdLayer[] {
  const canvas = flattenLayerBitmap(doc, layer);
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
    canvas: canvas ?? undefined,
    left: 0,
    top: 0,
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
  if (container === "psd" && (doc.width > 30000 || doc.height > 30000)) {
    issues.push({ code: "PSD_DIMENSION_LIMIT", severity: "error", message: "PSD is limited to 30,000 pixels per side; export as PSB." });
  }
  if (doc.width > 300000 || doc.height > 300000) {
    issues.push({ code: "PSB_DIMENSION_LIMIT", severity: "error", message: "Photoshop PSB is limited to 300,000 pixels per side." });
  }
  if (doc.bitDepth !== 8) {
    issues.push({
      code: "OUTPUT_DEPTH_CONVERTED_TO_8_BIT",
      severity: "warning",
      message: `The current PSD writer only supports 8-bit RGB output; this ${doc.bitDepth}-bit document will be compatibility-converted on export.`,
    });
  }
  if (doc.colorSpace !== "srgb") {
    issues.push({
      code: "OUTPUT_COLOR_SPACE_CONVERTED_TO_SRGB",
      severity: "warning",
      message: `${doc.colorSpace} pixels are exported through the 8-bit RGB compatibility mirror; an ICC profile is not embedded by the current writer.`,
    });
  }
  for (const layer of doc.layers) {
    const metadata = getPhotoshopLayerMetadata(layer);
    if (layer.kind === "smart-object" && !metadata?.source.placedLayer) {
      issues.push({
        code: "SMART_OBJECT_PREVIEW_ONLY",
        severity: "warning",
        layerId: layer.id,
        message: `${layer.name} has no Photoshop placed-layer payload and will export as its raster preview.`,
      });
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
    if (layer.kind === "text" && metadata?.source.text?.styleRuns?.length
      && metadata.originalTextFingerprint !== textFingerprint(layer)) {
      issues.push({
        code: "RICH_TEXT_RUNS_REPLACED",
        severity: "warning",
        layerId: layer.id,
        message: `${layer.name} was edited in Luma, so its Photoshop character and paragraph runs are replaced by one valid editable style.`,
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
    if (layer.kind === "shape" || layer.kind === "path") return vectorLayersToPsd(doc, layer).reverse();
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
  const preserved = getPhotoshopDocumentMetadata(doc);
  const originalResources = preserved?.imageResources;
  const psd: Psd = {
    width: doc.width,
    height: doc.height,
    bitsPerChannel: 8,
    colorMode: 3, // RGB
    children,
    linkedFiles: preserved?.linkedFiles,
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
  const written = writePsd(psd, {
    psb: report.container === "psb",
    compress: options.compress,
    invalidateTextLayers: true,
    noBackground: true,
  });
  const buffer = mergePhotoshopImageResources(written, preserved?.rawImageResources ?? [], {
    // An RGB source profile still describes the unconverted channel values.
    // Never attach a CMYK/Lab source profile to the RGB compatibility output.
    includeIccProfile: preserved?.header.colorMode === 3 && doc.colorSpace === "srgb",
  });
  return { buffer, report };
}

export function exportPsd(doc: Document, options: PhotoshopExportOptions = {}): ArrayBuffer {
  return exportPhotoshopDocument(doc, options).buffer;
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
