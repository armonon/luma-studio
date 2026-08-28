import { Document, Selection, Transform, affineForLayerTransform, newCanvas, transformPoint } from "./document";
import {
  SparseAlphaSurface,
  AlphaMemoryLimitError,
  assertAlphaScratch,
} from "./alpha-surface";
import type { PixelRect, TileAddress } from "./tile-store";

export type SelectionMode = "replace" | "add" | "subtract" | "intersect";

export type RefineSelectionParams = {
  smooth: number;
  contrast: number;
  shiftEdge: number;
};

function alphaFromImageData(image: ImageData) {
  const alpha = new Uint8Array(image.width * image.height);
  for (let pixel = 0; pixel < alpha.length; pixel += 1) alpha[pixel] = image.data[pixel * 4 + 3];
  return alpha;
}

function imageDataFromAlpha(context: CanvasRenderingContext2D, alpha: Uint8Array | Uint8ClampedArray, width: number, height: number) {
  const image = context.createImageData(width, height);
  for (let pixel = 0; pixel < alpha.length; pixel += 1) {
    const offset = pixel * 4;
    image.data[offset] = 255;
    image.data[offset + 1] = 255;
    image.data[offset + 2] = 255;
    image.data[offset + 3] = alpha[pixel];
  }
  return image;
}

export function alphaSurfaceFromCanvas(mask: HTMLCanvasElement, width = mask.width, height = mask.height) {
  if (mask.width !== width || mask.height !== height) throw new Error("Selection mask dimensions do not match the document");
  const surface = new SparseAlphaSurface(width, height);
  const context = mask.getContext("2d")!;
  for (let row = 0; row < surface.grid.rows; row += 1) {
    for (let column = 0; column < surface.grid.columns; column += 1) {
      const address = surface.grid.address(column, row);
      surface.writeTile(address.key, alphaFromImageData(context.getImageData(address.x, address.y, address.width, address.height)));
    }
  }
  return surface;
}

export function selectionSurface(doc: Pick<Document, "width" | "height" | "selection">) {
  if (!doc.selection) return null;
  if (!doc.selection.surface) {
    if (!doc.selection.mask) throw new Error("Selection has no alpha storage");
    doc.selection.surface = alphaSurfaceFromCanvas(doc.selection.mask, doc.width, doc.height);
  }
  // The canvas is a v1-v4/interchange bridge, not a second live copy. Once
  // tiled alpha exists, releasing it prevents history from cloning a full
  // document mask alongside the sparse surface.
  doc.selection.mask = undefined;
  return doc.selection.surface;
}

export function alphaSurfaceRegionCanvas(surface: SparseAlphaSurface, rect: PixelRect) {
  const width = Math.max(0, Math.ceil(rect.width));
  const height = Math.max(0, Math.ceil(rect.height));
  const canvas = newCanvas(Math.max(1, width), Math.max(1, height));
  if (!width || !height) return canvas;
  const context = canvas.getContext("2d")!;
  const alpha = surface.readRegion(rect);
  context.putImageData(imageDataFromAlpha(context, alpha, width, height), 0, 0);
  return canvas;
}

export function selectionRegionCanvas(doc: Pick<Document, "width" | "height" | "selection">, rect: PixelRect) {
  const surface = selectionSurface(doc);
  if (!surface) return null;
  return alphaSurfaceRegionCanvas(surface, rect);
}

function installSelection(doc: Document, incoming: SparseAlphaSurface, mode: SelectionMode) {
  const current = selectionSurface(doc);
  const surface = mode === "replace" || !current ? incoming : current.combined(incoming, mode);
  doc.selection = { surface, bounds: surface.bounds() };
}

function normalizedShapeBounds(x: number, y: number, width: number, height: number) {
  const left = Math.min(x, x + width);
  const top = Math.min(y, y + height);
  return { x: left, y: top, width: Math.abs(width), height: Math.abs(height) };
}

