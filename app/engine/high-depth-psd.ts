import type { Layer as PsdLayer, Psd } from "ag-psd";
import { type Document, resolvedBlendPasses, resolvedFillOpacity } from "./document";
import { workingToDisplaySrgb } from "./color";
import { getPhotoshopLayerMetadata } from "./psd-metadata";
import { writeNativeHighDepthRgbPsd } from "./ag-psd-io";

export function highDepthExportBytes(doc: Document) {
  const samples = doc.layers.reduce((sum, layer) => sum + (layer.surface ? layer.surface.grid.width * layer.surface.grid.height : 0), 0);
  // Input planes, writer's growing buffer, final buffer and merged float plane.
  const masks = doc.layers.filter(layer => layer.maskSurface).length * doc.width * doc.height;
  return samples * 80 + masks * 16 + doc.width * doc.height * 64 + 4 * 1024 * 1024;
}

export function highDepthEligibility(doc: Document): { eligible: true } | { eligible: false; reason: string } {
  if (doc.bitDepth !== 16 && doc.bitDepth !== 32) return { eligible: false, reason: "not a high-depth document" };
  if (doc.colorSpace !== "srgb") return { eligible: false, reason: "the native writer currently supports sRGB primaries only" };
  if (!doc.layers.length || doc.layers.length > 128 || doc.width * doc.height > 8_000_000 || highDepthExportBytes(doc) > 384 * 1024 * 1024) return { eligible: false, reason: "the high-depth writer's layer, pixel or working-memory bound is exceeded" };
  for (const layer of doc.layers) {
    const t = layer.transform, passes = resolvedBlendPasses(layer).filter(pass => pass.enabled && pass.opacity > 0);
    const source = getPhotoshopLayerMetadata(layer)?.source;
    if (layer.kind !== "raster" || !layer.surface || layer.surface.format === "rgba8" || layer.surface.colorSpace !== doc.colorSpace || layer.surface.store.sourceState() || layer.parentId ||
        layer.mask || (layer.maskSurface && (layer.maskSurface.width !== doc.width || layer.maskSurface.height !== doc.height)) || layer.vectorMask || layer.spatial?.enabled || layer.raw || layer.clipping || layer.blendIf || layer.blendChannels || (layer.knockout ?? "none") !== "none" ||
        layer.filters?.some(filter => filter.enabled) || layer.effects?.some(effect => effect.enabled) || passes.length !== 1 || passes[0].mode !== "source-over" || passes[0].opacity !== 1 ||
        !Number.isFinite(layer.opacity) || layer.opacity < 0 || layer.opacity > 1 || resolvedFillOpacity(layer) !== 1 ||
        !Number.isInteger(t.tx) || !Number.isInteger(t.ty) || t.sx !== 1 || t.sy !== 1 || t.rotation !== 0 || (t.skewX ?? 0) !== 0 ||
        source?.effects || source?.adjustment || source?.placedLayer || source?.filterMask || source?.filterEffectsMasks || source?.vectorMask) {
      return { eligible: false, reason: "the layer stack requires unsupported high-depth blending, resampling, masks, effects or non-raster descriptors" };
    }
  }
  const base = doc.layers[doc.layers.length - 1], surface = base.surface!;
  if (!base.visible || base.opacity !== 1 || base.maskSurface || base.transform.tx !== 0 || base.transform.ty !== 0 || surface.grid.width !== doc.width || surface.grid.height !== doc.height) return { eligible: false, reason: "an opaque unmasked full-canvas bottom layer is required for the native composite" };
  // Deliberately validate without allocating an image-sized scratch buffer.
  for (let y = 0; y < doc.height; y++) for (let x = 0; x < doc.width; x++) {
    if (surface.readPixel(x, y)[3] !== 1) return { eligible: false, reason: "the bottom layer contains transparency" };
  }
  return { eligible: true };
}

