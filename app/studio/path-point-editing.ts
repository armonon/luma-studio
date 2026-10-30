import type { Layer, PathAnchor, PathStyle } from "../engine/document";
import { affineForLayerTransform, transformPoint } from "../engine/document";
import { pathContours, validateVectorPath } from "../engine/vector-path";
import type { Studio } from "../engine/studio";
import { bendCubic, cubicPoint, handlePolar, polarHandle, moveAnchor, moveAnchorHandle, setAnchorMode, splitCubic, type AnchorMode, type Point, type PathHandle } from "../shared/path-editing";

/** Image-space y points down; displayed angles match Form's positive CCW convention. */
export const imageHandlePolar = (handle: PathHandle) => handlePolar({ dx: handle.dx, dy: -handle.dy });
export function imagePolarHandle(length: number, angle: number): PathHandle { const h = polarHandle(length, angle); return { dx: h.dx, dy: -h.dy }; }

export type PointRef = { contour: number; index: number };
export type SegmentRef = PointRef & { t: number };
export const pointKey = (ref: PointRef) => `${ref.contour}:${ref.index}`;
export const partAt = (path: PathStyle, contour: number) => contour === 0 ? path : path.contours?.[contour - 1];
const newId = () => `point-${crypto.randomUUID()}`;
export function editablePointPath(path: PathStyle): PathStyle {
  const result = structuredClone(path);
  for (const part of pathContours(result)) for (const anchor of part.anchors) anchor.id ??= newId();
  return result;
}
export function segmentControls(path: PathStyle, ref: PointRef) {
  const part = partAt(path, ref.contour), a = part?.anchors[ref.index];
  const next = part && (ref.index + 1 < part.anchors.length ? ref.index + 1 : part.closed ? 0 : -1);
  const b = part && next !== undefined && next >= 0 ? part.anchors[next] : undefined;
  if (!a || !b) throw new Error("Select a segment between two points");
  return { a, b, next: next!, points: [a, { x: a.x + a.hOut.dx, y: a.y + a.hOut.dy }, { x: b.x + b.hIn.dx, y: b.y + b.hIn.dy }, b] as [Point, Point, Point, Point] };
}
export function movePoints(path: PathStyle, selected: PointRef[], delta: Point): PathStyle {
  const result = editablePointPath(path);
  for (const ref of selected) {
    const part = partAt(result, ref.contour), a = part?.anchors[ref.index];
    if (a) part!.anchors[ref.index] = moveAnchor(a, { x: a.x + delta.x, y: a.y + delta.y });
  }
  validateVectorPath(result); return result;
}
export function editHandle(path: PathStyle, ref: PointRef, side: "in" | "out", point: Point, independent = false): PathStyle {
  const result = editablePointPath(path), part = partAt(result, ref.contour), a = part?.anchors[ref.index];
  if (!a) throw new Error("Select a point");
  part!.anchors[ref.index] = moveAnchorHandle(independent ? { ...a, mode: "corner" } : a, side, { dx: point.x - a.x, dy: point.y - a.y });
  validateVectorPath(result); return result;
}
export function changePointMode(path: PathStyle, selected: PointRef[], mode: AnchorMode): PathStyle {
  const result = editablePointPath(path);
  for (const ref of selected) {
    const part = partAt(result, ref.contour), a = part?.anchors[ref.index];
    if (!a) continue;
    // Give a collapsed smooth point a useful tangent, in local source units.
    let source: PathAnchor = a;
    if (mode !== "corner" && !Math.hypot(a.hIn.dx, a.hIn.dy, a.hOut.dx, a.hOut.dy)) {
      const prev = part!.anchors[ref.index - 1] ?? (part!.closed ? part!.anchors.at(-1) : undefined);
      const next = part!.anchors[ref.index + 1] ?? (part!.closed ? part!.anchors[0] : undefined);
      const dx = (next?.x ?? a.x) - (prev?.x ?? a.x), dy = (next?.y ?? a.y) - (prev?.y ?? a.y), length = Math.hypot(dx, dy) || 1;
      const incoming = prev ? Math.hypot(prev.x - a.x, prev.y - a.y) / 3 : 0, outgoing = next ? Math.hypot(next.x - a.x, next.y - a.y) / 3 : 0;
      source = { ...a, hIn: { dx: -dx / length * incoming, dy: -dy / length * incoming }, hOut: { dx: dx / length * outgoing, dy: dy / length * outgoing } };
    }
    part!.anchors[ref.index] = setAnchorMode(source, mode);
  }
  validateVectorPath(result); return result;
}
export function addSegmentPoint(path: PathStyle, ref: SegmentRef): PathStyle {
  if (ref.t <= 0 || ref.t >= 1) throw new Error("Add a point inside the segment");
  const result = editablePointPath(path), { a, b, next, points } = segmentControls(result, ref), part = partAt(result, ref.contour)!;
  const { left, right } = splitCubic(...points, ref.t);
  // Exact subdivision changes just one handle length at either endpoint.
  a.hOut = { dx: left[1].x - a.x, dy: left[1].y - a.y }; b.hIn = { dx: right[2].x - b.x, dy: right[2].y - b.y };
  if (a.mode === "symmetric") a.mode = "smooth";
  if (b.mode === "symmetric") b.mode = "smooth";
  const center: PathAnchor = { ...left[3], id: newId(), mode: "smooth", hIn: { dx: left[2].x - left[3].x, dy: left[2].y - left[3].y }, hOut: { dx: right[1].x - right[0].x, dy: right[1].y - right[0].y } };
  part.anchors.splice(next === 0 ? part.anchors.length : next, 0, center);
  validateVectorPath(result); return result;
}
export function bendSegment(path: PathStyle, ref: SegmentRef, delta: Point): PathStyle {
  const result = editablePointPath(path), { a, b, next, points } = segmentControls(result, ref), part = partAt(result, ref.contour)!;
  const { c1, c2 } = bendCubic(...points, ref.t, delta);
  part.anchors[ref.index] = moveAnchorHandle(a, "out", { dx: c1.x - a.x, dy: c1.y - a.y });
  part.anchors[next] = moveAnchorHandle(b, "in", { dx: c2.x - b.x, dy: c2.y - b.y });
  validateVectorPath(result); return result;
}
export function removePathPoints(path: PathStyle, selected: PointRef[]): PathStyle {
  const result = editablePointPath(path), keys = new Set(selected.map(pointKey));
  pathContours(result).forEach((part, contour) => {
    const remaining = part.anchors.filter((_, index) => !keys.has(pointKey({ contour, index })));
    if (remaining.length < 2) throw new Error("Keep at least two points per contour");
    part.anchors.splice(0, part.anchors.length, ...remaining);
  });
  validateVectorPath(result); return result;
}
export function cutPathAtPoint(path: PathStyle, ref: PointRef): PathStyle {
  const result = editablePointPath(path), part = partAt(result, ref.contour), a = part?.anchors[ref.index];
  if (!part || !a) throw new Error("Select a point to cut");
  const duplicate = structuredClone(a); duplicate.id = newId();
  if (part.closed) {
    part.anchors = [...part.anchors.slice(ref.index), ...part.anchors.slice(0, ref.index), duplicate]; part.closed = false;
  } else {
    if (ref.index === 0 || ref.index === part.anchors.length - 1) throw new Error("This point is already an open endpoint");
    const right = { anchors: [duplicate, ...part.anchors.slice(ref.index + 1)], closed: false };
    part.anchors = part.anchors.slice(0, ref.index + 1);
    result.contours = [...(result.contours ?? []), right];
  }
  // The first contour is the path object; assigning part.anchors above preserves paint/recipes.
  validateVectorPath(result); return result;
}
export type PointHit = (PointRef & { kind: "anchor" | "in" | "out" }) | (SegmentRef & { kind: "segment" });
/** Hit radii are CSS pixels, after the complete layer affine and viewport scale. */
export function hitPathPoint(path: PathStyle, layer: Layer, point: Point, selected: PointRef[], scale: number, radius: number): PointHit | null {
  const matrix = affineForLayerTransform(layer.transform), screen = (p: Point) => transformPoint(matrix, p.x, p.y);
  const distance = (p: Point) => Math.hypot((screen(p).x - point.x) * scale, (screen(p).y - point.y) * scale);
  let best: PointHit | null = null, nearest = radius;
  // Compare handle/anchor distances so short handles never steal an anchor tap.
  for (const ref of selected) {
    const part = partAt(path, ref.contour), a = part?.anchors[ref.index]; if (!a || !part) continue;
    for (const side of ["in", "out"] as const) {
      if (!part.closed && (side === "in" ? ref.index === 0 : ref.index === part.anchors.length - 1)) continue;
      const h = side === "in" ? a.hIn : a.hOut;
      if (Math.hypot(h.dx, h.dy) < 1e-9) continue;
      const d = distance({ x: a.x + h.dx, y: a.y + h.dy });
      if (d < nearest) { nearest = d; best = { ...ref, kind: side }; }
    }
  }
  pathContours(path).forEach((part, contour) => part.anchors.forEach((a, index) => {
    const d = distance(a); if (d < nearest) { nearest = d; best = { contour, index, kind: "anchor" }; }
  }));
  if (best) return best;
  pathContours(path).forEach((part, contour) => {
    for (let index = 0; index < part.anchors.length - (part.closed ? 0 : 1); index++) {
      const { points } = segmentControls(path, { contour, index });
      let sample = 1, d = Infinity;
      for (let i = 1; i < 32; i++) { const candidate = distance(cubicPoint(...points, i / 32)); if (candidate < d) { d = candidate; sample = i; } }
      let lo = (sample - 1) / 32, hi = (sample + 1) / 32;
      for (let i = 0; i < 16; i++) { const a = lo + (hi - lo) / 3, b = hi - (hi - lo) / 3; if (distance(cubicPoint(...points, a)) < distance(cubicPoint(...points, b))) hi = b; else lo = a; }
      const t = (lo + hi) / 2, candidate = distance(cubicPoint(...points, t));
      if (candidate < nearest) { nearest = candidate; best = { contour, index, t, kind: "segment" }; }
    }
  });
  return best;
}

