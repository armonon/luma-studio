import { Document, Selection, newCanvas } from "./document";

export type SelectionMode = "replace" | "add" | "subtract" | "intersect";

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

export function featherSelection(doc: Document, radius: number) {
  if (!doc.selection || radius <= 0) return;
  const src = doc.selection.mask;
  const blurred = newCanvas(src.width, src.height);
  const bctx = blurred.getContext("2d")!;
  bctx.filter = `blur(${radius}px)`;
  bctx.drawImage(src, 0, 0);
  bctx.filter = "none";
  doc.selection = { mask: blurred, bounds: boundsOf(blurred) };
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
