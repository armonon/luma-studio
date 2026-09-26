import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createDocument, createTextLayer, type TextStyle } from "../app/engine/document.ts";
import {
  applyTextRunStyle,
  normalizeTextRuns,
  parseLegacyCanvasFont,
  resolvedTextStyleAt,
  textRunsAfterContentEdit,
  withDefaultTextStyle,
} from "../app/engine/text-model.ts";
import { renderClean } from "../app/engine/renderer.ts";
import { pixelAt, testCanvas } from "./canvas-harness.ts";
import {
  executeTypographyCommand,
  typographyCommandForKeyboard,
} from "../app/studio/typography-command-registry.ts";

const BASE: TextStyle = {
  schemaVersion: 2,
  text: "Modern type",
  font: "700 48px Inter, system-ui, sans-serif",
  color: "#ffffff",
  align: "left",
  lineHeight: 1.2,
  x: 12,
  y: 70,
  defaultStyle: {
    fontFamily: "Inter, system-ui, sans-serif",
    fontSize: 48,
    fontWeight: 700,
    color: "#ffffff",
  },
};

test("legacy canvas fonts migrate into structured defaults without changing the source", () => {
  assert.deepEqual(parseLegacyCanvasFont("italic 700 96px 'Inter', system-ui, sans-serif"), {
    fontFamily: "'Inter', system-ui, sans-serif",
    fontSize: 96,
    fontWeight: 700,
    fontStyle: "italic",
  });
  const patch = withDefaultTextStyle(BASE, { fontWeight: 400, fontSize: 72 });
  assert.match(patch.font!, /400 72px Inter/);
  assert.equal(patch.schemaVersion, 2);
  assert.equal(patch.defaultStyle?.fontSize, 72);
  assert.equal(BASE.defaultStyle?.fontSize, 48);
});

test("character styling splits, preserves and re-merges UTF-16 ranges", () => {
  const red = applyTextRunStyle(BASE, 0, 6, { color: "#ff0000" });
  const boldTail = applyTextRunStyle({ ...BASE, runs: red }, 3, 11, { fontWeight: 800 });
  assert.deepEqual(boldTail, [
    { start: 0, end: 3, style: { color: "#ff0000" } },
    { start: 3, end: 6, style: { color: "#ff0000", fontWeight: 800 } },
    { start: 6, end: 11, style: { fontWeight: 800 } },
  ]);
  const styled = { ...BASE, runs: boldTail };
  assert.equal(resolvedTextStyleAt(styled, 1).color, "#ff0000");
  assert.equal(resolvedTextStyleAt(styled, 8).fontWeight, 800);
  assert.equal(normalizeTextRuns(boldTail, 6).at(-1)?.end, 6);
  const inserted = textRunsAfterContentEdit({ ...BASE, text: "ABCD", runs: [{ start: 0, end: 2, style: { fontWeight: 800 } }, { start: 2, end: 4, style: { fontStyle: "italic" } }] }, "AB-new-CD");
  assert.deepEqual(inserted, [
    { start: 0, end: 2, style: { fontWeight: 800 } },
    { start: 7, end: 9, style: { fontStyle: "italic" } },
  ]);
});

test("structured text renders independent live colors inside one layer", () => {
  const doc = createDocument(220, 100);
  doc.layers = [createTextLayer("Rich type", {
    ...BASE,
    text: "AB",
    runs: [
      { start: 0, end: 1, style: { color: "#ff2020" } },
      { start: 1, end: 2, style: { color: "#2080ff" } },
    ],
  })];
  const canvas = testCanvas(220, 100);
  renderClean(doc, canvas);
  let red = 0;
  let blue = 0;
  for (let y = 0; y < 100; y += 1) for (let x = 0; x < 220; x += 1) {
    const pixel = pixelAt(canvas, x, y);
    if (pixel.a > 20 && pixel.r > pixel.b * 1.8) red += 1;
    if (pixel.a > 20 && pixel.b > pixel.r * 1.8) blue += 1;
  }
  assert.ok(red > 20, `expected red glyph ink, found ${red} pixels`);
  assert.ok(blue > 20, `expected blue glyph ink, found ${blue} pixels`);
});

test("typography buttons and keyboard shortcuts execute the same registered commands", () => {
  assert.equal(typographyCommandForKeyboard({ key: "b", metaKey: true, ctrlKey: false, altKey: false }), "type.bold");
  assert.equal(typographyCommandForKeyboard({ key: "i", metaKey: false, ctrlKey: true, altKey: false }), "type.italic");
  assert.equal(typographyCommandForKeyboard({ key: "b", metaKey: false, ctrlKey: false, altKey: false }), null);
  const style = resolvedTextStyleAt(BASE, 0);
  let patch = {};
  const command = executeTypographyCommand("type.bold", style, (next) => { patch = next; });
  assert.equal(command.shortcut, "CmdOrCtrl+B");
  assert.deepEqual(patch, { fontWeight: 400, axes: { wght: 400 } });
});

test("the type editor is wired into the contextual inspector, options bar and Space HUD", () => {
  const page = readFileSync(new URL("../app/studio/page.tsx", import.meta.url), "utf8");
  const panel = readFileSync(new URL("../app/studio/panels/type-panel.tsx", import.meta.url), "utf8");
  const toolbar = readFileSync(new URL("../app/studio/context-toolbar.tsx", import.meta.url), "utf8");
  assert.match(page, /<TypePanel/);
  assert.match(page, /choice\("font-family"/);
  assert.match(page, /choice\("text-direction"/);
  assert.match(panel, /applyTextRunStyle/);
  assert.match(panel, /typographyCommandForKeyboard/);
  assert.match(panel, /Weight axis/);
  assert.match(panel, /<TextAppearanceEditor appearance=\{appearance\}/);
  const appearance = readFileSync(new URL("../app/studio/panels/text-appearance-editor.tsx", import.meta.url), "utf8");
  assert.match(appearance, /Add fill/);
  assert.match(appearance, /Add outline/);
  assert.match(toolbar, /fontFamily/);
  assert.match(toolbar, /Text alignment/);
});