function rasterizeShape(
  doc: Pick<Document, "width" | "height">,
  shapeBounds: PixelRect,
  feather: number,
  build: (context: CanvasRenderingContext2D) => void,
) {
  const surface = new SparseAlphaSurface(doc.width, doc.height);
  const radius = Number.isFinite(feather) ? Math.max(0, feather) : 0;
  const support = radius > 0 ? Math.ceil(radius * 4) + 2 : 0;
  const care = expandSelectionRegion(
    { x: shapeBounds.x, y: shapeBounds.y, w: shapeBounds.width, h: shapeBounds.height },
    support,
    doc.width,
    doc.height,
  );
  if (!care.w || !care.h) return surface;
  const addresses = surface.grid.tilesIntersecting({ x: care.x, y: care.y, width: care.w, height: care.h });
  const workPadding = support ? support * 2 : 0;
  assertAlphaScratch((surface.tileSize + workPadding * 2) ** 2 * 8);
  for (const address of addresses) {
    const work = {
      x: address.x - workPadding,
      y: address.y - workPadding,
      width: address.width + workPadding * 2,
      height: address.height + workPadding * 2,
    };
    const canvas = newCanvas(work.width, work.height);
    const context = canvas.getContext("2d")!;
    context.translate(-work.x, -work.y);
    context.fillStyle = "white";
    if (radius) context.filter = `blur(${radius}px)`;
    build(context);
    context.filter = "none";
    context.setTransform(1, 0, 0, 1, 0, 0);
    const image = context.getImageData(address.x - work.x, address.y - work.y, address.width, address.height);
    surface.writeTile(address.key, alphaFromImageData(image));
  }
  return surface;
}

export function selectMask(doc: Document, mask: HTMLCanvasElement, mode: SelectionMode = "replace") {
  installSelection(doc, alphaSurfaceFromCanvas(mask, doc.width, doc.height), mode);
}

export function selectTransformedMask(
  doc: Document,
  mask: HTMLCanvasElement,
  transform: Transform,
  mode: SelectionMode = "replace",
) {
  const matrix = affineForLayerTransform(transform);
  const corners = [
    transformPoint(matrix, 0, 0),
    transformPoint(matrix, mask.width, 0),
    transformPoint(matrix, 0, mask.height),
    transformPoint(matrix, mask.width, mask.height),
  ];
  const minX = Math.floor(Math.min(...corners.map((point) => point.x))) - 1;
  const minY = Math.floor(Math.min(...corners.map((point) => point.y))) - 1;
  const maxX = Math.ceil(Math.max(...corners.map((point) => point.x))) + 1;
  const maxY = Math.ceil(Math.max(...corners.map((point) => point.y))) + 1;
  const surface = new SparseAlphaSurface(doc.width, doc.height);
  for (const address of surface.grid.tilesIntersecting({
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  })) {
    const tile = newCanvas(address.width, address.height);
    const context = tile.getContext("2d")!;
    context.setTransform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e - address.x, matrix.f - address.y);
    context.drawImage(mask, 0, 0);
    surface.writeTile(address.key, alphaFromImageData(context.getImageData(0, 0, address.width, address.height)));
  }
  installSelection(doc, surface, mode);
}

export function selectText(
  doc: Document,
  text: string,
  x: number,
  y: number,
  font: string,
  mode: SelectionMode = "replace",
  vertical = false,
) {
  const size = Number(/([\d.]+)px/.exec(font)?.[1] ?? 16);
  const measure = newCanvas(1, 1).getContext("2d")!;
  measure.font = font;
  const lines = text.split("\n");
  const width = vertical ? size * 1.5 : Math.max(size, ...lines.map((line) => measure.measureText(line).width));
  const height = vertical ? Math.max(1, [...text].length) * size : Math.max(1, lines.length) * size * 1.2;
  const surface = rasterizeShape(doc, { x: x - 2, y: y - size - 2, width: width + 4, height: height + size + 4 }, 0, (context) => {
    context.font = font;
    context.textBaseline = "alphabetic";
    if (vertical) [...text].forEach((character, index) => context.fillText(character, x, y + index * size));
    else lines.forEach((line, index) => context.fillText(line, x, y + index * size * 1.2));
  });
  installSelection(doc, surface, mode);
}

export function selectRect(
  doc: Document,
  x: number,
  y: number,
  w: number,
  h: number,
  mode: SelectionMode = "replace",
  feather = 0,
) {
  const bounds = normalizedShapeBounds(x, y, w, h);
  const surface = new SparseAlphaSurface(doc.width, doc.height);
  if (feather > 0) {
    installSelection(doc, rasterizeShape(doc, bounds, feather, (context) => context.fillRect(bounds.x, bounds.y, bounds.width, bounds.height)), mode);
  } else {
    surface.fillRect(bounds, 255);
    installSelection(doc, surface, mode);
  }
}

