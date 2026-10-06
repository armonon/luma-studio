import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "opentype.js/dist/opentype.mjs";
import {
  autoAdvance, buildOtf, buildTtf, createGlyphProject, drawnGlyphs, glyphContours, layoutText, signedArea,
  validateFamilyName, validateGlyphProject, GLYPH_CHARSET, type GlyphProject,
} from "../app/engine/glyph-font";

type TtPoint = { x: number; y: number; onCurve: boolean; lastPointOfContour?: boolean };
const pointsOf = (glyph: unknown) => (glyph as { points: TtPoint[] }).points;

/** A small project: "I" as one brush stroke, "O" as a ring stroke, "D" as a pen shape with a cut-out counter. */
function sampleProject(): GlyphProject {
  const project = createGlyphProject("Test Hand");
  project.glyphs.I = { advanceWidth: 300, strokes: [{ kind: "brush", points: [[150, 0], [150, 700]], width: 80 }] };
  const ring: [number, number][] = [];
  for (let i = 0; i <= 48; i++) { const t = i / 48 * Math.PI * 2; ring.push([350 + Math.cos(t) * 250, 350 + Math.sin(t) * 330]); }
  project.glyphs.O = { advanceWidth: 700, strokes: [{ kind: "brush", points: ring, width: 90 }] };
  project.glyphs.D = { advanceWidth: 650, strokes: [
    { kind: "shape", points: [[60, 0], [360, 0], [580, 200], [580, 500], [360, 700], [60, 700]], smooth: false, cut: false },
    { kind: "shape", points: [[160, 100], [330, 100], [480, 260], [480, 440], [330, 600], [160, 600]], smooth: false, cut: true },
  ] };
  return project;
}

test("a brush stroke compiles to one outline that covers the stroke with round caps", () => {
  const [contour, ...rest] = glyphContours(sampleProject().glyphs.I);
  assert.equal(rest.length, 0);
  const xs = contour.map(p => p[0]), ys = contour.map(p => p[1]);
  assert.ok(Math.abs(Math.min(...xs) - 110) <= 1 && Math.abs(Math.max(...xs) - 190) <= 1, "half the brush width either side");
  assert.ok(Math.abs(Math.min(...ys) + 40) <= 1 && Math.abs(Math.max(...ys) - 740) <= 1, "round caps extend by the radius");
  assert.ok(signedArea(contour) > 0, "outer contours are counter-clockwise (PostScript convention)");
});

test("a closed ring stroke yields an outer contour and an opposite-wound counter", () => {
  const contours = glyphContours(sampleProject().glyphs.O);
  assert.equal(contours.length, 2);
  const areas = contours.map(signedArea).sort((a, b) => b - a);
  assert.ok(areas[0] > 0 && areas[1] < 0, "the counter winds opposite to the outer contour so it renders as a hole");
});

test("a stroke that ends exactly where it started stays a loop (simplification regression)", () => {
  // Hand-drawn O: the pointer returns to the identical start point.
  const loop: [number, number][] = [[284, 585], [470, 511], [532, 312], [470, 114], [284, 40], [98, 114], [36, 312], [98, 511], [284, 585]];
  const dense = loop.flatMap((p, i) => i ? Array.from({ length: 8 }, (_, k) => [loop[i - 1][0] + (p[0] - loop[i - 1][0]) * (k + 1) / 8, loop[i - 1][1] + (p[1] - loop[i - 1][1]) * (k + 1) / 8] as [number, number]) : [p]);
  const contours = glyphContours({ advanceWidth: 600, strokes: [{ kind: "brush", points: dense, width: 60 }] });
  assert.equal(contours.length, 2, "outer contour plus counter");
  const { xMin, xMax } = contours.flat().reduce((b, [x]) => ({ xMin: Math.min(b.xMin, x), xMax: Math.max(b.xMax, x) }), { xMin: Infinity, xMax: -Infinity });
  assert.ok(xMax - xMin > 450, "the loop keeps its full width");
});

test("cut shapes subtract from additive strokes", () => {
  const project = sampleProject();
  const withCut = glyphContours(project.glyphs.D);
  assert.equal(withCut.length, 2);
  const solid = glyphContours({ ...project.glyphs.D, strokes: [project.glyphs.D.strokes[0]] });
  assert.equal(solid.length, 1);
  const total = (cs: typeof solid) => cs.reduce((sum, c) => sum + signedArea(c), 0);
  assert.ok(total(withCut) < total(solid) * 0.6, "the counter removes area");
});

test("pressure strokes (per-point widths) taper rather than using a single width", () => {
  const draft = { advanceWidth: 500, strokes: [{ kind: "brush" as const, points: [[100, 100], [400, 100]] as [number, number][], width: 60, widths: [20, 120] }] };
  const [contour] = glyphContours(draft);
  const near = (x: number) => contour.filter(p => Math.abs(p[0] - x) < 15).map(p => p[1]);
  const span = (ys: number[]) => Math.max(...ys) - Math.min(...ys);
  assert.ok(span(near(120)) < span(near(380)), "thin end is narrower than the thick end");
});

test("OTF export round-trips through opentype.js with the right names, cmap and metrics", () => {
  const project = sampleProject();
  const font = parse(buildOtf(project));
  assert.equal(font.getEnglishName("fontFamily"), "Test Hand");
  assert.equal(font.outlinesFormat, "cff");
  assert.equal(font.unitsPerEm, 1000);
  assert.equal(font.ascender, 800);
  assert.equal(font.descender, -200);
  const glyph = font.charToGlyph("O");
  assert.equal(glyph.advanceWidth, 700);
  const box = glyph.getBoundingBox();
  assert.ok(Math.abs(box.x1 - 55) <= 2 && Math.abs(box.x2 - 645) <= 2, `O bounds ${box.x1}..${box.x2}`);
  assert.equal(font.charToGlyph("Z").index, 0, "undrawn glyphs are omitted, not exported as blanks");
  assert.equal(font.charToGlyph(" ").advanceWidth, 270);
});

