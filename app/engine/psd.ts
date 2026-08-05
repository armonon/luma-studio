// PSD import/export via ag-psd. This is real read/write — layers, masks, blend
// modes, opacity, transforms all preserved on export. Import supports layered
// PSDs by mapping ag-psd layers to raster layers with per-layer bitmaps.

import { readPsd, writePsd, Psd, Layer as PsdLayer, BlendMode as PsdBlend } from "ag-psd";
import {
  BlendMode,
  BLEND_LABELS,
  Document,
  Layer,
  createRasterLayer,
  createGroupLayer,
  drawLayerContent,
  newCanvas,
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
      group.visible = !layer.hidden;
      const groupBlend = layer.blendMode?.toLowerCase();
      if (groupBlend && PSD_TO_BLEND[groupBlend]) group.blend = PSD_TO_BLEND[groupBlend];
      for (const c of layer.children) visit(c, group.id);
      doc.layers.unshift(group);
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
    l.parentId = parentId;
    l.opacity = (layer.opacity ?? 255) / 255;
    l.visible = !layer.hidden;
    const bm = layer.blendMode?.toLowerCase();
    if (bm && PSD_TO_BLEND[bm]) l.blend = PSD_TO_BLEND[bm];
    l.clipping = layer.clipping;
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

export function exportPsd(doc: Document): ArrayBuffer {
  // One Luma blend stack exports as repeated PSD layers, preserving the same
  // bottom-to-top pass order and per-pass opacity in Photoshop.
  const serializeLayer = (layer: Layer): PsdLayer[] => {
    if (layer.kind.startsWith("adjustment-")) return [];
    if (layer.kind === "group") {
      const children = doc.layers
        .filter((candidate) => candidate.parentId === layer.id)
        .flatMap(serializeLayer)
        .reverse();
      return [{
        name: layer.name,
        children,
        opened: true,
        opacity: Math.round(layer.opacity * 255),
        hidden: !layer.visible,
        blendMode: BLEND_TO_PSD[layer.blend],
      }];
    }
    const canvas = flattenLayerBitmap(doc, layer);
    if (!canvas) return [];
    const passes = resolvedBlendPasses(layer).filter((pass) => pass.enabled && pass.opacity > 0);
    return passes.map((pass) => ({
      name: passes.length > 1 ? `${layer.name} · ${BLEND_LABELS[pass.mode]}` : layer.name,
      canvas,
      opacity: Math.round(layer.opacity * pass.opacity * 255),
      hidden: !layer.visible,
      blendMode: BLEND_TO_PSD[pass.mode],
      clipping: layer.clipping,
      mask: layer.mask ? {
        canvas: layer.mask,
        top: 0,
        left: 0,
        bottom: doc.height,
        right: doc.width,
        defaultColor: 255,
      } : undefined,
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
