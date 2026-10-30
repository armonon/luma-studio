/** Unit-neutral planar path editing. Coordinates and relative handles share one unit.
 * Handle alignment follows Form's graph-editor.ts dragHandle; subdivision uses
 * de Casteljau as in fabric-authored-outline.ts. No time-domain restrictions apply.
 */
export type Point = { x: number; y: number };
export type PathHandle = { dx: number; dy: number };
export type AnchorMode = "corner" | "smooth" | "symmetric";
export type PathAnchorLike = Point & { hIn: PathHandle; hOut: PathHandle; mode?: AnchorMode; id?: string };

const LIMIT = 1e12;
const EPSILON = 1e-12;
const ENDPOINT_GUARD = 1e-6;
function bounded(value: number, name: string, limit = LIMIT): number {
  if (!Number.isFinite(value) || Math.abs(value) > limit) throw new RangeError(`${name} must be finite and within ±${limit}`);
  return value;
}
function point(p: Point): Point { bounded(p.x, "Point x"); bounded(p.y, "Point y"); return p; }
function handle(h: PathHandle): PathHandle { bounded(h.dx, "Handle dx"); bounded(h.dy, "Handle dy"); return h; }
function mode(value: AnchorMode): AnchorMode {
  if (!["corner", "smooth", "symmetric"].includes(value)) throw new RangeError("Unknown anchor mode");
  return value;
}
function anchor<T extends PathAnchorLike>(a: T): T {
  point(a); handle(a.hIn); handle(a.hOut); if (a.mode !== undefined) mode(a.mode); return a;
}
function parameter(t: number): number {
  if (!Number.isFinite(t) || t < 0 || t > 1) throw new RangeError("Curve parameter must be between 0 and 1");
  return t;
}
const mix = (a: Point, b: Point, t: number): Point => ({ x: a.x * (1 - t) + b.x * t, y: a.y * (1 - t) + b.y * t });
const lengthOf = (h: PathHandle) => Math.hypot(h.dx, h.dy);

/** Exact polynomial evaluation, including both endpoints; no coordinate rounding. */
export function cubicPoint(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  [p0, p1, p2, p3].forEach(point); parameter(t);
  const a = mix(p0, p1, t), b = mix(p1, p2, t), c = mix(p2, p3, t);
  return point(mix(mix(a, b, t), mix(b, c, t), t));
}

/** Subdivision preserves the geometric curve, with each half reparameterized. */
export function splitCubic(p0: Point, p1: Point, p2: Point, p3: Point, t: number): { left: [Point, Point, Point, Point]; right: [Point, Point, Point, Point] } {
  [p0, p1, p2, p3].forEach(point); parameter(t);
  const a = mix(p0, p1, t), b = mix(p1, p2, t), c = mix(p2, p3, t);
  const d = mix(a, b, t), e = mix(b, c, t), center = mix(d, e, t);
  return { left: [{ ...p0 }, a, d, center], right: [{ ...center }, e, c, { ...p3 }] };
}

/** Fixed-endpoint bend: minimum squared control displacement hits B(t)+delta.
 * Near-endpoint bends are rejected rather than producing enormous handles.
 * Anchor continuity constraints, when wanted, must be applied by the caller.
 */
export function bendCubic(p0: Point, p1: Point, p2: Point, p3: Point, t: number, delta: Point): { c1: Point; c2: Point } {
  [p0, p1, p2, p3, delta].forEach(point); parameter(t);
  if (t <= ENDPOINT_GUARD || t >= 1 - ENDPOINT_GUARD) throw new RangeError("Bend the segment interior; endpoints remain fixed");
  const a = 3 * (1 - t) ** 2 * t, b = 3 * (1 - t) * t ** 2, denominator = a * a + b * b;
  return {
    c1: point({ x: p1.x + delta.x * a / denominator, y: p1.y + delta.y * a / denominator }),
    c2: point({ x: p2.x + delta.x * b / denominator, y: p2.y + delta.y * b / denominator }),
  };
}