export function exportHighDepthRgb(doc: Document, format: "psd" | "psb") {
  const gate = highDepthEligibility(doc);
  if (!gate.eligible) throw new Error(gate.reason);
  const depth = doc.bitDepth as 16 | 32, bytesPerSample = depth / 8;
  const merged = new Float32Array(doc.width * doc.height * 3);
  const children: PsdLayer[] = [];
  const encode = (view: DataView, index: number, value: number) => {
    if (!Number.isFinite(value) || (depth === 16 && (value < -1e-6 || value > 1.000001))) throw new Error("High-depth export contains non-finite or out-of-range samples; save the Luma master instead");
    if (depth === 16) view.setUint16(index * 2, Math.round(Math.max(0, Math.min(1, value)) * 65535), false);
    else view.setFloat32(index * 4, value, false);
  };
  for (const layer of [...doc.layers].reverse()) {
    const surface = layer.surface!, width = surface.grid.width, height = surface.grid.height;
    const planes = Array.from({ length: 4 }, () => new Uint8Array(width * height * bytesPerSample));
    const views = planes.map(plane => new DataView(plane.buffer));
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const pixel = surface.readPixel(x, y), index = y * width + x;
      if (!Number.isFinite(pixel[3]) || pixel[3] < 0 || pixel[3] > 1) throw new Error("Invalid native layer alpha");
      const rgb = depth === 32 ? pixel.slice(0, 3) : workingToDisplaySrgb([pixel[0], pixel[1], pixel[2]], doc.colorSpace);
      for (let c = 0; c < 3; c++) encode(views[c], index, rgb[c]);
      encode(views[3], index, pixel[3]);
      const dx = x + layer.transform.tx, dy = y + layer.transform.ty;
      if (layer.visible && dx >= 0 && dy >= 0 && dx < doc.width && dy < doc.height) {
        // Match the opacity actually encoded in Photoshop's 8-bit metadata.
        const alpha = pixel[3] * Math.round(layer.opacity * 255) / 255 * (layer.maskSurface ? layer.maskSurface.sample(dx, dy) / 255 : 1);
        const out = (dy * doc.width + dx) * 3;
        for (let c = 0; c < 3; c++) merged[out + c] = rgb[c] * alpha + merged[out + c] * (1 - alpha);
      }
    }
    const channels = planes.map((data, index) => ({ id: [0, 1, 2, -1][index], compression: 0, data }));
    let mask: PsdLayer["mask"];
    if (layer.maskSurface) {
      const data = new Uint8Array(doc.width * doc.height * bytesPerSample), view = new DataView(data.buffer);
      for (let y = 0; y < doc.height; y++) for (let x = 0; x < doc.width; x++) encode(view, y * doc.width + x, layer.maskSurface.sample(x, y) / 255);
      channels.push({ id: -2, compression: 0, data });
      mask = { left: 0, top: 0, right: doc.width, bottom: doc.height, defaultColor: layer.maskSurface.defaultAlpha, positionRelativeToLayer: false };
    }
    children.push({ name: layer.name, opacity: layer.opacity, hidden: !layer.visible, blendMode: "normal", mask,
      transparencyProtected: layer.locked, left: layer.transform.tx, top: layer.transform.ty, right: layer.transform.tx + width, bottom: layer.transform.ty + height,
      rawData: { colorMode: 3, bitsPerChannel: depth, large: format === "psb", channels } });
  }
  const composite = [new Uint8Array(doc.width * doc.height * bytesPerSample), new Uint8Array(doc.width * doc.height * bytesPerSample), new Uint8Array(doc.width * doc.height * bytesPerSample)] as const;
  const views = composite.map(plane => new DataView(plane.buffer));
  for (let i = 0; i < doc.width * doc.height; i++) for (let c = 0; c < 3; c++) encode(views[c], i, merged[i * 3 + c]);
  const psd: Psd = { width: doc.width, height: doc.height, bitsPerChannel: depth, colorMode: 3, children,
    imageResources: { resolutionInfo: { horizontalResolution: doc.resolution.x, horizontalResolutionUnit: "PPI", widthUnit: "Inches", verticalResolution: doc.resolution.y, verticalResolutionUnit: "PPI", heightUnit: "Inches" },
      gridAndGuidesInformation: { guides: doc.guides.map(guide => ({ location: guide.position, direction: guide.orientation })) } } };
  return writeNativeHighDepthRgbPsd(psd, composite, { psb: format === "psb" });
}
