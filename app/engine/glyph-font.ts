/**
 * Glyph (alpha): draw-your-own-font model and font compilers.
 *
 * A project stores what the user drew — brush strokes and pen shapes in font
 * units, y up from the baseline — never the compiled outlines. Outlines are
 * derived on demand: brush strokes are offset into round-capped outlines,
 * everything is unioned, then "cut" shapes are subtracted. That keeps drawing
 * editable and makes the compiled font a pure function of the project.
 *
 * Two compilers share that geometry:
 *   - OTF (CFF outlines) through opentype.js (MIT), already a Luma dependency.
 *   - TTF (glyf outlines) through the small writer below; opentype.js only
 *     writes CFF. Outlines are straight-segment polygons in both formats.
 */
import Clipper from "clipper-lib";
import { Font, Glyph, Path } from "opentype.js/dist/opentype.mjs";

export const GLYPH_SCHEMA = "luma-glyph/1";

const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWER = "abcdefghijklmnopqrstuvwxyz";
const DIGITS = "0123456789";
const PUNCTUATION = ".,;:!?'\"-()&@#/*+=%$_[]";

export const GLYPH_GROUPS: readonly { label: string; chars: readonly string[] }[] = [
  { label: "Uppercase", chars: [...UPPER] },
  { label: "Lowercase", chars: [...LOWER] },
  { label: "Figures", chars: [...DIGITS] },
  { label: "Punctuation", chars: [...PUNCTUATION] },
];
export const GLYPH_CHARSET: readonly string[] = GLYPH_GROUPS.flatMap(group => group.chars);

export const GLYPH_LIMITS = {
  strokesPerGlyph: 200,
  pointsPerStroke: 4000,
  pointsPerGlyph: 40000,
  coordinate: 4000,
  brushWidth: [4, 400] as const,
  advance: [0, 3000] as const,
  familyName: 31,
} as const;

export type Vec = [number, number];
export type BrushStroke = { kind: "brush"; points: Vec[]; width: number; widths?: number[] };
export type ShapeStroke = { kind: "shape"; points: Vec[]; smooth: boolean; cut: boolean };
export type GlyphStroke = BrushStroke | ShapeStroke;
export type GlyphDraft = { advanceWidth: number; strokes: GlyphStroke[] };

export type GlyphMetrics = {
  unitsPerEm: number;
  ascender: number;
  descender: number;
  xHeight: number;
  capHeight: number;
  defaultAdvance: number;
};

export type GlyphProject = {
  schema: typeof GLYPH_SCHEMA;
  familyName: string;
  styleName: string;
  metrics: GlyphMetrics;
  glyphs: Record<string, GlyphDraft>;
};

export const DEFAULT_METRICS: GlyphMetrics = { unitsPerEm: 1000, ascender: 800, descender: -200, xHeight: 500, capHeight: 700, defaultAdvance: 600 };

export function createGlyphProject(familyName = "My Glyph Font"): GlyphProject {
  return { schema: GLYPH_SCHEMA, familyName, styleName: "Regular", metrics: { ...DEFAULT_METRICS }, glyphs: {} };
}

const RESERVED_FAMILIES = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "inherit", "initial", "unset", "math", "emoji", "fangsong"]);

/** Family names are restricted so they are valid in CSS, the name table and PostScript names. */
export function validateFamilyName(name: string, taken: readonly string[] = []) {
  const clean = name.trim().replace(/\s+/g, " ");
  if (!/^[A-Za-z][A-Za-z0-9 ]*$/.test(clean)) throw new Error("Font name must start with a letter and use only letters, digits and spaces");
  if (clean.length > GLYPH_LIMITS.familyName) throw new Error(`Font name must be ${GLYPH_LIMITS.familyName} characters or fewer`);
  if (RESERVED_FAMILIES.has(clean.toLowerCase())) throw new Error("That name is reserved by CSS; choose another");
  if (taken.some(other => other.toLowerCase() === clean.toLowerCase())) throw new Error(`“${clean}” is already a Luma font; choose another name`);
  return clean;
}

