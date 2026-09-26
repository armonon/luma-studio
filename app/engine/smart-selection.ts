export type MaskTensor = { data: ArrayLike<number>; dims: number[] };
export type MaskPrompt = { x: number; y: number; label?: "include" | "exclude" };

/** Prefer prompt agreement, then predicted quality; never select the largest mask by default. */
export function bestSamProposal(masks: MaskTensor, scores: ArrayLike<number>, points: readonly MaskPrompt[]) {
  const height = masks.dims.at(-2) ?? 0, width = masks.dims.at(-1) ?? 0;
  const count = masks.dims.at(-3) ?? 0;
  if (![width, height, count].every(n => Number.isSafeInteger(n) && n > 0) || count > 8 || width * height > 4 * 1024 * 1024 || masks.data.length !== width * height * count) throw new Error("SAM returned invalid mask dimensions");
  let best = -1, quality = -Infinity;
  for (let n = 0; n < count; n++) {
    if (!Number.isFinite(scores[n])) continue;
    const offset = n * width * height;
    const matches = points.every(point => {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.y < 0 || point.x >= width || point.y >= height) return false;
      const selected = masks.data[offset + Math.floor(point.y) * width + Math.floor(point.x)] > 0;
      return selected === (point.label !== "exclude");
    });
    if (matches && scores[n] > quality) { best = n; quality = scores[n]; }
  }
  if (best < 0) throw new Error("No predicted mask matches the selection points. Try another point or Quick Selection.");
  return { index: best, width, height, offset: best * width * height };
}