export function selectEllipse(
  doc: Document,
  x: number,
  y: number,
  w: number,
  h: number,
  mode: SelectionMode = "replace",
  feather = 0,
) {
  const bounds = normalizedShapeBounds(x, y, w, h);
  const surface = rasterizeShape(doc, bounds, feather, (context) => {
    context.beginPath();
    context.ellipse(x + w / 2, y + h / 2, Math.abs(w) / 2, Math.abs(h) / 2, 0, 0, Math.PI * 2);
    context.fill();
  });
  installSelection(doc, surface, mode);
}

export function selectLasso(
  doc: Document,
  points: Array<{ x: number; y: number }>,
  mode: SelectionMode = "replace",
  feather = 0,
) {
  if (points.length < 3) return;
  const minX = Math.min(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxX = Math.max(...points.map((point) => point.x));
  const maxY = Math.max(...points.map((point) => point.y));
  const surface = rasterizeShape(doc, { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }, feather, (context) => {
    context.beginPath();
    context.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index += 1) context.lineTo(points[index].x, points[index].y);
    context.closePath();
    context.fill();
  });
  installSelection(doc, surface, mode);
}

// Magic wand: pick color at (x,y) in the given source bitmap and flood-select
// pixels within `tolerance` (0..255) using a simple queue-based flood fill.
export function selectByColor(
  doc: Document,
  source: HTMLCanvasElement,
  x: number,
  y: number,
  tolerance: number,
  mode: SelectionMode = "replace",
  contiguous = true,
) {
  if (source.width !== doc.width || source.height !== doc.height) throw new Error("Magic-wand source must be in document coordinates");
  selectByColorTiled(doc, {
    readRegion: (rect) => source.getContext("2d")!.getImageData(rect.x, rect.y, rect.width, rect.height),
  }, x, y, tolerance, mode, contiguous);
}

export type TiledColorSource = {
  readRegion(rect: { x: number; y: number; width: number; height: number }): ImageData;
};

/** Tile-cached scanline flood fill. Source and visited data are never stored as
 * document-sized arrays; dense pathological selections hit the alpha surface's
 * explicit memory ceiling and an oversized frontier fails before installation. */
