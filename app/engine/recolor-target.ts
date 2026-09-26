import { affineForLayerTransform, inverseAffineForLayerTransform, type Document, type Layer } from "./document";
import { SparseAlphaSurface } from "./alpha-surface";
import { RECOLOR_BUFFER_MAX_PIXELS, RECOLOR_MAX_PIXELS } from "./recolor";
import type { PixelRect } from "./tile-store";

export type RecolorOutput = "copy" | "pixels" | "selection" | "mask-keep" | "mask-remove";
export type RecolorProgress = { signal?: AbortSignal; onProgress?: (fraction: number) => void };
export type RecolorSession = {
  layerId: string; documentId: string; name: string; width: number; height: number;
  preview: ImageData; selection?: Uint8Array; assertCurrent: () => void; release: () => void;
};
export function recolorUnavailableReason(doc: Document, layer?: Layer) {
  if (!layer || layer.kind !== "raster" || !layer.bitmap) return "Select a raster layer to recolor. Rasterize a copy of other layer types first.";
  if (layer.locked) return "Unlock the layer before recoloring.";
  if (doc.bitDepth !== 8 || doc.colorSpace !== "srgb" || layer.raw) return "Recolor currently supports 8-bit sRGB raster layers; high-depth and RAW masters are not downconverted.";
  if (layer.spatial?.enabled || layer.surface?.store.sourceState()) return "Projected or disk-backed sources must be rendered to a bounded raster copy first.";
  if (layer.bitmap.width*layer.bitmap.height>RECOLOR_MAX_PIXELS || layer.bitmap.width>16384 || layer.bitmap.height>16384 ||
      (layer.surface && (layer.bitmap.width!==layer.surface.grid.width || layer.bitmap.height!==layer.surface.grid.height))) return "Recolor supports full-resolution raster layers up to 50 MP, not large-document preview proxies.";
  if (!inverseAffineForLayerTransform(layer.transform)) return "The layer transform cannot be inverted.";
  return null;
}

export function recolorSelectionWeights(surface: SparseAlphaSurface | null, layer: Layer, width: number, height: number, region?: PixelRect) {
  if (!surface) return undefined;
  const a=affineForLayerTransform(layer.transform), out=new Uint8Array(width*height);
  const sx=(region?.width??layer.bitmap!.width)/width, sy=(region?.height??layer.bitmap!.height)/height;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
    const px=(region?.x??0)+(x+.5)*sx, py=(region?.y??0)+(y+.5)*sy;
    out[y*width+x]=surface.sample(a.a*px+a.c*py+a.e,a.b*px+a.d*py+a.f);
  }
  return out;
}

/** Map only the transformed footprint into sparse document-space alpha. */
export function recolorDocumentMaskBounds(doc: Document, layer: Layer, limit = RECOLOR_MAX_PIXELS) {
  const w=layer.bitmap!.width,h=layer.bitmap!.height,a=affineForLayerTransform(layer.transform);
  const corners=[[0,0],[w,0],[w,h],[0,h]].map(([x,y])=>({x:a.a*x+a.c*y+a.e,y:a.b*x+a.d*y+a.f}));
  const left=Math.max(0,Math.floor(Math.min(...corners.map(p=>p.x)))),top=Math.max(0,Math.floor(Math.min(...corners.map(p=>p.y))));
  const right=Math.min(doc.width,Math.ceil(Math.max(...corners.map(p=>p.x)))),bottom=Math.min(doc.height,Math.ceil(Math.max(...corners.map(p=>p.y))));
  if (!corners.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)) || Math.max(0,right-left)*Math.max(0,bottom-top)>limit) throw new Error(`The transformed recolor selection exceeds its ${limit/1_000_000} MP working-area limit`);
  return {x:left,y:top,width:Math.max(0,right-left),height:Math.max(0,bottom-top)};
}

/** Small-buffer adapter kept for callers that already own an alpha array. */
export function recolorDocumentMask(doc: Document, layer: Layer, mask: Uint8Array) {
  const w=layer.bitmap!.width,h=layer.bitmap!.height,inverse=inverseAffineForLayerTransform(layer.transform)!;
  if(w*h>RECOLOR_BUFFER_MAX_PIXELS || mask.length!==w*h)throw new Error("Use tiled recolor alpha for large layers");
  const bounds=recolorDocumentMaskBounds(doc,layer,RECOLOR_BUFFER_MAX_PIXELS);
  const surface=new SparseAlphaSurface(doc.width,doc.height);
  for(const tile of surface.grid.tilesIntersecting(bounds)) {
    const data=new Uint8Array(tile.width*tile.height);
    for(let y=0;y<tile.height;y++)for(let x=0;x<tile.width;x++) {
      const dx=tile.x+x+.5,dy=tile.y+y+.5;
      const sx=Math.floor(inverse.a*dx+inverse.c*dy+inverse.e),sy=Math.floor(inverse.b*dx+inverse.d*dy+inverse.f);
      if(sx>=0&&sy>=0&&sx<w&&sy<h)data[y*tile.width+x]=mask[sy*w+sx];
    }
    surface.writeTile(tile.key,data);
  }
  return surface;
}