export function postScriptName(project: Pick<GlyphProject, "familyName" | "styleName">) {
  return `${project.familyName.replace(/[^A-Za-z0-9]/g, "")}-${project.styleName.replace(/[^A-Za-z0-9]/g, "") || "Regular"}`.slice(0, 63);
}

// ---------------------------------------------------------------------------
// Validation (imported project files and localStorage are untrusted)
// ---------------------------------------------------------------------------

const finite = (v: unknown, lo: number, hi: number): v is number => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;

function validPoints(value: unknown, limit: number): Vec[] {
  if (!Array.isArray(value) || value.length > limit) throw new Error("Invalid glyph points");
  return value.map(p => {
    if (!Array.isArray(p) || p.length !== 2 || !finite(p[0], -GLYPH_LIMITS.coordinate, GLYPH_LIMITS.coordinate) || !finite(p[1], -GLYPH_LIMITS.coordinate, GLYPH_LIMITS.coordinate)) throw new Error("Invalid glyph point");
    return [p[0], p[1]] as Vec;
  });
}

export function validateGlyphProject(value: unknown): GlyphProject {
  if (!value || typeof value !== "object") throw new Error("Not a Glyph project");
  const v = value as Record<string, unknown>;
  if (v.schema !== GLYPH_SCHEMA) throw new Error("Not a Glyph project (unknown schema)");
  const familyName = validateFamilyName(String(v.familyName ?? ""));
  const styleName = typeof v.styleName === "string" && /^[A-Za-z0-9 ]{1,31}$/.test(v.styleName) ? v.styleName : "Regular";
  const m = (v.metrics ?? {}) as Record<string, unknown>;
  const metrics: GlyphMetrics = {
    unitsPerEm: 1000,
    ascender: finite(m.ascender, 100, 2000) ? Math.round(m.ascender) : DEFAULT_METRICS.ascender,
    descender: finite(m.descender, -1000, 0) ? Math.round(m.descender) : DEFAULT_METRICS.descender,
    xHeight: finite(m.xHeight, 50, 2000) ? Math.round(m.xHeight) : DEFAULT_METRICS.xHeight,
    capHeight: finite(m.capHeight, 50, 2000) ? Math.round(m.capHeight) : DEFAULT_METRICS.capHeight,
    defaultAdvance: finite(m.defaultAdvance, 50, 3000) ? Math.round(m.defaultAdvance) : DEFAULT_METRICS.defaultAdvance,
  };
  const glyphs: Record<string, GlyphDraft> = {};
  const source = v.glyphs && typeof v.glyphs === "object" ? v.glyphs as Record<string, unknown> : {};
  for (const [char, raw] of Object.entries(source)) {
    if (!GLYPH_CHARSET.includes(char) && char !== " ") continue;
    const g = raw as Record<string, unknown>;
    if (!g || typeof g !== "object" || !Array.isArray(g.strokes) || g.strokes.length > GLYPH_LIMITS.strokesPerGlyph) throw new Error(`Invalid glyph “${char}”`);
    let total = 0;
    const strokes: GlyphStroke[] = g.strokes.map((s: unknown) => {
      const stroke = s as Record<string, unknown>;
      const points = validPoints(stroke.points, GLYPH_LIMITS.pointsPerStroke);
      total += points.length;
      if (stroke.kind === "brush") {
        if (!finite(stroke.width, GLYPH_LIMITS.brushWidth[0], GLYPH_LIMITS.brushWidth[1])) throw new Error("Invalid brush width");
        const widths = Array.isArray(stroke.widths) && stroke.widths.length === points.length && stroke.widths.every(w => finite(w, 1, GLYPH_LIMITS.brushWidth[1])) ? stroke.widths as number[] : undefined;
        return { kind: "brush", points, width: stroke.width, ...(widths ? { widths } : {}) } satisfies BrushStroke;
      }
      if (stroke.kind === "shape") return { kind: "shape", points, smooth: stroke.smooth === true, cut: stroke.cut === true } satisfies ShapeStroke;
      throw new Error("Unknown stroke kind");
    });
    if (total > GLYPH_LIMITS.pointsPerGlyph) throw new Error(`Glyph “${char}” is too complex`);
    glyphs[char] = { advanceWidth: finite(g.advanceWidth, GLYPH_LIMITS.advance[0], GLYPH_LIMITS.advance[1]) ? Math.round(g.advanceWidth) : metrics.defaultAdvance, strokes };
  }
  return { schema: GLYPH_SCHEMA, familyName, styleName, metrics, glyphs };
}