export function selectByColorTiled(
  doc: Document,
  source: TiledColorSource,
  x: number,
  y: number,
  tolerance: number,
  mode: SelectionMode = "replace",
  contiguous = true,
) {
  const surface = new SparseAlphaSurface(doc.width, doc.height);
  const sourceCache = new Map<string, ImageData>();
  const alphaCache = new Map<string, { data: Uint8Array; dirty: boolean }>();
  const cacheLimit = 32;
  const touch = <T>(cache: Map<string, T>, key: string, value: T) => {
    cache.delete(key);
    cache.set(key, value);
  };
  const flushAlpha = (key: string, entry: { data: Uint8Array; dirty: boolean }) => {
    if (entry.dirty) surface.writeTile(key, entry.data);
  };
  const trim = () => {
    while (sourceCache.size > cacheLimit) sourceCache.delete(sourceCache.keys().next().value!);
    while (alphaCache.size > cacheLimit) {
      const key = alphaCache.keys().next().value!;
      const entry = alphaCache.get(key)!;
      flushAlpha(key, entry);
      alphaCache.delete(key);
    }
  };
  const sourceTile = (px: number, py: number) => {
    const address = surface.grid.addressForPixel(px, py)!;
    let image = sourceCache.get(address.key);
    if (!image) image = source.readRegion(address);
    touch(sourceCache, address.key, image);
    trim();
    return { address, image };
  };
  const rgbaAt = (px: number, py: number) => {
    const { address, image } = sourceTile(px, py);
    const offset = ((py - address.y) * address.width + px - address.x) * 4;
    return [image.data[offset], image.data[offset + 1], image.data[offset + 2]] as const;
  };
  const alphaTile = (px: number, py: number) => {
    const address = surface.grid.addressForPixel(px, py)!;
    let entry = alphaCache.get(address.key);
    if (!entry) entry = { data: surface.readTile(address.key), dirty: false };
    touch(alphaCache, address.key, entry);
    trim();
    return { address, entry };
  };
  const selected = (px: number, py: number) => {
    const { address, entry } = alphaTile(px, py);
    return entry.data[(py - address.y) * address.width + px - address.x] > 0;
  };
  const mark = (px: number, py: number) => {
    const { address, entry } = alphaTile(px, py);
    entry.data[(py - address.y) * address.width + px - address.x] = 255;
    entry.dirty = true;
  };
  const seedX = Math.max(0, Math.min(doc.width - 1, Math.round(x)));
  const seedY = Math.max(0, Math.min(doc.height - 1, Math.round(y)));
  const seed = rgbaAt(seedX, seedY);
  const threshold = Math.max(0, tolerance) ** 2 * 3;
  const matches = (px: number, py: number) => {
    const color = rgbaAt(px, py);
    const dr = color[0] - seed[0];
    const dg = color[1] - seed[1];
    const db = color[2] - seed[2];
    return dr * dr + dg * dg + db * db <= threshold;
  };

  if (contiguous) {
    const stack: number[] = [seedY * doc.width + seedX];
    const stackCeiling = 4_000_000;
    const push = (px: number, py: number) => {
      if (stack.length >= stackCeiling) throw new AlphaMemoryLimitError("Magic Wand frontier exceeds its 32 MB safety ceiling");
      stack.push(py * doc.width + px);
    };
    while (stack.length) {
      const point = stack.pop()!;
      const py = Math.floor(point / doc.width);
      const px = point - py * doc.width;
      if (selected(px, py) || !matches(px, py)) continue;
      let left = px;
      while (left > 0 && !selected(left - 1, py) && matches(left - 1, py)) left -= 1;
      let spanUp = false;
      let spanDown = false;
      for (let scan = left; scan < doc.width && !selected(scan, py) && matches(scan, py); scan += 1) {
        mark(scan, py);
        if (py > 0) {
          const matchUp = !selected(scan, py - 1) && matches(scan, py - 1);
          if (matchUp && !spanUp) push(scan, py - 1);
          spanUp = matchUp;
        }
        if (py + 1 < doc.height) {
          const matchDown = !selected(scan, py + 1) && matches(scan, py + 1);
          if (matchDown && !spanDown) push(scan, py + 1);
          spanDown = matchDown;
        }
      }
    }
  } else {
    for (let row = 0; row < surface.grid.rows; row += 1) for (let column = 0; column < surface.grid.columns; column += 1) {
      const address = surface.grid.address(column, row);
      const alpha = new Uint8Array(address.width * address.height);
      for (let py = address.y; py < address.y + address.height; py += 1) for (let px = address.x; px < address.x + address.width; px += 1) {
        if (matches(px, py)) alpha[(py - address.y) * address.width + px - address.x] = 255;
      }
      surface.writeTile(address.key, alpha);
    }
  }
  for (const [key, entry] of alphaCache) flushAlpha(key, entry);
  installSelection(doc, surface, mode);
}

export function selectAll(doc: Document) {
  doc.selection = {
    surface: new SparseAlphaSurface(doc.width, doc.height, { defaultAlpha: 255 }),
    bounds: { x: 0, y: 0, w: doc.width, h: doc.height },
  };
}

export function deselect(doc: Document) {
  doc.selection = null;
}

export function invertSelection(doc: Document) {
  const current = selectionSurface(doc) ?? new SparseAlphaSurface(doc.width, doc.height);
  const surface = current.inverted();
  doc.selection = { surface, bounds: surface.bounds() };
}

type SelectionRegion = { x: number; y: number; w: number; h: number };

function expandSelectionRegion(
  region: SelectionRegion,
  padding: number,
  width: number,
  height: number,
): SelectionRegion {
  const x = Math.max(0, Math.floor(region.x - padding));
  const y = Math.max(0, Math.floor(region.y - padding));
  const right = Math.min(width, Math.ceil(region.x + region.w + padding));
  const bottom = Math.min(height, Math.ceil(region.y + region.h + padding));
  return { x, y, w: Math.max(0, right - x), h: Math.max(0, bottom - y) };
}

export type FeatherSelectionPlan = {
  support: number;
  care: SelectionRegion;
  work: SelectionRegion;
};

/**
 * Plan bounded scratch space for Canvas2D's Gaussian blur. Four standard
 * deviations plus two rounding pixels cover every sample that can contribute
 * a non-zero 8-bit alpha. A second support-width halo keeps the output area
 * away from scratch-canvas clipping. `work` is intentionally allowed outside
 * document coordinates: those pixels model the transparent image exterior.
 */
