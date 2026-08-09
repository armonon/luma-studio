import type { PixelRect } from "./tile-store";

function normalize(rect: PixelRect): PixelRect | null {
  if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) {
    return null;
  }
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

function touches(a: PixelRect, b: PixelRect, padding: number) {
  return a.x <= b.x + b.width + padding && a.x + a.width + padding >= b.x &&
    a.y <= b.y + b.height + padding && a.y + a.height + padding >= b.y;
}

function union(a: PixelRect, b: PixelRect): PixelRect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.width, b.x + b.width);
  const bottom = Math.max(a.y + a.height, b.y + b.height);
  return { x, y, width: right - x, height: bottom - y };
}

/**
 * Coalesces the high-frequency rectangles produced by pen tablets before the
 * next animation frame. The hard cap prevents an adversarial pointer stream
 * from making render scheduling itself unbounded.
 */
export function appendDirtyRegion(
  existing: readonly PixelRect[],
  nextRect: PixelRect,
  options: { mergePadding?: number; maximumRegions?: number } = {},
) {
  const next = normalize(nextRect);
  if (!next) return [...existing];
  const mergePadding = Math.max(0, options.mergePadding ?? 2);
  const maximumRegions = Math.max(1, Math.round(options.maximumRegions ?? 24));
  const output = existing.map(normalize).filter((rect): rect is PixelRect => rect !== null);
  let merged = next;
  for (let index = output.length - 1; index >= 0; index -= 1) {
    if (!touches(output[index], merged, mergePadding)) continue;
    merged = union(output[index], merged);
    output.splice(index, 1);
  }
  output.push(merged);
  if (output.length <= maximumRegions) return output;
  return [output.reduce(union)];
}

