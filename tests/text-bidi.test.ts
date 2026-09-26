import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shapeTextOutlines } from "../app/engine/text-shaping.ts";
import { visualTextRuns } from "../app/engine/text-bidi.ts";
import { bundledFontFace } from "../app/engine/bundled-fonts.ts";
import type { TextStyle } from "../app/engine/document.ts";

const source = (text: string, family = "Noto Sans Arabic"): TextStyle => ({ text, font: `400 64px "${family}"`, x: 0, y: 64, color: "#ffffff", align: "start", lineHeight: 1.2, direction: "auto" });
const font = (family: string) => {
  const data = readFileSync(new URL(`../public/fonts/${bundledFontFace(family).file}`, import.meta.url));
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
};
const shape = (value: TextStyle, family = "Noto Sans Arabic") => shapeTextOutlines(value, font(family));

test("Arabic outlines use joined RTL HarfBuzz glyphs and direction-aware anchors", async () => {
  const input = source("سلام"), actual = await shape(input);
  const hb = await import("harfbuzzjs");
  const face = new hb.Face(new hb.Blob(font("Noto Sans Arabic")), 0), hbFont = new hb.Font(face);
  hbFont.setScale(face.upem, face.upem); hbFont.setVariations([new hb.Variation("wght", 400)]);
  const buffer = new hb.Buffer(); buffer.addText(input.text); buffer.guessSegmentProperties();
  hb.shape(hbFont, buffer);
  assert.deepEqual(actual.glyphs, buffer.getGlyphInfos().map(g => g.codepoint));
  assert.ok(actual.paths.flatMap(p => p.commands).filter(c => c.type !== "Z").every(c => c.x < 1));
  const left = await shape({ ...input, align: "left" });
  assert.equal(actual.lineWidths[0], left.lineWidths[0]);
  const a = actual.paths[0].commands[0], b = left.paths[0].commands[0];
  assert.ok(a.type !== "Z" && b.type !== "Z" && Math.abs(b.x - a.x - actual.lineWidths[0]) < 1e-7);
});

test("mixed Hebrew, Latin and numbers preserve logical substrings in visual run order", async () => {
  const input = source("אבג ABC 123 דהו", "Noto Sans Hebrew");
  const { runs, base } = visualTextRuns(input, 0, input.text.length);
  assert.equal(base, 1);
  assert.equal(input.text.slice(runs[0].start, runs[0].end), " דהו");
  assert.ok(runs.some(run => input.text.slice(run.start, run.end) === "ABC 123" && run.level === 2));
  const actual = await shape(input, "Noto Sans Hebrew");
  assert.ok(actual.glyphs.length && actual.glyphs.every(Boolean));
});

test("Indic shaping retains conjuncts and combining clusters", async () => {
  const input = source("क्षि भारत", "Rajdhani");
  const result = await shape(input, "Rajdhani");
  assert.ok(result.glyphs.every(Boolean));
  assert.notEqual(result.glyphs.length, [...input.text].length);
  const mesh = await import("../app/engine/text-mesh.ts"), defaults = await import("../app/engine/text-3d.ts");
  const object = mesh.createShapedTextMesh(input, defaults.DEFAULT_TEXT_SPATIAL, result);
  try { assert.ok(object.geometry.getAttribute("position").count > 0); }
  finally { mesh.disposeTextMesh(object); }
});

test("RTL paragraph wraps at spaces with paragraph direction retained on numeric lines", async () => {
  const input = { ...source("مرحبا مرحبا 123 456 مرحبا"), layout: "paragraph" as const, boxWidth: 180, boxHeight: 800 };
  const result = await shape(input);
  assert.ok(result.lineWidths.length > 1);
  assert.ok(result.lineWidths.every(width => width <= 180));
  await assert.rejects(shape({ ...input, boxHeight: 1 }), /overflows/);
  await assert.rejects(shape({ ...input, justify: true }), /non-justified/);
});

test("style changes preserve Arabic joining context and honor variable weights", async () => {
  const input = source("سلام");
  const normal = await shape(input);
  const split = await shape({ ...input, runs: [{ start: 0, end: 1, style: { fontSize: 64 } }] });
  assert.deepEqual(split.glyphs, normal.glyphs);
  const bold = await shape({ ...input, defaultStyle: { fontWeight: 800 } });
  assert.notDeepEqual(bold.paths, normal.paths);
});

test("line-local ordering resets trailing spaces without changing paragraph direction", () => {
  const input = source("אבג ABC\nאבג ABC  ", "Noto Sans Hebrew");
  const start = input.text.indexOf("\n") + 1;
  const result = visualTextRuns(input, start, input.text.length);
  assert.equal(input.text.slice(result.runs[0].start, result.runs[0].end), "  ");
  assert.equal(result.runs[0].level, 1);
});

test("missing script coverage and bidi controls fail explicitly", async () => {
  await assert.rejects(shape(source("אבג")), /no outline/);
  await assert.rejects(shape(source("a\u202eb")), /Bidi/);
});