export function planFeatherSelection(
  bounds: SelectionRegion,
  width: number,
  height: number,
  radius: number,
): FeatherSelectionPlan {
  const support = Math.max(1, Math.ceil(radius * 4) + 2);
  const care = expandSelectionRegion(bounds, support, width, height);
  const workPadding = support * 2;
  const work = {
    x: Math.floor(bounds.x - workPadding),
    y: Math.floor(bounds.y - workPadding),
    w: Math.max(1, Math.ceil(bounds.w + workPadding * 2)),
    h: Math.max(1, Math.ceil(bounds.h + workPadding * 2)),
  };
  return { support, care, work };
}

export function featherSelection(doc: Document, radius: number) {
  if (!doc.selection || radius <= 0 || !Number.isFinite(radius)) return;
  const currentBounds = doc.selection.bounds;
  if (currentBounds.w <= 0 || currentBounds.h <= 0) return;
  const surface = selectionSurface(doc)!;
  const result = featherAlphaSurface(surface, currentBounds, radius);
  doc.selection = { surface: result, bounds: result.bounds() };
}

export function featherAlphaSurface(
  surface: SparseAlphaSurface,
  bounds: Selection["bounds"],
  radius: number,
) {
  if (radius <= 0 || !Number.isFinite(radius) || bounds.w <= 0 || bounds.h <= 0) return surface.clone();
  const support = Math.max(1, Math.ceil(radius * 4) + 2);
  const workPadding = support * 2;
  assertAlphaScratch((surface.tileSize + workPadding * 2) ** 2 * 8);
  const candidates = new Map<string, TileAddress>();
  for (const address of surface.addressesAroundRecords(support)) candidates.set(address.key, address);
  // A surface that is opaque by default (Select All, say) has no records for
  // the blur to gather around, so the document border is the only edge in the
  // image — and the ramp runs `support` pixels inward from it, which is more
  // than one tile at any generous radius.
  if (surface.defaultAlpha > 0) {
    const rings = Math.ceil(support / surface.tileSize);
    for (const address of surface.edgeAddresses(rings)) candidates.set(address.key, address);
  }
  const result = surface.clone();
  for (const address of candidates.values()) {
    const work = {
      x: address.x - workPadding,
      y: address.y - workPadding,
      width: address.width + workPadding * 2,
      height: address.height + workPadding * 2,
    };
    const sourceCanvas = newCanvas(work.width, work.height);
    const sourceContext = sourceCanvas.getContext("2d")!;
    const sourceAlpha = surface.readRegion(work);
    sourceContext.putImageData(imageDataFromAlpha(sourceContext, sourceAlpha, work.width, work.height), 0, 0);
    const blurred = newCanvas(work.width, work.height);
    const blurredContext = blurred.getContext("2d")!;
    blurredContext.filter = `blur(${radius}px)`;
    blurredContext.drawImage(sourceCanvas, 0, 0);
    blurredContext.filter = "none";
    const image = blurredContext.getImageData(workPadding, workPadding, address.width, address.height);
    result.writeTile(address.key, alphaFromImageData(image));
  }
  return result;
}

function boxPass(source: Uint8ClampedArray, width: number, height: number, radius: number, horizontal: boolean) {
  const output = new Uint8ClampedArray(source.length);
  const major = horizontal ? height : width;
  const minor = horizontal ? width : height;
  for (let line = 0; line < major; line += 1) {
    const prefix = new Uint32Array(minor + 1);
    for (let index = 0; index < minor; index += 1) {
      const offset = horizontal ? line * width + index : index * width + line;
      prefix[index + 1] = prefix[index] + source[offset];
    }
    for (let index = 0; index < minor; index += 1) {
      const start = Math.max(0, index - radius);
      const end = Math.min(minor, index + radius + 1);
      const offset = horizontal ? line * width + index : index * width + line;
      output[offset] = Math.round((prefix[end] - prefix[start]) / (end - start));
    }
  }
  return output;
}

function morphologyPass(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
  horizontal: boolean,
  grow: boolean,
) {
  const output = new Uint8ClampedArray(source.length);
  const major = horizontal ? height : width;
  const minor = horizontal ? width : height;
  for (let line = 0; line < major; line += 1) {
    for (let index = 0; index < minor; index += 1) {
      let value = grow ? 0 : 255;
      for (let sample = Math.max(0, index - radius); sample <= Math.min(minor - 1, index + radius); sample += 1) {
        const offset = horizontal ? line * width + sample : sample * width + line;
        value = grow ? Math.max(value, source[offset]) : Math.min(value, source[offset]);
      }
      const offset = horizontal ? line * width + index : index * width + line;
      output[offset] = value;
    }
  }
  return output;
}

