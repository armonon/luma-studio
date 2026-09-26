import test from "node:test";
import assert from "node:assert/strict";
import { GlobalFonts } from "@napi-rs/canvas";
import { testCanvas } from "./canvas-harness";
import { createTextLayer, drawLayerContent, type TextStyle } from "../app/engine/document";
import { bundledFontFace } from "../app/engine/bundled-fonts";
import { bidiLineOrder, physicalTextAlignment } from "../app/engine/text-bidi";

GlobalFonts.registerFromPath(new URL(`../public/fonts/${bundledFontFace("Noto Sans Arabic").file}`, import.meta.url).pathname, "Noto Sans Arabic");

for (const text of ["سلام", "office"]) test(`color-only spans preserve the full shaped context: ${text}`, () => {
  const base: TextStyle = { text, font: '400 64px "Noto Sans Arabic"', color: "#ffffff", x: 220, y: 100, align: "center", lineHeight: 1.2, direction: "auto", runs: [{ start: 0, end: 1, style: { color: "#ffffff" } }] };
  const plain = testCanvas(440, 180), redReference = testCanvas(440, 180), colored = testCanvas(440, 180);
  drawLayerContent(plain.getContext("2d")!, createTextLayer("Plain", base));
  drawLayerContent(redReference.getContext("2d")!, createTextLayer("Red", { ...base, color: "#ff0000", runs: [{ start: 0, end: 1, style: { color: "#ff0000" } }] }));
  const ctx = colored.getContext("2d")!, calls: string[] = [], fill = ctx.fillText.bind(ctx);
  ctx.fillText = (value, x, y) => { calls.push(value); fill(value, x, y); };
  drawLayerContent(ctx, createTextLayer("Colored", { ...base, runs: [{ start: 0, end: 1, style: { color: "#ff0000" } }] }));
  assert.equal(calls.length, 2);
  assert.ok(calls.every(value => value === text), "paint must not independently shape a substring");
  const a = plain.getContext("2d")!.getImageData(0, 0, 440, 180).data;
  const b = ctx.getImageData(0, 0, 440, 180).data;
  const r = redReference.getContext("2d")!.getImageData(0, 0, 440, 180).data;
  let alphaError = 0, opaque = 0, red = 0, white = 0;
  for (let i = 0; i < a.length; i += 4) {
    // Skia's coverage is color dependent. Compare against the matching solid
    // color reference, not white glyphs with different gamma compensation.
    const expected = b[i] > b[i + 1] * 2 ? r : a;
    alphaError += Math.abs(expected[i + 3] - b[i + 3]);
    if (a[i + 3] > 0) opaque++;
    if (b[i + 3] > 200 && b[i] > 200) { if (b[i + 1] < 10) red++; else if (b[i + 1] > 200) white++; }
  }
  assert.ok(opaque > 100 && red > 10 && white > 10);
  assert.ok(alphaError / opaque < 1, `shared glyph geometry must stay stable; mean alpha error ${alphaError / opaque}`);
});

for (const styled of [false, true]) test(`RTL start/end use paragraph direction, with styled=${styled}`, () => {
  const base: TextStyle = { text: "سلام", font: '400 64px "Noto Sans Arabic"', color: "#ffffff", x: 220, y: 100, align: "start", lineHeight: 1.2, direction: "auto",
    ...(styled ? { runs: [{ start: 0, end: 1, style: { color: "#ffffff" } }] } : {}) };
  const pixels = (align: TextStyle["align"]) => {
    const canvas = testCanvas(440, 180);
    drawLayerContent(canvas.getContext("2d")!, createTextLayer("RTL", { ...base, align }));
    return canvas.getContext("2d")!.getImageData(0, 0, 440, 180).data;
  };
  assert.deepEqual(pixels("start"), pixels("right"));
  assert.deepEqual(pixels("end"), pixels("left"));
  assert.notDeepEqual(pixels("start"), pixels("end"));
});

test("wrapped numeric lines retain their RTL paragraph and physical alignment", () => {
  const text = { text: "مرحبا 123 456", direction: "auto" as const };
  const line = bidiLineOrder(text, 6, text.text.length);
  assert.equal(line.base, 1);
  assert.equal(physicalTextAlignment("start", line.base), "right");
  assert.equal(physicalTextAlignment("end", line.base), "left");
  assert.equal(bidiLineOrder({ text: "مرحبا\nABC", direction: "auto" }, 6, 9).base, 0);
});

test("single-run preview honors authoritative default font, color and tracking", () => {
  const base: TextStyle = { text: "Luma", font: "400 20px serif", color: "#ffffff", x: 20, y: 80, align: "left", lineHeight: 1.2 };
  const pixels = (style: TextStyle) => {
    const canvas = testCanvas(440, 180);
    drawLayerContent(canvas.getContext("2d")!, createTextLayer("Styled", style));
    return canvas.getContext("2d")!.getImageData(0, 0, 440, 180).data;
  };
  assert.deepEqual(pixels({ ...base, defaultStyle: { fontFamily: "sans-serif", fontWeight: 700, fontSize: 48, color: "#ff0000", tracking: 100 } }),
    pixels({ ...base, font: "700 48px sans-serif", color: "#ff0000", tracking: 100 }));
});
