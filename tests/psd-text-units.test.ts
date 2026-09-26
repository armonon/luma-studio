import test from "node:test";
import assert from "node:assert/strict";
import "./canvas-harness.ts";
import { readPsd, writePsd } from "../app/engine/ag-psd-io.ts";
import { importPsd, exportPhotoshopDocument, photoshopCompatibilityReport } from "../app/engine/psd.ts";
import { encodeLumaProject, decodeLumaProject } from "../app/engine/project.ts";

for (const automatic of [true, false]) test(`Photoshop text scale and ${automatic ? "automatic" : "manual"} leading survive edit/native reopen/export`, async () => {
  const bytes = writePsd({ width: 120, height: 100, children: [{ name: "Two lines", text: {
    text: "First\nSecond", transform: [1, 0, 0, 1, 5, 25],
    style: { font: { name: "ArialMT" }, fontSize: 20, horizontalScale: 1.25, autoLeading: automatic, leading: automatic ? .01 : 18 },
    paragraphStyle: { autoLeading: 1.4 },
    styleRuns: [{ length: 6, style: { horizontalScale: 1.25 } }, { length: 6, style: { horizontalScale: .8 } }],
  } }] }, { noBackground: true });
  const doc = await importPsd(bytes), text = doc.layers[0].text!;
  assert.equal(text.lineHeight, automatic ? 1.4 : .9);
  assert.equal(text.defaultStyle!.fontStretch, 125);
  assert.equal(text.defaultStyle!.axes!.wdth, undefined, "character scaling must not also change a variable-font width axis");
  assert.ok(text.runs!.every(run => run.style.axes!.wdth === undefined));
  assert.deepEqual(text.runs!.map(run => run.style.fontStretch), [125, 80]);
  text.text = "Third\nSecond";
  const reopened = (await decodeLumaProject(await encodeLumaProject(doc, [], "Text units"))).doc;
  const output = readPsd(exportPhotoshopDocument(reopened).buffer).children![0].text!;
  const styles = (output.styleRuns ?? []).map(run => ({ ...output.style, ...run.style }));
  assert.deepEqual(styles.map(style => style.horizontalScale), [1.25, .8]);
  assert.ok(styles.every(style => style.autoLeading === false), "explicit Luma line height must not be replaced by Photoshop auto-leading");
  assert.ok(styles.every(style => style.leading === (automatic ? 28 : 18)));
});

for (const justification of ["left", "center", "right"] as const) test(`Photoshop ${justification} paragraph frames and paragraph styles survive edited native round trips`, async () => {
  const bytes = writePsd({ width: 600, height: 400, children: [{ name: "Paragraph", text: {
    text: "First story\nSecond", transform: [1, 0, 0, 1, 40, 40], shapeType: "box", boxBounds: [10, 20, 310, 270],
    style: { font: { name: "ArialMT" }, fontSize: 24, autoLeading: false, leading: 30 },
    paragraphStyle: { justification }, paragraphStyleRuns: [
      { length: 12, style: { firstLineIndent: 8, startIndent: 2, endIndent: 3, spaceBefore: 4, spaceAfter: 5 } },
      { length: 6, style: { firstLineIndent: 1, spaceBefore: 2, spaceAfter: 7 } },
    ],
  } }] }, { noBackground: true });
  const doc = await importPsd(bytes), text = doc.layers[0].text!;
  assert.equal(text.layout, "paragraph"); assert.equal(text.boxWidth, 300); assert.equal(text.boxHeight, 250);
  assert.equal(text.x, justification === "left" ? 10 : justification === "center" ? 160 : 310);
  assert.equal(text.y, 20);
  assert.deepEqual(text.paragraphs!.map(run => run.style.spaceAfter), [5, 7]);
  text.text = "Third story\nSecond";
  const reopened = (await decodeLumaProject(await encodeLumaProject(doc, [], "Paragraph"))).doc;
  const exported = exportPhotoshopDocument(reopened);
  assert.ok(exported.report.issues.some(issue => issue.code === "PARAGRAPH_LAYOUT_REQUIRES_REVIEW"));
  const output = readPsd(exported.buffer).children![0].text!;
  assert.equal(output.shapeType, "box");
  const [left, top, right, bottom] = output.boxBounds!;
  assert.equal(right - left, 300); assert.equal(bottom - top, 250);
  assert.equal(output.transform![4] + left, 50); assert.equal(output.transform![5] + top, 60);
  const paragraphs = output.paragraphStyleRuns!.map(run => ({ ...output.paragraphStyle, ...run.style }));
  assert.deepEqual(paragraphs.map(style => style.firstLineIndent), [8, 1]);
  assert.deepEqual(paragraphs.map(style => style.spaceAfter), [5, 7]);
  assert.ok(paragraphs.every(style => style.justification === justification));
});

test("zero or non-finite paragraph frames are refused rather than silently becoming point text", async () => {
  const input = writePsd({ width: 32, height: 32, children: [{ text: { text: "Bad", shapeType: "box", boxBounds: [0, 0, 0, 0] } }] }, { noBackground: true });
  await assert.rejects(importPsd(input), /paragraph frame is invalid/);
  const valid = writePsd({ width: 32, height: 32, children: [{ text: { text: "Good", shapeType: "box", boxBounds: [0, 0, 20, 20] } }] }, { noBackground: true });
  const doc = await importPsd(valid);
  doc.layers[0].text!.boxWidth = NaN;
  const report = photoshopCompatibilityReport(doc);
  assert.equal(report.canExport, false);
  assert.ok(report.issues.some(issue => issue.code === "TEXT_FRAME_INVALID"));
  assert.throws(() => exportPhotoshopDocument(doc), /frame width/);
});