// ---------------------------------------------------------------------------
// Geometry: strokes → outlines
// ---------------------------------------------------------------------------

/** Font-unit contour, integer coordinates. Outer contours counter-clockwise (y up), holes clockwise. */
export type Contour = Vec[];

const SCALE = 8; // Clipper works on integers; 1/8 unit precision before final rounding.
type IntPoint = { X: number; Y: number };

/** Ramer–Douglas–Peucker on an open polyline. */
export function simplifyPolyline(points: readonly Vec[], tolerance: number): Vec[] {
  if (points.length < 3) return points.slice();
  const keep = new Uint8Array(points.length); keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = points[a], [bx, by] = points[b], dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
    let worst = -1, index = -1;
    for (let i = a + 1; i < b; i++) {
      // A stroke that closes on its start has coincident endpoints; measure
      // from the point then, or every vertex looks collinear and the whole
      // loop collapses to a dot.
      const d = len < 1e-9 ? Math.hypot(points[i][0] - ax, points[i][1] - ay) : Math.abs((points[i][0] - ax) * dy - (points[i][1] - ay) * dx) / len;
      if (d > worst) { worst = d; index = i; }
    }
    if (worst > tolerance) { keep[index] = 1; stack.push([a, index], [index, b]); }
  }
  return points.filter((_, i) => keep[i]);
}

/** Chaikin corner cutting; keeps endpoints for open strokes. */
export function chaikin(points: readonly Vec[], iterations = 2, closed = false): Vec[] {
  let current = points.slice() as Vec[];
  for (let k = 0; k < iterations && current.length > 2; k++) {
    const next: Vec[] = closed ? [] : [current[0]];
    const n = current.length, segs = closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const [ax, ay] = current[i], [bx, by] = current[(i + 1) % n];
      next.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25], [ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
    }
    if (!closed) next.push(current[n - 1]);
    current = next;
  }
  return current;
}

