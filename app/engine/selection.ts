import { Document, Selection, newCanvas } from "./document";

export type SelectionMode = "replace" | "add" | "subtract" | "intersect";

export type RefineSelectionParams = {
  smooth: number;
  contrast: number;
  shiftEdge: number;
};

// Convert path-defined selection into an alpha mask on `doc.selection`.
// `path` is a callback that draws into a 2D ctx with the source mask fill.
function combine(
  doc: Document,
  build: (ctx: CanvasRenderingContext2D) => void,
  mode: SelectionMode,
) {
  const w = doc.width;
  const h = doc.height;
  const newMask = newCanvas(w, h);
  const nctx = newMask.getContext("2d")!;
  nctx.fillStyle = "white";
  build(nctx);

  if (mode === "replace" || !doc.selection) {
    doc.selection = { mask: newMask, bounds: boundsOf(newMask) };
    return;
  }
  const current = doc.selection.mask;
  const cctx = current.getContext("2d")!;
  if (mode === "add") {
    cctx.globalCompositeOperation = "source-over";
    cctx.drawImage(newMask, 0, 0);
  } else if (mode === "subtract") {
    cctx.globalCompositeOperation = "destination-out";
    cctx.drawImage(newMask, 0, 0);
  } else if (mode === "intersect") {
    cctx.globalCompositeOperation = "destination-in";
    cctx.drawImage(newMask, 0, 0);
  }
  cctx.globalCompositeOperation = "source-over";
  doc.selection = { mask: current, bounds: boundsOf(current) };
}