export function refineSelectionAlpha(
  alpha: Uint8ClampedArray,
  width: number,
  height: number,
  params: RefineSelectionParams,
) {
  let output = new Uint8ClampedArray(alpha);
  const shiftRadius = Math.min(16, Math.round(Math.abs(params.shiftEdge) / 6.25));
  if (shiftRadius) {
    const grow = params.shiftEdge > 0;
    output = morphologyPass(output, width, height, shiftRadius, true, grow);
    output = morphologyPass(output, width, height, shiftRadius, false, grow);
  }
  const smoothRadius = Math.min(32, Math.round(params.smooth));
  if (smoothRadius) {
    output = boxPass(output, width, height, smoothRadius, true);
    output = boxPass(output, width, height, smoothRadius, false);
  }
  const contrast = Math.max(0, Math.min(100, params.contrast));
  if (contrast) {
    const factor = 1 + contrast / 20;
    for (let index = 0; index < output.length; index += 1) {
      output[index] = Math.max(0, Math.min(255, Math.round(127.5 + (output[index] - 127.5) * factor)));
    }
  }
  return output;
}

export function refineSelection(doc: Document, params: RefineSelectionParams) {
  if (!doc.selection) return false;
  const currentBounds = doc.selection.bounds;
  if (currentBounds.w <= 0 || currentBounds.h <= 0) return true;
  const surface = selectionSurface(doc)!;

  const requestedShiftRadius = Math.min(16, Math.round(Math.abs(params.shiftEdge) / 6.25));
  const requestedSmoothRadius = Math.min(32, Math.round(params.smooth));
  const shiftRadius = Number.isFinite(requestedShiftRadius) ? Math.max(0, requestedShiftRadius) : 0;
  const smoothRadius = Number.isFinite(requestedSmoothRadius) ? Math.max(0, requestedSmoothRadius) : 0;
  // Grow and smoothing can create non-zero alpha outside the current bounds.
  // Contraction cannot, though a following smooth pass can spread its result.
  const supportExpansion = (params.shiftEdge > 0 ? shiftRadius : 0) + smoothRadius;
  const dependencyRadius = shiftRadius + smoothRadius;
  assertAlphaScratch((surface.tileSize + dependencyRadius * 2) ** 2 * 4);
  const result = surface.clone();
  const candidates = surface.addressesAroundRecords(supportExpansion);
  for (const address of candidates) {
    const work = expandSelectionRegion(
      { x: address.x, y: address.y, w: address.width, h: address.height },
      dependencyRadius,
      surface.width,
      surface.height,
    );
    const alpha = surface.readRegion({ x: work.x, y: work.y, width: work.w, height: work.h });
    const refined = refineSelectionAlpha(alpha, work.w, work.h, params);
    const tile = new Uint8Array(address.width * address.height);
    const localX = address.x - work.x;
    const localY = address.y - work.y;
    for (let y = 0; y < address.height; y += 1) {
      tile.set(
        refined.subarray((localY + y) * work.w + localX, (localY + y) * work.w + localX + address.width),
        y * address.width,
      );
    }
    result.writeTile(address.key, tile);
  }
  doc.selection = { surface: result, bounds: result.bounds() };
  return true;
}

function boundsOf(mask: HTMLCanvasElement) {
  const ctx = mask.getContext("2d")!;
  const img = ctx.getImageData(0, 0, mask.width, mask.height);
  const d = img.data;
  let minX = mask.width;
  let minY = mask.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      if (d[(y * mask.width + x) * 4 + 3] > 0) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

export { boundsOf };

// Marching-ants overlay: draw the selection outline into the given ctx.
export function drawSelectionOutline(
  ctx: CanvasRenderingContext2D,
  sel: Selection,
  offset: number,
) {
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 4]);
  ctx.lineDashOffset = -offset;
  ctx.strokeRect(
    sel.bounds.x + 0.5,
    sel.bounds.y + 0.5,
    Math.max(1, sel.bounds.w - 1),
    Math.max(1, sel.bounds.h - 1),
  );
  ctx.restore();
}