/** Closed Catmull–Rom spline through the given points. */
export function catmullRomClosed(points: readonly Vec[], samples = 8): Vec[] {
  const n = points.length;
  if (n < 3) return points.slice();
  const out: Vec[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n], p1 = points[i], p2 = points[(i + 1) % n], p3 = points[(i + 2) % n];
    for (let s = 0; s < samples; s++) {
      const t = s / samples, t2 = t * t, t3 = t2 * t;
      out.push([
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  return out;
}

const toInt = (points: readonly Vec[]): IntPoint[] => points.map(([x, y]) => ({ X: Math.round(x * SCALE), Y: Math.round(y * SCALE) }));

function arc(cx: number, cy: number, r: number, from: number, to: number, out: Vec[]) {
  const steps = Math.max(4, Math.ceil(Math.abs(to - from) / (Math.PI / 12)));
  for (let i = 0; i <= steps; i++) { const t = from + (to - from) * i / steps; out.push([cx + Math.cos(t) * r, cy + Math.sin(t) * r]); }
}

/** Hull of two circles: the outline of one segment of a variable-width stroke. */
function taperedCapsule(a: Vec, ra: number, b: Vec, rb: number): Vec[] {
  const dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy);
  const out: Vec[] = [];
  if (d <= Math.abs(ra - rb) + 1e-6) {
    const [c, r] = ra >= rb ? [a, ra] : [b, rb];
    arc(c[0], c[1], r, 0, Math.PI * 2 - 0.01, out);
    return out;
  }
  const phi = Math.atan2(dy, dx), alpha = Math.acos((ra - rb) / d);
  arc(b[0], b[1], rb, phi - alpha, phi + alpha, out);
  arc(a[0], a[1], ra, phi + alpha, phi - alpha + Math.PI * 2, out);
  return out;
}

function brushPolygons(stroke: BrushStroke): IntPoint[][] {
  const pts = stroke.points;
  if (!pts.length) return [];
  const varying = stroke.widths && stroke.widths.some(w => Math.abs(w - stroke.widths![0]) > 0.5);
  if (!varying) {
    const path = pts.length === 1 ? [pts[0], [pts[0][0] + 0.01, pts[0][1]] as Vec] : chaikin(simplifyPolyline(pts, 1.5), 2);
    const out: IntPoint[][] = [];
    const offset = new Clipper.ClipperOffset(2, 0.6 * SCALE);
    offset.AddPaths([toInt(path)], Clipper.JoinType.jtRound, Clipper.EndType.etOpenRound);
    offset.Execute(out, (stroke.widths?.[0] ?? stroke.width) / 2 * SCALE);
    return out;
  }
  // Pressure strokes: union of per-segment capsules between successive radii.
  const widths = stroke.widths!;
  const polygons: IntPoint[][] = [];
  if (pts.length === 1) return [toInt(taperedCapsule(pts[0], widths[0] / 2, pts[0], widths[0] / 2))];
  for (let i = 0; i + 1 < pts.length; i++) polygons.push(toInt(taperedCapsule(pts[i], widths[i] / 2, pts[i + 1], widths[i + 1] / 2)));
  return polygons;
}

function shapePolygon(stroke: ShapeStroke): IntPoint[] {
  if (stroke.points.length < 3) return [];
  return toInt(stroke.smooth ? catmullRomClosed(stroke.points, 10) : stroke.points);
}

function closedSimplify(points: Vec[], tolerance: number): Vec[] {
  if (points.length < 4) return points;
  // Split at the farthest-apart pair so RDP's fixed endpoints are real corners.
  let far = 0, best = -1;
  for (let i = 1; i < points.length; i++) { const d = Math.hypot(points[i][0] - points[0][0], points[i][1] - points[0][1]); if (d > best) { best = d; far = i; } }
  const a = simplifyPolyline(points.slice(0, far + 1), tolerance), b = simplifyPolyline([...points.slice(far), points[0]], tolerance);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

const glyphCache = new WeakMap<GlyphDraft, Contour[]>();

/** Compiled outlines for a glyph: union of every additive stroke minus every cut shape. */
export function glyphContours(draft: GlyphDraft): Contour[] {
  const cached = glyphCache.get(draft);
  if (cached) return cached;
  const add: IntPoint[][] = [], cut: IntPoint[][] = [];
  for (const stroke of draft.strokes) {
    if (stroke.kind === "brush") add.push(...brushPolygons(stroke));
    else { const poly = shapePolygon(stroke); if (poly.length >= 3) (stroke.cut ? cut : add).push(poly); }
  }
  let result: IntPoint[][] = [];
  if (add.length) {
    const clipper = new Clipper.Clipper();
    clipper.AddPaths(add, Clipper.PolyType.ptSubject, true);
    if (cut.length) clipper.AddPaths(cut, Clipper.PolyType.ptClip, true);
    clipper.Execute(cut.length ? Clipper.ClipType.ctDifference : Clipper.ClipType.ctUnion, result, Clipper.PolyFillType.pftNonZero, Clipper.PolyFillType.pftNonZero);
    result = Clipper.Clipper.CleanPolygons(result, 0.4 * SCALE);
  }
  const contours: Contour[] = [];
  for (const poly of result) {
    if (poly.length < 3 || Math.abs(Clipper.Clipper.Area(poly)) < 6 * SCALE * SCALE) continue;
    const simplified = closedSimplify(poly.map(p => [p.X / SCALE, p.Y / SCALE] as Vec), 0.45);
    const rounded: Vec[] = [];
    for (const [x, y] of simplified) {
      const p: Vec = [Math.round(x), Math.round(y)];
      const last = rounded[rounded.length - 1];
      if (!last || last[0] !== p[0] || last[1] !== p[1]) rounded.push(p);
    }
    if (rounded.length > 2 && rounded[0][0] === rounded[rounded.length - 1][0] && rounded[0][1] === rounded[rounded.length - 1][1]) rounded.pop();
    if (rounded.length >= 3) contours.push(rounded);
  }
  glyphCache.set(draft, contours);
  return contours;
}

export function signedArea(contour: readonly Vec[]) {
  let area = 0;
  for (let i = 0; i < contour.length; i++) { const [ax, ay] = contour[i], [bx, by] = contour[(i + 1) % contour.length]; area += ax * by - bx * ay; }
  return area / 2;
}

export function contourBounds(contours: readonly Contour[]) {
  let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity;
  for (const c of contours) for (const [x, y] of c) { xMin = Math.min(xMin, x); yMin = Math.min(yMin, y); xMax = Math.max(xMax, x); yMax = Math.max(yMax, y); }
  return Number.isFinite(xMin) ? { xMin, yMin, xMax, yMax } : { xMin: 0, yMin: 0, xMax: 0, yMax: 0 };
}

/** Glyphs that will be compiled: those with at least one outline, in charset order. */
export function drawnGlyphs(project: GlyphProject) {
  return GLYPH_CHARSET.filter(char => project.glyphs[char] && glyphContours(project.glyphs[char]).length > 0);
}

/** Advance that leaves equal side bearings around the drawing. */
export function autoAdvance(draft: GlyphDraft, sideBearing = 60) {
  const contours = glyphContours(draft);
  if (!contours.length) return draft.advanceWidth;
  const { xMin, xMax } = contourBounds(contours);
  return Math.max(0, Math.round(xMax + Math.max(sideBearing, xMin)));
}

// ---------------------------------------------------------------------------
// Layout (live preview without compiling a font)
// ---------------------------------------------------------------------------

export type PreviewGlyph = { char: string; x: number; contours: Contour[]; missing: boolean };

export function layoutText(project: GlyphProject, text: string): { glyphs: PreviewGlyph[]; width: number } {
  const glyphs: PreviewGlyph[] = [];
  let x = 0;
  for (const char of [...text].slice(0, 400)) {
    if (char === " ") { x += Math.round(project.metrics.defaultAdvance * 0.45); continue; }
    const draft = project.glyphs[char];
    const contours = draft ? glyphContours(draft) : [];
    glyphs.push({ char, x, contours, missing: !contours.length });
    x += contours.length ? draft!.advanceWidth : project.metrics.defaultAdvance;
  }
  return { glyphs, width: x };
}

// ---------------------------------------------------------------------------
// OTF (CFF) via opentype.js
// ---------------------------------------------------------------------------

const glyphName = (char: string) => /^[A-Za-z0-9]$/.test(char) ? (/[0-9]/.test(char) ? ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"][Number(char)] : char) : `uni${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`;

function notdefContours(metrics: GlyphMetrics): Contour[] {
  const w = Math.round(metrics.defaultAdvance * 0.8), l = 50, t = metrics.capHeight, s = 40;
  return [[[l, 0], [w, 0], [w, t], [l, t]], [[l + s, s], [l + s, t - s], [w - s, t - s], [w - s, s]]];
}

function spaceAdvance(project: GlyphProject) {
  return project.glyphs[" "]?.advanceWidth ?? Math.round(project.metrics.defaultAdvance * 0.45);
}

export function buildOtf(project: GlyphProject): ArrayBuffer {
  const chars = drawnGlyphs(project);
  if (!chars.length) throw new Error("Draw at least one glyph before exporting");
  const toPath = (contours: Contour[]) => {
    const path = new Path();
    for (const contour of contours) {
      path.moveTo(contour[0][0], contour[0][1]);
      for (let i = 1; i < contour.length; i++) path.lineTo(contour[i][0], contour[i][1]);
      path.close();
    }
    return path;
  };
  const glyphs = [
    new Glyph({ name: ".notdef", advanceWidth: project.metrics.defaultAdvance, path: toPath(notdefContours(project.metrics)) }),
    new Glyph({ name: "space", unicode: 32, advanceWidth: spaceAdvance(project), path: new Path() }),
    ...chars.map(char => new Glyph({ name: glyphName(char), unicode: char.codePointAt(0)!, advanceWidth: project.glyphs[char].advanceWidth, path: toPath(glyphContours(project.glyphs[char])) })),
  ];
  const font = new Font({
    familyName: project.familyName,
    styleName: project.styleName,
    unitsPerEm: project.metrics.unitsPerEm,
    ascender: project.metrics.ascender,
    descender: project.metrics.descender,
    designer: "Made with Luma Glyph",
    manufacturer: "Luma Studio",
    glyphs,
    tables: { os2: { sxHeight: project.metrics.xHeight, sCapHeight: project.metrics.capHeight, fsType: 0 } },
  } as ConstructorParameters<typeof Font>[0]);
  return font.toArrayBuffer();
}

// ---------------------------------------------------------------------------
// TTF (glyf) writer
// ---------------------------------------------------------------------------

class Writer {
  private bytes: number[] = [];
  get length() { return this.bytes.length; }
  u8(v: number) { this.bytes.push(v & 255); return this; }
  u16(v: number) { this.bytes.push((v >> 8) & 255, v & 255); return this; }
  i16(v: number) { return this.u16(v < 0 ? v + 65536 : v); }
  u32(v: number) { this.bytes.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255); return this; }
  tag(s: string) { for (let i = 0; i < 4; i++) this.u8(s.charCodeAt(i)); return this; }
  raw(b: ArrayLike<number>) { for (let i = 0; i < b.length; i++) this.bytes.push(b[i]); return this; }
  pad4() { while (this.bytes.length % 4) this.bytes.push(0); return this; }
  done() { return Uint8Array.from(this.bytes); }
}

function checksum(data: Uint8Array) {
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) sum = (sum + ((data[i] << 24) | ((data[i + 1] ?? 0) << 16) | ((data[i + 2] ?? 0) << 8) | (data[i + 3] ?? 0))) >>> 0;
  return sum;
}

type TtfGlyph = { name: string; code?: number; advance: number; contours: Contour[] };

function encodeGlyf(contours: Contour[]): Uint8Array {
  if (!contours.length) return new Uint8Array(0);
  const w = new Writer();
  const { xMin, yMin, xMax, yMax } = contourBounds(contours);
  w.i16(contours.length).i16(xMin).i16(yMin).i16(xMax).i16(yMax);
  let end = -1;
  for (const c of contours) { end += c.length; w.u16(end); }
  w.u16(0); // no instructions
  const points = contours.flat();
  for (let i = 0; i < points.length; i++) w.u8(0x01); // on-curve, 16-bit signed deltas
  let px = 0; for (const [x] of points) { w.i16(x - px); px = x; }
  let py = 0; for (const [, y] of points) { w.i16(y - py); py = y; }
  return w.pad4().done();
}

function nameTable(project: GlyphProject) {
  const ps = postScriptName(project), full = `${project.familyName} ${project.styleName}`;
  const records: [number, string][] = [[0, "Made with Luma Glyph"], [1, project.familyName], [2, project.styleName], [3, `${ps};LumaGlyph;1.000`], [4, full], [5, "Version 1.000"], [6, ps]];
  const encoded: { platform: number; encoding: number; language: number; id: number; bytes: number[] }[] = [];
  for (const [id, text] of records) {
    encoded.push({ platform: 1, encoding: 0, language: 0, id, bytes: [...text].map(c => c.charCodeAt(0) & 127) });
  }
  for (const [id, text] of records) {
    const bytes: number[] = [];
    for (const c of text) { const code = c.charCodeAt(0); bytes.push(code >> 8, code & 255); }
    encoded.push({ platform: 3, encoding: 1, language: 0x409, id, bytes });
  }
  const w = new Writer();
  w.u16(0).u16(encoded.length).u16(6 + encoded.length * 12);
  let offset = 0;
  for (const r of encoded) { w.u16(r.platform).u16(r.encoding).u16(r.language).u16(r.id).u16(r.bytes.length).u16(offset); offset += r.bytes.length; }
  for (const r of encoded) w.raw(r.bytes);
  return w.done();
}

function cmapTable(glyphs: TtfGlyph[]) {
  const mapped = glyphs.map((g, id) => ({ code: g.code, id })).filter((g): g is { code: number; id: number } => g.code !== undefined).sort((a, b) => a.code - b.code);
  // One segment per run of consecutive codes with consecutive glyph ids.
  const segments: { start: number; end: number; delta: number }[] = [];
  for (const { code, id } of mapped) {
    const last = segments[segments.length - 1];
    if (last && code === last.end + 1 && (id - code) === last.delta) last.end = code;
    else segments.push({ start: code, end: code, delta: id - code });
  }
  segments.push({ start: 0xffff, end: 0xffff, delta: 1 });
  const segCount = segments.length, entrySelector = Math.floor(Math.log2(segCount)), searchRange = 2 * 2 ** entrySelector;
  const sub = new Writer();
  sub.u16(4).u16(16 + segCount * 8).u16(0).u16(segCount * 2).u16(searchRange).u16(entrySelector).u16(segCount * 2 - searchRange);
  for (const s of segments) sub.u16(s.end);
  sub.u16(0);
  for (const s of segments) sub.u16(s.start);
  for (const s of segments) sub.u16((s.delta + 65536) % 65536);
  for (let i = 0; i < segCount; i++) sub.u16(0);
  const subtable = sub.done();
  const w = new Writer();
  w.u16(0).u16(2);
  w.u16(0).u16(3).u32(4 + 2 * 8);
  w.u16(3).u16(1).u32(4 + 2 * 8);
  w.raw(subtable);
  return w.done();
}

export function buildTtf(project: GlyphProject, created = new Date()): ArrayBuffer {
  const chars = drawnGlyphs(project);
  if (!chars.length) throw new Error("Draw at least one glyph before exporting");
  const m = project.metrics;
  const glyphs: TtfGlyph[] = [
    { name: ".notdef", advance: m.defaultAdvance, contours: notdefContours(m) },
    { name: "space", code: 32, advance: spaceAdvance(project), contours: [] },
    ...chars.map(char => ({ name: glyphName(char), code: char.codePointAt(0)!, advance: project.glyphs[char].advanceWidth, contours: glyphContours(project.glyphs[char]) })),
  ];
  // TrueType wants outer contours clockwise (y up); our geometry is
  // counter-clockwise outer, the PostScript convention that CFF uses.
  const ttContours = glyphs.map(g => g.contours.map(c => c.slice().reverse()));
  const glyfParts = ttContours.map(encodeGlyf);
  const loca = new Writer(); let offset = 0;
  for (const part of glyfParts) { loca.u32(offset); offset += part.length; }
  loca.u32(offset);
  const glyf = new Writer(); for (const part of glyfParts) glyf.raw(part);

  const bounds = glyphs.map(g => contourBounds(g.contours));
  const drawn = bounds.filter((_, i) => glyphs[i].contours.length);
  const xMin = Math.min(...drawn.map(b => b.xMin)), yMin = Math.min(...drawn.map(b => b.yMin));
  const xMax = Math.max(...drawn.map(b => b.xMax)), yMax = Math.max(...drawn.map(b => b.yMax));
  const advanceMax = Math.max(...glyphs.map(g => g.advance));
  const lsbs = glyphs.map((g, i) => g.contours.length ? bounds[i].xMin : 0);
  const rsbs = glyphs.map((g, i) => g.contours.length ? g.advance - bounds[i].xMax : 0).filter((_, i) => glyphs[i].contours.length);
  const maxPoints = Math.max(...glyphs.map(g => g.contours.reduce((n, c) => n + c.length, 0)));
  const maxContours = Math.max(...glyphs.map(g => g.contours.length));

  const longDate = (date: Date) => { const s = Math.floor(date.getTime() / 1000) + 2082844800; return [Math.floor(s / 2 ** 32), s >>> 0] as const; };
  const [hi, lo] = longDate(created);
  const head = new Writer().u32(0x00010000).u32(0x00010000).u32(0).u32(0x5f0f3cf5).u16(0x000b).u16(m.unitsPerEm)
    .u32(hi).u32(lo).u32(hi).u32(lo).i16(xMin).i16(yMin).i16(xMax).i16(yMax).u16(0).u16(8).i16(2).i16(1).i16(0).done();
  const hhea = new Writer().u32(0x00010000).i16(m.ascender).i16(m.descender).i16(0).u16(advanceMax).i16(Math.min(...lsbs.filter((_, i) => glyphs[i].contours.length)))
    .i16(Math.min(...rsbs)).i16(Math.max(...bounds.map((b, i) => glyphs[i].contours.length ? lsbs[i] + (b.xMax - b.xMin) : 0))).i16(1).i16(0).i16(0)
    .i16(0).i16(0).i16(0).i16(0).i16(0).u16(glyphs.length).done();
  const maxp = new Writer().u32(0x00010000).u16(glyphs.length).u16(maxPoints).u16(maxContours).u16(0).u16(0).u16(2)
    .u16(0).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0).done();
  const hmtx = new Writer(); glyphs.forEach((g, i) => hmtx.u16(g.advance).i16(lsbs[i]));
  const codes = glyphs.map(g => g.code).filter((c): c is number => c !== undefined);
  const avg = Math.round(glyphs.slice(1).reduce((n, g) => n + g.advance, 0) / Math.max(1, glyphs.length - 1));
  const os2 = new Writer().u16(4).i16(avg).u16(400).u16(5).u16(0)
    .i16(650).i16(600).i16(0).i16(75).i16(650).i16(600).i16(0).i16(350).i16(50).i16(250)
    .i16(0).raw([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]).u32(1).u32(0).u32(0).u32(0).tag("LUMA").u16(0x00c0)
    .u16(Math.min(...codes)).u16(Math.max(...codes)).i16(m.ascender).i16(m.descender).i16(0)
    .u16(Math.max(m.ascender, yMax)).u16(Math.max(-m.descender, -yMin)).u32(1).u32(0)
    .i16(m.xHeight).i16(m.capHeight).u16(0).u16(32).u16(0).done();
  const post = new Writer().u32(0x00030000).u32(0).i16(-100).i16(50).u32(0).u32(0).u32(0).u32(0).u32(0).done();

  const tables: [string, Uint8Array][] = ([
    ["OS/2", os2], ["cmap", cmapTable(glyphs)], ["glyf", glyf.done()], ["head", head], ["hhea", hhea],
    ["hmtx", hmtx.done()], ["loca", loca.done()], ["maxp", maxp], ["name", nameTable(project)], ["post", post],
  ] as [string, Uint8Array][]).sort(([a], [b]) => (a < b ? -1 : 1));
  const numTables = tables.length, entrySelector = Math.floor(Math.log2(numTables)), searchRange = 16 * 2 ** entrySelector;
  const out = new Writer();
  out.u32(0x00010000).u16(numTables).u16(searchRange).u16(entrySelector).u16(numTables * 16 - searchRange);
  let at = 12 + numTables * 16;
  const placed = tables.map(([tag, data]) => { const record = { tag, data, offset: at }; at += Math.ceil(data.length / 4) * 4; return record; });
  for (const { tag, data, offset: o } of placed) out.tag(tag).u32(checksum(data)).u32(o).u32(data.length);
  for (const { data } of placed) out.raw(data).pad4();
  const bytes = out.done();
  const headOffset = placed.find(t => t.tag === "head")!.offset;
  const adjust = (0xb1b0afba - checksum(bytes)) >>> 0;
  new DataView(bytes.buffer).setUint32(headOffset + 8, adjust);
  return bytes.buffer;
}

export function fontFileName(project: GlyphProject, format: "otf" | "ttf") {
  return `${postScriptName(project)}.${format}`;
}
