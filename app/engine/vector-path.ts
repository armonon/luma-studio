import type { PathAnchor, PathStyle } from "./document";

export type PathContour = { anchors: PathAnchor[]; closed: boolean };
/** Ordered bottom-to-top. An explicit empty stack paints nothing. */
export type VectorPaint = { kind: "fill" | "stroke"; color: string; opacity: number; width: number; enabled: boolean };
export function vectorPaints(path: PathStyle): VectorPaint[] {
  return path.appearance ?? [
    { kind: "fill", color: path.fill, opacity: 1, width: 0, enabled: true },
    { kind: "stroke", color: path.stroke, opacity: 1, width: path.strokeWidth, enabled: true },
  ];
}
export type BooleanOperation = "unite" | "subtract" | "intersect" | "exclude";
export type BooleanSource = { operation: BooleanOperation; operands: PathContour[][]; fillRules?: Array<"nonzero" | "evenodd"> };
export type OffsetSource = { contours: PathContour[]; distance: number; join: "round" | "miter" | "square"; fillRule: "nonzero" | "evenodd" };
export const VECTOR_LIMITS = { contours: 256, anchors: 4096, booleanAnchors: 512, coordinate: 1_000_000, layers: 1024 } as const;

/** The original contour stays in anchors for backwards-compatible single paths. */
export function pathContours(path: PathStyle): PathContour[] {
  return [{ anchors: path.anchors, closed: path.closed }, ...(path.contours ?? [])];
}

export function cloneContour(contour: PathContour): PathContour {
  return { closed: contour.closed, anchors: contour.anchors.map(a => ({ ...a, hIn: { ...a.hIn }, hOut: { ...a.hOut } })) };
}

export function validateContours(contours: PathContour[], maxAnchors: number = VECTOR_LIMITS.anchors) {
  if (!Array.isArray(contours) || contours.length > VECTOR_LIMITS.contours) throw new Error("Vector contour limit exceeded");
  let count = 0;
  for (const contour of contours) {
    if (!contour || typeof contour.closed !== "boolean" || !Array.isArray(contour.anchors)) throw new Error("Invalid vector contour");
    count += contour.anchors.length;
    if (count > maxAnchors) throw new Error(`Vector operation supports at most ${maxAnchors} anchors`);
    for (const a of contour.anchors) {
      if (!a || !a.hIn || !a.hOut || ![a.x, a.y, a.hIn.dx, a.hIn.dy, a.hOut.dx, a.hOut.dy].every(v => Number.isFinite(v) && Math.abs(v) <= VECTOR_LIMITS.coordinate)) throw new Error("Invalid or out-of-range vector coordinate");
      if (a.mode !== undefined && !["corner", "smooth", "symmetric"].includes(a.mode)) throw new Error("Invalid anchor mode");
      if (a.id !== undefined) {
        if (typeof a.id !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(a.id)) throw new Error("Invalid anchor identity");
      }
    }
  }
}

export function validateVectorPath(path: PathStyle) {
  validateContours(pathContours(path));
  const identities = pathContours(path).flatMap(part => part.anchors.flatMap(a => a.id ? [a.id] : []));
  if (new Set(identities).size !== identities.length) throw new Error("Duplicate anchor identity");
  if (path.symbolId !== undefined && (typeof path.symbolId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(path.symbolId))) throw new Error("Invalid symbol identity");
  if (path.offsetSource) {
    validateContours(path.offsetSource.contours, VECTOR_LIMITS.booleanAnchors);
    if (!Number.isFinite(path.offsetSource.distance) || Math.abs(path.offsetSource.distance) > 1000 || !["round", "miter", "square"].includes(path.offsetSource.join) || !["nonzero", "evenodd"].includes(path.offsetSource.fillRule)) throw new Error("Invalid offset recipe");
  }
  if (path.appearance !== undefined) {
    if (!Array.isArray(path.appearance) || path.appearance.length > 16) throw new Error("Vector appearance supports at most 16 paints");
    for (const paint of path.appearance) {
      if (!paint || !["fill", "stroke"].includes(paint.kind) || typeof paint.enabled !== "boolean" || typeof paint.color !== "string" || paint.color.length > 256 || !Number.isFinite(paint.opacity) || paint.opacity < 0 || paint.opacity > 1 || !Number.isFinite(paint.width) || paint.width < 0 || paint.width > 10000) throw new Error("Invalid vector appearance paint");
    }
  }
  if (path.fillRule !== undefined && !["evenodd", "nonzero"].includes(path.fillRule)) throw new Error("Invalid vector fill rule");
  if (!Number.isFinite(path.strokeWidth) || path.strokeWidth < 0 || path.strokeWidth > 10000) throw new Error("Invalid vector stroke width");
  if (typeof path.fill !== "string" || typeof path.stroke !== "string" || path.fill.length > 256 || path.stroke.length > 256) throw new Error("Invalid vector paint");
  if (path.booleanSource) {
    if (!["unite", "subtract", "intersect", "exclude"].includes(path.booleanSource.operation) || !Array.isArray(path.booleanSource.operands) || path.booleanSource.operands.length !== 2) throw new Error("Invalid boolean recipe");
    validateContours(path.booleanSource.operands.flat(), VECTOR_LIMITS.booleanAnchors);
    if (path.booleanSource.fillRules && (path.booleanSource.fillRules.length !== 2 || path.booleanSource.fillRules.some(rule => !["evenodd", "nonzero"].includes(rule)))) throw new Error("Invalid boolean operand fill rules");
  }
}

export function traceContours(ctx: Pick<CanvasRenderingContext2D, "moveTo" | "bezierCurveTo" | "closePath">, contours: PathContour[], forceClosed = false) {
  for (const { anchors, closed } of contours) {
    if (anchors.length < 2) continue;
    ctx.moveTo(anchors[0].x, anchors[0].y);
    const count = anchors.length - 1 + (closed || forceClosed ? 1 : 0);
    for (let i = 0; i < count; i++) {
      const a = anchors[i], b = anchors[(i + 1) % anchors.length];
      ctx.bezierCurveTo(a.x + a.hOut.dx, a.y + a.hOut.dy, b.x + b.hIn.dx, b.y + b.hIn.dy, b.x, b.y);
    }
    if (closed || forceClosed) ctx.closePath();
  }
}

export function vectorPathData(path: PathStyle): string {
  validateVectorPath(path);
  const out: string[] = [];
  traceContours({
    moveTo: (x, y) => { out.push(`M${x} ${y}`); },
    bezierCurveTo: (a, b, c, d, x, y) => { out.push(`C${a} ${b} ${c} ${d} ${x} ${y}`); },
    closePath: () => { out.push("Z"); },
  }, pathContours(path));
  return out.join(" ");
}

/** Conservative control-hull bounds; never clips handles or secondary contours. */
export function vectorPathBounds(path: PathStyle) {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const contour of pathContours(path)) for (const a of contour.anchors) {
    for (const [x, y] of [[a.x, a.y], [a.x + a.hIn.dx, a.y + a.hIn.dy], [a.x + a.hOut.dx, a.y + a.hOut.dy]]) {
      left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
    }
  }
  if (!Number.isFinite(left)) return { x: 0, y: 0, width: 1, height: 1 };
  const padding = Math.max(4, ...vectorPaints(path).filter(p => p.enabled && p.kind === "stroke").map(p => p.width / 2));
  return { x: left - padding, y: top - padding, width: Math.max(1, right - left + padding * 2), height: Math.max(1, bottom - top + padding * 2) };
}
