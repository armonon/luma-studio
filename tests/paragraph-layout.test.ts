import test from "node:test";
import assert from "node:assert/strict";
import { testCanvas } from "./canvas-harness.ts";
import { createTextLayer, drawLayerContent, paragraphCapHeight, type TextStyle } from "../app/engine/document.ts";
import { sfntCapHeightRatio } from "../app/engine/font-cap-height.ts";
import { validateOutlineText } from "../app/engine/text-outline-model.ts";

function trace(style: Partial<TextStyle> = {}) {
  const canvas = testCanvas(600, 400), ctx = canvas.getContext("2d")!;
  const text: TextStyle = { text: "one two three", font: "24px sans-serif", color: "#000", align: "left", lineHeight: 1.25,
    x: 40, y: 50, layout: "paragraph", boxWidth: 300, boxHeight: 250,
    paragraphs: [{ start: 0, end: 100, style: {} }], ...style };
  const calls: { text: string; x: number; y: number }[] = [];
  const fill = ctx.fillText.bind(ctx);
  ctx.fillText = (value, x, y) => { calls.push({ text: value, x, y }); fill(value, x, y); };
  drawLayerContent(ctx, createTextLayer("Paragraph", text));
  return { calls, text, ctx };
}

test("trailing breakable spaces never force a fitting word onto the next line", () => {
  const context = testCanvas(1, 1).getContext("2d")!; context.font = "400 24px sans-serif";
  const width = context.measureText("one two").width + .1;
  const { calls } = trace({ boxWidth: width });
  assert.deepEqual(calls.map(call => call.text), ["one two", "three"]);
  assert.equal(calls[1].y - calls[0].y, 30);
});

test("centre and right alignment exclude trailing line whitespace", () => {
  for (const align of ["center", "right"] as const) {
    const plain = trace({ text: "one two", align }), padded = trace({ text: "one two   ", align });
    assert.deepEqual(padded.calls, plain.calls);
  }
  assert.equal(trace({ text: "one\u00a0" }).calls[0].text, "one\u00a0", "nonbreaking spaces remain part of the story measure");
});

test("top-anchored imported frames use font cap-height while existing baseline text stays stable", () => {
  const baseline = trace(), framed = trace({ frameOrigin: "top" });
  const offset = paragraphCapHeight(framed.ctx, framed.text);
  assert.equal(baseline.calls[0].y, 50);
  assert.equal(framed.calls[0].y, 50 + offset);
  assert.ok(offset > 0 && offset < 24);
  assert.throws(() => validateOutlineText({ ...framed.text, paragraphs: undefined }), /first-baseline metrics/);
});

test("SFNT cap-height reading bounds every table access and rejects invalid metrics", () => {
  const bytes = new ArrayBuffer(160), view = new DataView(bytes);
  view.setUint16(4, 2);
  view.setUint32(12, 0x68656164); view.setUint32(20, 44); view.setUint32(24, 20);
  view.setUint32(28, 0x4f532f32); view.setUint32(36, 64); view.setUint32(40, 90);
  view.setUint16(62, 2048); view.setUint16(64, 3); view.setInt16(152, 1467);
  assert.equal(sfntCapHeightRatio(bytes), 1467 / 2048);
  for (const size of [0, 8, 30, 80, 153]) assert.equal(sfntCapHeightRatio(bytes.slice(0, size)), undefined);
  view.setUint32(36, 0xfffffff0); assert.equal(sfntCapHeightRatio(bytes), undefined);
  view.setUint32(36, 64); view.setInt16(152, -1); assert.equal(sfntCapHeightRatio(bytes), undefined);
});
