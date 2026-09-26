/** Metrics are independent of the model. Photoshop agreement is NOT ground-truth accuracy. */
export type AlphaMask = { width: number; height: number; alpha: Uint8Array };
export function selectionMetrics(candidate: AlphaMask, reference: AlphaMask, tolerance = 2) {
  const { width: w, height: h } = reference;
  if (![w, h].every(n => Number.isSafeInteger(n) && n > 0) || w * h > 4 * 1024 * 1024 || candidate.width !== w || candidate.height !== h || candidate.alpha.length !== w * h || reference.alpha.length !== w * h) throw new Error("Masks must have matching dimensions of at most 4 megapixels");
  if (!Number.isInteger(tolerance) || tolerance < 0 || tolerance > 8) throw new Error("Boundary tolerance must be 0–8 pixels");
  let intersection = 0, union = 0, aCount = 0, bCount = 0, absolute = 0, softAbsolute = 0, softCount = 0;
  const aEdge = new Uint8Array(w * h), bEdge = new Uint8Array(w * h);
  const edge = (data: Uint8Array, i: number, x: number, y: number) => data[i] >= 128 && (x === 0 || y === 0 || x === w - 1 || y === h - 1 || data[i - 1] < 128 || data[i + 1] < 128 || data[i - w] < 128 || data[i + w] < 128);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, a = candidate.alpha[i] >= 128, b = reference.alpha[i] >= 128;
    intersection += Number(a && b); union += Number(a || b); aCount += Number(a); bCount += Number(b);
    const error = Math.abs(candidate.alpha[i] - reference.alpha[i]) / 255;
    absolute += error;
    if (reference.alpha[i] > 0 && reference.alpha[i] < 255) { softAbsolute += error; softCount++; }
    aEdge[i] = Number(edge(candidate.alpha, i, x, y)); bEdge[i] = Number(edge(reference.alpha, i, x, y));
  }
  const matched = (a: Uint8Array, b: Uint8Array) => {
    let total = 0, matches = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!a[y * w + x]) continue;
      total++; let found = false;
      for (let dy = -tolerance; dy <= tolerance && !found; dy++) for (let dx = -tolerance; dx <= tolerance; dx++) {
        if (dx * dx + dy * dy > tolerance * tolerance) continue;
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < w && yy < h && b[yy * w + xx]) { found = true; break; }
      }
      matches += Number(found);
    }
    return { total, matches };
  };
  const ap = matched(aEdge, bEdge), bp = matched(bEdge, aEdge);
  const precision = ap.total ? ap.matches / ap.total : (bp.total ? 0 : 1);
  const recall = bp.total ? bp.matches / bp.total : (ap.total ? 0 : 1);
  return { iou: union ? intersection / union : 1, dice: aCount + bCount ? 2 * intersection / (aCount + bCount) : 1,
    boundaryF1: precision + recall ? 2 * precision * recall / (precision + recall) : 0,
    alphaMAE: absolute / (w * h), softEdgeMAE: softCount ? softAbsolute / softCount : null,
    referenceSoftPixels: softCount, candidatePixels: aCount, referencePixels: bCount, boundaryTolerance: tolerance };
}

export const REQUIRED_SELECTION_CATEGORIES = ["objects", "hair-fur", "thin-structures", "low-contrast", "transparent", "multiple-subjects"] as const;

/** Compare both applications against an independent annotation. Agreement
 * with Photoshop alone cannot tell whether either application's answer is good. */
export function evaluateSelectionPair(luma: AlphaMask, photoshop: AlphaMask, truth: AlphaMask) {
  const candidate = selectionMetrics(luma, truth);
  const competitor = selectionMetrics(photoshop, truth);
  const reasons: string[] = [];
  if (candidate.referencePixels === 0) reasons.push("Independent reference contains no selected subject");
  if (candidate.iou < .9) reasons.push("Luma IoU below 0.90");
  if (candidate.boundaryF1 < .85) reasons.push("Luma boundary F1 below 0.85");
  if (candidate.iou + .02 < competitor.iou) reasons.push("Luma IoU trails Photoshop by more than 0.02");
  if (candidate.boundaryF1 + .03 < competitor.boundaryF1) reasons.push("Luma boundary F1 trails Photoshop by more than 0.03");
  if (candidate.softEdgeMAE !== null && (candidate.softEdgeMAE > .1 || candidate.softEdgeMAE > (competitor.softEdgeMAE ?? 0) + .02)) reasons.push("Soft-edge error exceeds the declared tolerance");
  return { passed: reasons.length === 0, reasons, luma: candidate, photoshop: competitor, agreement: selectionMetrics(luma, photoshop) };
}
export type SelectionEvidence = { id: string; imageHash: string; category: string; real: boolean; groundTruth: boolean; photoshop: boolean; protocol: string; passed: boolean };
export function selectionEvidenceGate(cases: readonly SelectionEvidence[]) {
  const reasons: string[] = [];
  const unique = new Set<string>();
  const valid = cases.filter(c => {
    if (unique.has(c.imageHash)) return false;
    unique.add(c.imageHash);
    return /^[a-f0-9]{64}$/.test(c.imageHash) && c.real && c.groundTruth && c.photoshop && Boolean(c.protocol.trim());
  });
  if (valid.length < 50) reasons.push(`Need 50 independently labeled, paired real images; have ${valid.length}`);
  for (const category of REQUIRED_SELECTION_CATEGORIES) if (valid.filter(c => c.category === category).length < 5) reasons.push(`Need 5 paired cases in ${category}`);
  if (valid.some(c => !c.passed)) reasons.push("At least one paired case failed the declared acceptance thresholds");
  return { qualified: reasons.length === 0, pairedRealCases: valid.length, reasons };
}
