import Clipper from "clipper-lib";
import type { PathStyle } from "./document";
import { validateContours, validateVectorPath, VECTOR_LIMITS, type OffsetSource } from "./vector-path";

type Point = { x: number; y: number };
const scale = 1024, tolerance = 0.25, maxPoints = 8192;
/** Cubic flattening uses a control-hull bound, not uniform sample guesses. */
export function evaluateOffset(source: OffsetSource, appearance: PathStyle): PathStyle {
  validateVectorPath(appearance);
  validateContours(source.contours, VECTOR_LIMITS.booleanAnchors);
  if (!Number.isFinite(source.distance) || Math.abs(source.distance) > 1000 || !["round", "miter", "square"].includes(source.join) || !["nonzero", "evenodd"].includes(source.fillRule)) throw new Error("Invalid offset parameters");
  if (!source.contours.length || source.contours.some(c => !c.closed || c.anchors.length < 3)) throw new Error("Offsets require closed contours with at least three anchors");
  let count = 0;
  const mid = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const polygons = source.contours.map(contour => {
    const points: { X: number; Y: number }[] = [];
    const append = (p: Point) => { if (++count > maxPoints) throw new Error("Offset exceeds the 8,192-point flattening budget"); points.push({ X: Math.round(p.x * scale), Y: Math.round(p.y * scale) }); };
    const flatten = (a: Point, b: Point, c: Point, d: Point, depth: number) => {
      const dx = d.x - a.x, dy = d.y - a.y, length = dx * dx + dy * dy;
      const distance = (p: Point) => { const t = length ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)) : 0; return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy); };
      if (Math.max(distance(b), distance(c)) <= tolerance) { append(d); return; }
      if (depth >= 16) throw new Error("Offset curve exceeds subdivision budget");
      const ab = mid(a, b), bc = mid(b, c), cd = mid(c, d), abc = mid(ab, bc), bcd = mid(bc, cd), center = mid(abc, bcd);
      flatten(a, ab, abc, center, depth + 1); flatten(center, bcd, cd, d, depth + 1);
    };
    append(contour.anchors[0]);
    for (let i = 0; i < contour.anchors.length; i++) {
      const a = contour.anchors[i], d = contour.anchors[(i + 1) % contour.anchors.length];
      flatten(a, { x: a.x + a.hOut.dx, y: a.y + a.hOut.dy }, { x: d.x + d.hIn.dx, y: d.y + d.hIn.dy }, d, 0);
    }
    points.pop(); return points;
  });
  // Union first removes self-intersections and normalizes hole orientations.
  const normalized: typeof polygons = [], union = new Clipper.Clipper();
  union.AddPaths(polygons, Clipper.PolyType.ptSubject, true);
  const rule = source.fillRule === "evenodd" ? Clipper.PolyFillType.pftEvenOdd : Clipper.PolyFillType.pftNonZero;
  if (!union.Execute(Clipper.ClipType.ctUnion, normalized, rule, rule)) throw new Error("Unable to normalize offset contours");
  if (normalized.reduce((n, p) => n + p.length, 0) > maxPoints) throw new Error("Normalized offset exceeds geometry budget");
  const result: typeof polygons = [];
  const offset = new Clipper.ClipperOffset(2, tolerance * scale);
  offset.AddPaths(normalized, Clipper.JoinType[source.join === "round" ? "jtRound" : source.join === "miter" ? "jtMiter" : "jtSquare"], Clipper.EndType.etClosedPolygon);
  offset.Execute(result, source.distance * scale);
  const contours = result.map(points => ({ closed: true, anchors: points.map(p => ({ x: p.X / scale, y: p.Y / scale, hIn: { dx: 0, dy: 0 }, hOut: { dx: 0, dy: 0 } })) }));
  validateContours(contours);
  const path: PathStyle = { fill: appearance.fill, stroke: appearance.stroke, strokeWidth: appearance.strokeWidth, ...(appearance.appearance ? { appearance: structuredClone(appearance.appearance) } : {}), ...(contours[0] ?? { anchors: [], closed: true }), contours: contours.slice(1), fillRule: "nonzero", offsetSource: structuredClone(source) };
  validateVectorPath(path); return path;
}