/** Retain the actual source object so switching documents can roll back its preview. */
export class PathPointTransaction {
  readonly original: PathStyle;
  constructor(private studio: Studio, private layer: Layer, private documentId = studio.activeDocumentState().id) {
    if (!layer.path || layer.locked || layer.path.booleanSource || layer.path.offsetSource) throw new Error("Choose an unlocked editable path");
    if (layer.path.symbolId && studio.doc.layers.some(l => l.path?.symbolId === layer.path!.symbolId && l.locked)) throw new Error("Unlock all linked instances first");
    this.original = structuredClone(layer.path);
  }
  preview(path: PathStyle) {
    if (this.studio.activeDocumentState().id !== this.documentId || this.studio.findLayer(this.layer.id) !== this.layer) throw new Error("Path edit cancelled after document change");
    validateVectorPath(path); this.studio.liveUpdatePath(this.layer.id, path);
  }
  cancel() { this.layer.path = structuredClone(this.original); this.studio.requestRender(); }
  commit(path: PathStyle) {
    this.cancel();
    if (this.studio.activeDocumentState().id !== this.documentId || this.studio.findLayer(this.layer.id) !== this.layer) throw new Error("Path edit cancelled after document change");
    if (JSON.stringify(path) !== JSON.stringify(this.original)) this.studio.updatePath(this.layer.id, path);
  }
}
