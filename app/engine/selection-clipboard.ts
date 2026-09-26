import { newCanvas, type Document, type Layer } from "./document";
import { renderViewport } from "./renderer";
import { selectionRegionCanvas } from "./selection";

export type PixelClipboard = { canvas: HTMLCanvasElement; x: number; y: number; sourceWidth: number; sourceHeight: number };
export const MAX_CLIPBOARD_PIXELS = 16 * 1024 * 1024;

export function clipboardRegion(doc: Document) {
  const bounds = doc.selection?.bounds ?? { x: 0, y: 0, w: doc.width, h: doc.height };
  const x = Math.max(0, Math.floor(bounds.x));
  const y = Math.max(0, Math.floor(bounds.y));
  const width = Math.min(doc.width, Math.ceil(bounds.x + bounds.w)) - x;
  const height = Math.min(doc.height, Math.ceil(bounds.y + bounds.h)) - y;
  if (width <= 0 || height <= 0) throw new Error("The selection is empty");
  if (width > 16384 || height > 16384 || width * height > MAX_CLIPBOARD_PIXELS) {
    throw new Error("Copy is limited to 16 megapixels per selection. Select a smaller region; the document has not changed.");
  }
  return { x, y, width, height };
}

/** Clipboard pixels are an explicitly flattened 8-bit display-RGB snapshot. */
export function captureSelectedPixels(doc: Document, layer?: Layer): PixelClipboard {
  const region = clipboardRegion(doc);
  if (layer?.kind === "group" || layer?.kind.startsWith("adjustment-")) throw new Error("Use Copy Merged for groups and adjustments");
  const canvas = newCanvas(region.width, region.height);
  const source = layer ? { ...doc, layers: [{ ...layer, parentId: undefined, clipping: false, visible: true }], selection: null } : doc;
  renderViewport(source, canvas, { ...region, outputWidth: region.width, outputHeight: region.height, zoom: 1, cssScale: 1, devicePixelRatio: 1 },
    { checkerboard: false, selectionOverlay: false, proofing: false });
  const mask = selectionRegionCanvas(doc, region);
  if (mask) {
    const context = canvas.getContext("2d")!;
    context.globalCompositeOperation = "destination-in";
    context.drawImage(mask, 0, 0);
    context.globalCompositeOperation = "source-over";
  }
  // Check tilewise: no second selection-sized RGBA allocation for empty checks.
  const context = canvas.getContext("2d")!;
  let visible = false;
  for (let y = 0; !visible && y < canvas.height; y += 128) {
    const pixels = context.getImageData(0, y, canvas.width, Math.min(128, canvas.height - y)).data;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) { visible = true; break; }
  }
  if (!visible) throw new Error("No visible pixels inside the selection");
  return { canvas, x: region.x, y: region.y, sourceWidth: doc.width, sourceHeight: doc.height };
}