export function selectMask(doc: Document, mask: HTMLCanvasElement, mode: SelectionMode = "replace") {
  if (mode === "replace" || !doc.selection) {
    doc.selection = { mask, bounds: boundsOf(mask) };
  } else {
    combine(doc, (context) => context.drawImage(mask, 0, 0), mode);
  }
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
  const mask = newCanvas(doc.width, doc.height);
  const context = mask.getContext("2d")!;
  context.fillStyle = "white";
  context.font = font;
  context.textBaseline = "alphabetic";
  if (vertical) {
    const size = Number(/([\d.]+)px/.exec(font)?.[1] ?? 16);
    [...text].forEach((character, index) => context.fillText(character, x, y + index * size));
  } else {
    text.split("\n").forEach((line, index) => {
      const size = Number(/([\d.]+)px/.exec(font)?.[1] ?? 16);
      context.fillText(line, x, y + index * size * 1.2);
    });
  }
  selectMask(doc, mask, mode);
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
  combine(
    doc,
    (ctx) => {
      if (feather > 0) ctx.filter = `blur(${feather}px)`;
      ctx.fillRect(x, y, w, h);
      ctx.filter = "none";
    },
    mode,
  );
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
  combine(
    doc,
    (ctx) => {
      if (feather > 0) ctx.filter = `blur(${feather}px)`;
      ctx.beginPath();
      ctx.ellipse(
        x + w / 2,
        y + h / 2,
        Math.abs(w) / 2,
        Math.abs(h) / 2,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.filter = "none";
    },
    mode,
  );
}

export function selectLasso(
  doc: Document,
  points: Array<{ x: number; y: number }>,
  mode: SelectionMode = "replace",
  feather = 0,
) {
  if (points.length < 3) return;
  combine(
    doc,
    (ctx) => {
      if (feather > 0) ctx.filter = `blur(${feather}px)`;
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
      ctx.closePath();
      ctx.fill();
      ctx.filter = "none";
    },
    mode,
  );
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
  const sctx = source.getContext("2d")!;
  const img = sctx.getImageData(0, 0, source.width, source.height);
  const d = img.data;
  const w = source.width;
  const h = source.height;
  const ix = Math.max(0, Math.min(w - 1, Math.round(x)));
  const iy = Math.max(0, Math.min(h - 1, Math.round(y)));
  const seed = (iy * w + ix) * 4;
  const sr = d[seed];
  const sg = d[seed + 1];
  const sb = d[seed + 2];
  const tol = tolerance * tolerance * 3;

  const out = new Uint8ClampedArray(w * h * 4);
  const match = (i: number) => {
    const dr = d[i] - sr;
    const dg = d[i + 1] - sg;
    const db = d[i + 2] - sb;
    return dr * dr + dg * dg + db * db <= tol;
  };

  if (contiguous) {
    // Iterative flood fill using a Uint32 stack of pixel indices.
    const stack: number[] = [iy * w + ix];
    const seen = new Uint8Array(w * h);
    while (stack.length) {
      const p = stack.pop()!;
      if (seen[p]) continue;
      seen[p] = 1;
      const i = p * 4;
      if (!match(i)) continue;
      out[i] = 255;
      out[i + 1] = 255;
      out[i + 2] = 255;
      out[i + 3] = 255;
      const px = p % w;
      const py = (p - px) / w;
      if (px > 0) stack.push(p - 1);
      if (px < w - 1) stack.push(p + 1);
      if (py > 0) stack.push(p - w);
      if (py < h - 1) stack.push(p + w);
    }
  } else {
    for (let p = 0; p < w * h; p++) {
      const i = p * 4;
      if (match(i)) {
        out[i] = 255;
        out[i + 1] = 255;
        out[i + 2] = 255;
        out[i + 3] = 255;
      }
    }
  }

  const mask = newCanvas(w, h);
  mask.getContext("2d")!.putImageData(new ImageData(out, w, h), 0, 0);
  if (mode === "replace" || !doc.selection) {
    doc.selection = { mask, bounds: boundsOf(mask) };
  } else {
    combine(doc, (ctx) => ctx.drawImage(mask, 0, 0), mode);
  }
}

export function selectAll(doc: Document) {
  selectRect(doc, 0, 0, doc.width, doc.height, "replace", 0);
}

export function deselect(doc: Document) {
  doc.selection = null;
}

export function invertSelection(doc: Document) {
  const inv = newCanvas(doc.width, doc.height);
  const ctx = inv.getContext("2d")!;
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, doc.width, doc.height);
  if (doc.selection) {
    ctx.globalCompositeOperation = "destination-out";
    ctx.drawImage(doc.selection.mask, 0, 0);
    ctx.globalCompositeOperation = "source-over";
  }
  doc.selection = { mask: inv, bounds: boundsOf(inv) };
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
  const mask = doc.selection.mask;
  const currentBounds = doc.selection.bounds;
  if (currentBounds.w <= 0 || currentBounds.h <= 0) return;
  const { care, work } = planFeatherSelection(
    currentBounds,
    mask.width,
    mask.height,
    radius,
  );
  const source = newCanvas(work.w, work.h);
  const sourceContext = source.getContext("2d")!;
  const sourceX = Math.max(0, work.x);
  const sourceY = Math.max(0, work.y);
  const sourceRight = Math.min(mask.width, work.x + work.w);
  const sourceBottom = Math.min(mask.height, work.y + work.h);
  const sourceWidth = Math.max(0, sourceRight - sourceX);
  const sourceHeight = Math.max(0, sourceBottom - sourceY);
  if (sourceWidth > 0 && sourceHeight > 0) {
    sourceContext.drawImage(
      mask,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      sourceX - work.x,
      sourceY - work.y,
      sourceWidth,
      sourceHeight,
    );
  }

  const blurred = newCanvas(work.w, work.h);
  const blurredContext = blurred.getContext("2d")!;
  blurredContext.filter = `blur(${radius}px)`;
  blurredContext.drawImage(source, 0, 0);
  blurredContext.filter = "none";
  const localCareX = care.x - work.x;
  const localCareY = care.y - work.y;
  const image = blurredContext.getImageData(localCareX, localCareY, care.w, care.h);
  mask.getContext("2d")!.putImageData(image, care.x, care.y);

  let minX = care.x + care.w;
  let minY = care.y + care.h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < care.h; y += 1) for (let x = 0; x < care.w; x += 1) {
    if (image.data[(y * care.w + x) * 4 + 3] === 0) continue;
    const documentX = care.x + x;
    const documentY = care.y + y;
    minX = Math.min(minX, documentX);
    minY = Math.min(minY, documentY);
    maxX = Math.max(maxX, documentX);
    maxY = Math.max(maxY, documentY);
  }
  doc.selection = {
    mask,
    bounds: maxX < 0
      ? { x: 0, y: 0, w: 0, h: 0 }
      : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
  };
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
  const mask = doc.selection.mask;
  const currentBounds = doc.selection.bounds;
  if (currentBounds.w <= 0 || currentBounds.h <= 0) return true;

  const requestedShiftRadius = Math.min(16, Math.round(Math.abs(params.shiftEdge) / 6.25));
  const requestedSmoothRadius = Math.min(32, Math.round(params.smooth));
  const shiftRadius = Number.isFinite(requestedShiftRadius) ? Math.max(0, requestedShiftRadius) : 0;
  const smoothRadius = Number.isFinite(requestedSmoothRadius) ? Math.max(0, requestedSmoothRadius) : 0;
  // Grow and smoothing can create non-zero alpha outside the current bounds.
  // Contraction cannot, though a following smooth pass can spread its result.
  const supportExpansion = (params.shiftEdge > 0 ? shiftRadius : 0) + smoothRadius;
  const dependencyRadius = shiftRadius + smoothRadius;
  const care = expandSelectionRegion(
    currentBounds,
    supportExpansion,
    mask.width,
    mask.height,
  );
  // The refinement kernels need source context outside the area that can
  // become non-zero. Keeping a complete dependency halo makes this cropped
  // run byte-identical to running the same passes over the whole mask.
  const work = expandSelectionRegion(
    care,
    dependencyRadius,
    mask.width,
    mask.height,
  );
  const context = mask.getContext("2d")!;
  const image = context.getImageData(work.x, work.y, work.w, work.h);
  const alpha = new Uint8ClampedArray(work.w * work.h);
  for (let pixel = 0; pixel < alpha.length; pixel += 1) alpha[pixel] = image.data[pixel * 4 + 3];
  const refined = refineSelectionAlpha(alpha, work.w, work.h, params);
  const localCareX = care.x - work.x;
  const localCareY = care.y - work.y;
  let minX = care.x + care.w;
  let minY = care.y + care.h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < care.h; y += 1) {
    for (let x = 0; x < care.w; x += 1) {
      const pixel = (localCareY + y) * work.w + localCareX + x;
      const offset = pixel * 4;
      const value = refined[pixel];
      image.data[offset] = 255;
      image.data[offset + 1] = 255;
      image.data[offset + 2] = 255;
      image.data[offset + 3] = value;
      if (value > 0) {
        const documentX = care.x + x;
        const documentY = care.y + y;
        if (documentX < minX) minX = documentX;
        if (documentY < minY) minY = documentY;
        if (documentX > maxX) maxX = documentX;
        if (documentY > maxY) maxY = documentY;
      }
    }
  }
  context.putImageData(
    image,
    work.x,
    work.y,
    localCareX,
    localCareY,
    care.w,
    care.h,
  );
  doc.selection = {
    mask,
    bounds: maxX < 0
      ? { x: 0, y: 0, w: 0, h: 0 }
      : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
  };
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
