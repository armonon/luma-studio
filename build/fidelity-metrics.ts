/** RGBA comparison in byte units. RGB is premultiplied before comparison so
 * invisible RGB noise is not counted as a visible discrepancy. */
export function fidelityMetrics(a: Uint8ClampedArray, b: Uint8ClampedArray, width: number, height: number) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || a.length !== width * height * 4 || b.length !== a.length) throw new Error("Fidelity dimensions must match exactly");
  let color = 0, alpha = 0, max = 0, changed = 0, edge = 0, alphaEdge = 0, edgeSamples = 0;
  // Global averages can hide a missing headline occupying a small fraction of
  // the page. Retain bounded local error without replacing the global metrics.
  const tileSize = 32, columns = Math.ceil(width / tileSize), tileCount = columns * Math.ceil(height / tileSize);
  const tileColor = new Float64Array(tileCount), tileAlpha = new Float64Array(tileCount), tileSamples = new Uint32Array(tileCount);
  const luminance = (p: Uint8ClampedArray, i: number) => (p[i] * .2126 + p[i + 1] * .7152 + p[i + 2] * .0722) * p[i + 3] / 255;
  for (let i = 0; i < a.length; i += 4) {
    const pixel = i / 4, tile = Math.floor((pixel % width) / tileSize) + Math.floor(Math.floor(pixel / width) / tileSize) * columns;
    let delta = Math.abs(a[i + 3] - b[i + 3]); alpha += delta; tileAlpha[tile] += delta; tileSamples[tile]++;
    for (let c = 0; c < 3; c++) { const d = Math.abs(a[i + c] * a[i + 3] / 255 - b[i + c] * b[i + 3] / 255); color += d; tileColor[tile] += d; delta = Math.max(delta, d); }
    max = Math.max(max, delta); if (delta > 8) changed++;
    for (const step of [pixel % width ? 4 : 0, pixel >= width ? width * 4 : 0]) if (step) {
      edge += Math.abs((luminance(a, i) - luminance(a, i - step)) - (luminance(b, i) - luminance(b, i - step)));
      alphaEdge += Math.abs((a[i + 3] - a[i - step + 3]) - (b[i + 3] - b[i - step + 3])); edgeSamples++;
    }
  }
  let worstTileRgbMAE = 0, worstTileAlphaMAE = 0;
  for (let tile = 0; tile < tileCount; tile++) {
    worstTileRgbMAE = Math.max(worstTileRgbMAE, tileColor[tile] / (tileSamples[tile] * 3));
    worstTileAlphaMAE = Math.max(worstTileAlphaMAE, tileAlpha[tile] / tileSamples[tile]);
  }
  return { rgbMAE: color / (width * height * 3), alphaMAE: alpha / (width * height), maxDelta: max,
    fractionOver8: changed / (width * height), edgeMAE: edgeSamples ? edge / edgeSamples : 0, alphaEdgeMAE: edgeSamples ? alphaEdge / edgeSamples : 0,
    worstTileRgbMAE, worstTileAlphaMAE };
}

export const BASELINE_FIDELITY_TOLERANCES = Object.freeze({ rgbMAE: 3, alphaMAE: 1, fractionOver8: .05, edgeMAE: 3, alphaEdgeMAE: 3, worstTileRgbMAE: 15, worstTileAlphaMAE: 8 });
export function withinFidelityTolerance(metrics: ReturnType<typeof fidelityMetrics>) {
  return Object.entries(BASELINE_FIDELITY_TOLERANCES).every(([key, maximum]) => metrics[key as keyof typeof metrics] <= maximum);
}
