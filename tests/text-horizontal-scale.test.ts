import test from "node:test";
import assert from "node:assert/strict";
import { testCanvas } from "./canvas-harness.ts";
import { createTextLayer, drawLayerContent, type TextStyle } from "../app/engine/document.ts";
import { importPsd, exportPhotoshopDocument } from "../app/engine/psd.ts";
import { readPsd, writePsd } from "../app/engine/ag-psd-io.ts";
import { encodeLumaProject, decodeLumaProject } from "../app/engine/project.ts";
import { Studio } from "../app/engine/studio.ts";

const base: TextStyle = { text: "Wide office", font: "32px sans-serif", color: "#143c5f", x: 200, y: 50, align: "center", lineHeight: 1.2 };

function traced(style: TextStyle) {
  const canvas = testCanvas(600, 180), ctx = canvas.getContext("2d")!;
  const calls: { text: string; x: number; y: number; a: number; d: number; width: number; font: string }[] = [];
  const fill = ctx.fillText.bind(ctx);
  ctx.fillText = (text, x, y) => {
    const m = ctx.getTransform();
    calls.push({ text, x: m.a * x + m.e, y: m.d * y + m.f, a: m.a, d: m.d, width: ctx.measureText(text).width * m.a, font: ctx.font });
    fill(text, x, y);
  };
  drawLayerContent(ctx, createTextLayer("Scale", style));
  return { calls, canvas };
}

test("text width is a geometric transform at the alignment anchor, not a CSS face selector", () => {
  const normal = traced({ ...base, paragraphs: [{ start: 0, end: base.text.length, style: {} }] }).calls[0];
  for (const percent of [50, 80, 125, 200]) {
    const scale = percent / 100;
    const result = traced({ ...base, defaultStyle: { fontStretch: percent } });
    const call = result.calls[0];
    assert.ok(Math.abs(call.a - scale) < 1e-6); assert.equal(call.d, 1); assert.equal(call.y, base.y);
    assert.ok(Math.abs(call.width - normal.width * scale) < 1e-5);
    assert.ok(Math.abs(call.x + call.width / 2 - base.x) < 1e-5);
    assert.equal(call.font, normal.font, "the same font face/size must be used");
    const expected = testCanvas(600, 180), ctx = expected.getContext("2d")!;
    ctx.translate(base.x, 0); ctx.scale(scale, 1); ctx.translate(-base.x, 0);
    ctx.font = normal.font; ctx.fontKerning = "normal"; ctx.fillStyle = base.color; ctx.textAlign = "center";
    ctx.fillText(base.text, base.x, base.y);
    assert.deepEqual(result.canvas.getContext("2d")!.getImageData(0, 0, 600, 180).data, ctx.getImageData(0, 0, 600, 180).data);
  }
});

test("mixed-width runs advance by scaled metrics without moving the baseline", () => {
  const result = traced({ ...base, text: "Wide Narrow", align: "left", runs: [
    { start: 0, end: 5, style: { fontStretch: 150 } }, { start: 5, end: 11, style: { fontStretch: 75 } },
  ] });
  assert.equal(result.calls.length, 2);
  const [first, second] = result.calls;
  assert.equal(first.a, 1.5); assert.equal(second.a, .75);
  assert.ok(Math.abs(second.x - first.x - first.width) < 1e-5);
  assert.equal(first.y, second.y);
});

test("tracked structured text excludes the trailing gap from center/right alignment", () => {
  for (const align of ["center", "right"] as const) for (const percent of [50, 100, 125, 200]) {
    const tracking = 300, track = tracking / 1000 * 32;
    const style = { ...base, text: "AB", align, tracking, defaultStyle: { fontStretch: percent }, paragraphs: [{ start: 0, end: 2, style: {} }] };
    const result = traced(style), expected = testCanvas(600, 180), ctx = expected.getContext("2d")!;
    ctx.translate(base.x, 0); ctx.scale(percent / 100, 1); ctx.translate(-base.x, 0);
    ctx.font = result.calls[0].font; ctx.fontKerning = "normal"; ctx.fillStyle = base.color; ctx.textAlign = align; ctx.letterSpacing = `${track}px`;
    ctx.fillText("AB", base.x + (align === "center" ? track / 2 : track), base.y);
    const a = result.canvas.getContext("2d")!.getImageData(0, 0, 600, 180).data, b = ctx.getImageData(0, 0, 600, 180).data;
    let maximum = 0;
    for (let i = 0; i < a.length; i++) maximum = Math.max(maximum, Math.abs(a[i] - b[i]));
    assert.equal(maximum, 0, `${align}, ${percent}%: tracked geometry shifted off its anchor`);
  }
});

test("paragraph wrapping uses scaled advance and leaves the frame/leading unchanged", () => {
  const normal = traced({ ...base, text: "Wide Wide", align: "left" }).calls[0];
  const style = { ...base, text: "Wide Wide", align: "left" as const, layout: "paragraph" as const, boxWidth: normal.width * 1.1, boxHeight: 150 };
  assert.equal(traced(style).calls.length, 1);
  const wide = traced({ ...style, defaultStyle: { fontStretch: 150 } }).calls;
  assert.deepEqual(wide.map(call => call.text), ["Wide", "Wide"]);
  assert.ok(Math.abs(wide[1].y - wide[0].y - 32 * base.lineHeight) < 1e-10);
  assert.equal(wide[0].x, base.x); assert.equal(wide[1].x, base.x);
});

test("imported scaled type remains editable and rendered at that width after native save/reopen", async () => {
  const input = writePsd({ width: 600, height: 180, children: [{ name: "Scaled text", text: {
    text: "Wide office", transform: [1, 0, 0, 1, 50, 60],
    style: { font: { name: "ArialMT" }, fontSize: 32, horizontalScale: 1.5 },
  } }] }, { noBackground: true });
  const original = await importPsd(input);
  const restored = (await decodeLumaProject(await encodeLumaProject(original, [], "Scaled type"))).doc;
  assert.equal(restored.layers[0].text!.defaultStyle!.fontStretch, 150);
  assert.equal(traced(restored.layers[0].text!).calls[0].a, 1.5);
  restored.layers[0].text!.text = "Edited office";
  const output = readPsd(exportPhotoshopDocument(restored).buffer).children![0].text!;
  assert.equal(output.text, "Edited office"); assert.equal(output.style!.horizontalScale, 1.5);
});

test("the text editing command, undo, redo and persisted history retain geometric width", async () => {
  const studio = new Studio(600, 180, testCanvas(1, 1));
  const reopened = new Studio(8, 8, testCanvas(1, 1));
  try {
    const layer = studio.addTextLayer("Wide office", base);
    studio.updateText(layer.id, { defaultStyle: { fontStretch: 150 } });
    assert.equal(traced(studio.findLayer(layer.id)!.text!).calls[0].a, 1.5);
    studio.undo();
    assert.equal(traced(studio.findLayer(layer.id)!.text!).calls[0].a, 1);
    studio.redo();
    const saved = await studio.prepareProjectSave();
    await reopened.importProject(saved.blob);
    assert.equal(traced(reopened.findLayer(layer.id)!.text!).calls[0].a, 1.5);
    reopened.undo();
    assert.equal(traced(reopened.findLayer(layer.id)!.text!).calls[0].a, 1);
    reopened.redo();
    assert.equal(traced(reopened.findLayer(layer.id)!.text!).calls[0].a, 1.5);
  } finally { studio.dispose(); reopened.dispose(); }
});
