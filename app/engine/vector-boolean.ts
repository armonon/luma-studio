import paper from "paper";
import type { PathStyle } from "./document";
import { cloneContour, validateContours, VECTOR_LIMITS, type BooleanSource, type PathContour } from "./vector-path";

/** Runs in a terminable worker in the editor; no raster canvas or document-sized buffers. */
export function evaluateBoolean(source: BooleanSource, appearance: Pick<PathStyle, "fill" | "stroke" | "strokeWidth">): PathStyle {
  if (!["unite", "subtract", "intersect", "exclude"].includes(source.operation) || source.operands.length !== 2) throw new Error("Choose two operands and a valid boolean operation");
  validateContours(source.operands.flat(), VECTOR_LIMITS.booleanAnchors);
  if (source.operands.some(operand => !operand.length || operand.some(c => !c.closed || c.anchors.length < 3))) throw new Error("Boolean operations require closed contours with at least three anchors");
  const scope = new paper.PaperScope();
  scope.setup(new scope.Size(1, 1));
  try {
    const make = (contours: PathContour[], index: number) => {
      const children = contours.map(contour => new scope.Path({
        insert: false, closed: true,
        segments: contour.anchors.map(a => new scope.Segment(new scope.Point(a.x, a.y), new scope.Point(a.hIn.dx, a.hIn.dy), new scope.Point(a.hOut.dx, a.hOut.dy))),
      }));
      return new scope.CompoundPath({ children, insert: false, fillRule: source.fillRules?.[index] ?? "evenodd" });
    };
    const left = make(source.operands[0], 0), right = make(source.operands[1], 1);
    const result = left[source.operation](right, { insert: false });
    const paths = result instanceof scope.CompoundPath ? result.children as paper.Path[] : [result as paper.Path];
    const contours = paths.filter(path => path.segments.length >= 3).map(path => ({
      closed: path.closed,
      anchors: path.segments.map(s => ({ x: s.point.x, y: s.point.y, hIn: { dx: s.handleIn.x, dy: s.handleIn.y }, hOut: { dx: s.handleOut.x, dy: s.handleOut.y } })),
    }));
    validateContours(contours);
    const first = contours[0] ?? { anchors: [], closed: true };
    return { fill: appearance.fill, stroke: appearance.stroke, strokeWidth: appearance.strokeWidth, ...first, contours: contours.slice(1), fillRule: "evenodd", booleanSource: { operation: source.operation, operands: source.operands.map(operand => operand.map(cloneContour)), ...(source.fillRules ? { fillRules: [...source.fillRules] } : {}) } };
  } finally { (scope as unknown as { remove(): void }).remove(); }
}