/** Relative handles travel with the anchor, without altering their vectors. */
export function moveAnchor<T extends PathAnchorLike>(a: T, to: Point): T {
  anchor(a); point(to); return { ...a, x: to.x, y: to.y, hIn: { ...a.hIn }, hOut: { ...a.hOut } };
}

export function moveAnchorHandle<T extends PathAnchorLike>(a: T, side: "in" | "out", vector: PathHandle, independent = false): T {
  anchor(a); handle(vector);
  if (side !== "in" && side !== "out") throw new RangeError("Unknown handle side");
  const moved = side === "in" ? "hIn" : "hOut", opposite = side === "in" ? "hOut" : "hIn";
  const result = { ...a, hIn: { ...a.hIn }, hOut: { ...a.hOut }, [moved]: { ...vector } };
  const kind = a.mode ?? "corner", magnitude = lengthOf(vector);
  if (!independent && kind !== "corner") {
    if (magnitude > EPSILON) {
      const otherLength = kind === "symmetric" ? magnitude : lengthOf(a[opposite]);
      result[opposite] = handle({ dx: -vector.dx / magnitude * otherLength, dy: -vector.dy / magnitude * otherLength });
    } else if (kind === "symmetric") result[opposite] = { dx: 0, dy: 0 };
    // A collapsed smooth handle has no direction; retain the other side.
  }
  return result;
}

/** Align from the outgoing direction (or reversed incoming if it is collapsed).
 * Smooth retains both lengths; symmetric uses the nonzero outgoing length first.
 */
export function setAnchorMode<T extends PathAnchorLike>(a: T, nextMode: AnchorMode): T {
  anchor(a); mode(nextMode);
  const result = { ...a, mode: nextMode, hIn: { ...a.hIn }, hOut: { ...a.hOut } };
  if (nextMode === "corner") return result;
  const incoming = lengthOf(a.hIn), outgoing = lengthOf(a.hOut);
  if (incoming <= EPSILON && outgoing <= EPSILON) return result;
  const direction = outgoing > EPSILON ? { dx: a.hOut.dx / outgoing, dy: a.hOut.dy / outgoing } : { dx: -a.hIn.dx / incoming, dy: -a.hIn.dy / incoming };
  const outLength = nextMode === "symmetric" ? (outgoing > EPSILON ? outgoing : incoming) : outgoing;
  const inLength = nextMode === "symmetric" ? outLength : incoming;
  result.hOut = handle({ dx: direction.dx * outLength, dy: direction.dy * outLength });
  result.hIn = handle({ dx: -direction.dx * inLength, dy: -direction.dy * inLength });
  return result;
}

/** Angles use mathematical degrees: positive counterclockwise in a y-up plane. */
export function polarHandle(length: number, angleDegrees: number): PathHandle {
  bounded(length, "Handle length", LIMIT * Math.SQRT2); bounded(angleDegrees, "Handle angle");
  if (length < 0) throw new RangeError("Handle length must be nonnegative");
  const radians = (angleDegrees % 360) * Math.PI / 180;
  return handle({ dx: length * Math.cos(radians), dy: length * Math.sin(radians) });
}
export function handlePolar(vector: PathHandle): { length: number; angle: number } {
  handle(vector);
  return { length: lengthOf(vector), angle: lengthOf(vector) <= EPSILON ? 0 : Math.atan2(vector.dy, vector.dx) * 180 / Math.PI };
}

/** Snap direction while retaining distance from origin; never snap stored units. */
export function snapAnglePoint(origin: Point, target: Point, stepDegrees = 45): Point {
  point(origin); point(target);
  if (!Number.isFinite(stepDegrees) || stepDegrees <= 0 || stepDegrees > 360) throw new RangeError("Angle step must be greater than 0 and at most 360 degrees");
  const dx = target.x - origin.x, dy = target.y - origin.y, magnitude = Math.hypot(dx, dy);
  if (magnitude <= EPSILON) return { ...origin };
  const degrees = Math.atan2(dy, dx) * 180 / Math.PI;
  const snapped = Math.round(degrees / stepDegrees) * stepDegrees * Math.PI / 180;
  return point({ x: origin.x + Math.cos(snapped) * magnitude, y: origin.y + Math.sin(snapped) * magnitude });
}