test("TTF export is a valid glyf font that opentype.js reads back identically", () => {
  const project = sampleProject();
  const bytes = buildTtf(project, new Date("2026-10-05T00:00:00Z"));
  const font = parse(bytes);
  assert.equal(font.outlinesFormat, "truetype");
  assert.equal(font.getEnglishName("fontFamily"), "Test Hand");
  assert.equal(font.getEnglishName("postScriptName"), "TestHand-Regular");
  assert.equal(font.tables.os2.sxHeight, 500);
  assert.equal(font.tables.os2.sCapHeight, 700);
  for (const char of ["I", "O", "D"]) {
    const glyph = font.charToGlyph(char);
    assert.notEqual(glyph.index, 0, `${char} is mapped`);
    assert.equal(glyph.advanceWidth, project.glyphs[char].advanceWidth);
    const contours = glyphContours(project.glyphs[char]);
    const expected = contours.reduce((n, c) => n + c.length, 0);
    assert.equal(pointsOf(glyph).length, expected, `${char} keeps every outline point`);
    assert.ok(pointsOf(glyph).every(p => p.onCurve));
  }
  // TrueType winds outer contours clockwise: the reverse of the CFF output.
  const o = font.charToGlyph("O");
  const firstEnd = pointsOf(o).findIndex(p => p.lastPointOfContour);
  const outer = pointsOf(o).slice(0, firstEnd + 1).map(p => [p.x, p.y] as [number, number]);
  assert.ok(Math.abs(signedArea(outer)) > 1000);
  const cff = glyphContours(project.glyphs.O);
  assert.equal(Math.sign(signedArea(outer)), -Math.sign(signedArea(cff.find(c => c.length === outer.length) ?? cff[0])));
});

test("TTF checksums are self-consistent (head checkSumAdjustment makes the file sum to B1B0AFBA)", () => {
  const bytes = new Uint8Array(buildTtf(sampleProject()));
  let sum = 0;
  for (let i = 0; i < bytes.length; i += 4) sum = (sum + ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3])) >>> 0;
  assert.equal(sum, 0xb1b0afba);
  const view = new DataView(bytes.buffer), tables = view.getUint16(4);
  for (let t = 0; t < tables; t++) {
    const at = 12 + t * 16, offset = view.getUint32(at + 8), length = view.getUint32(at + 12);
    assert.equal(offset % 4, 0, "tables are 4-byte aligned");
    assert.ok(offset + length <= bytes.length);
  }
});

test("TTF shapes in HarfBuzz with the drawn advances", async () => {
  const hb = await import("harfbuzzjs");
  const face = new hb.Face(new hb.Blob(buildTtf(sampleProject())), 0);
  const font = new hb.Font(face);
  const buffer = new hb.Buffer();
  buffer.addText("DIO");
  buffer.guessSegmentProperties();
  hb.shape(font, buffer);
  const glyphs = buffer.getGlyphInfosAndPositions();
  assert.deepEqual(glyphs.map(g => g.xAdvance), [650, 300, 700]);
  assert.ok(glyphs.every(g => g.codepoint > 1), "every character maps to a real glyph");
});

test("export refuses an empty project instead of writing a font of blanks", () => {
  assert.throws(() => buildOtf(createGlyphProject("Empty")), /Draw at least one glyph/);
  assert.throws(() => buildTtf(createGlyphProject("Empty")), /Draw at least one glyph/);
});

test("project validation rejects hostile or malformed input and drops unknown glyphs", () => {
  assert.throws(() => validateGlyphProject({ schema: "other" }), /schema/);
  assert.throws(() => validateGlyphProject({ ...sampleProject(), familyName: "<script>" }), /letters/);
  const tooFar = sampleProject(); tooFar.glyphs.I.strokes[0].points[0] = [1e9, 0];
  assert.throws(() => validateGlyphProject(JSON.parse(JSON.stringify(tooFar))), /Invalid glyph point/);
  const extra = JSON.parse(JSON.stringify(sampleProject())); extra.glyphs["\u0000"] = extra.glyphs.I;
  const valid = validateGlyphProject(extra);
  assert.deepEqual(Object.keys(valid.glyphs).sort(), ["D", "I", "O"]);
  assert.deepEqual(drawnGlyphs(valid), ["D", "I", "O"].sort((a, b) => GLYPH_CHARSET.indexOf(a) - GLYPH_CHARSET.indexOf(b)));
});

test("family names must be CSS/PostScript safe and must not shadow existing fonts", () => {
  assert.equal(validateFamilyName("  My   Font 2 "), "My Font 2");
  assert.throws(() => validateFamilyName("serif"), /reserved/);
  assert.throws(() => validateFamilyName("Lato", ["Lato"]), /already/);
  assert.throws(() => validateFamilyName("x".repeat(40)), /31/);
});

test("auto advance and preview layout use the drawn outlines", () => {
  const project = sampleProject();
  assert.equal(autoAdvance(project.glyphs.I, 60), 300, "bearing mirrors the drawn left bearing");
  const layout = layoutText(project, "IO Z");
  assert.deepEqual(layout.glyphs.map(g => [g.char, g.x, g.missing]), [["I", 0, false], ["O", 300, false], ["Z", 1270, true]]);
});
