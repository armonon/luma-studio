import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../app/studio/page.tsx", import.meta.url), "utf8");
const focusPanel = readFileSync(new URL("../app/studio/layer-focus-panel.tsx", import.meta.url), "utf8");
const layerEditors = readFileSync(new URL("../app/studio/layer-editors.tsx", import.meta.url), "utf8");
const layerStack = readFileSync(new URL("../app/studio/virtual-layer-stack.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

test("desktop icon-only commands expose stable assistive names", () => {
  for (const label of [
    "Add paint layer",
    "Add adjustment layer",
    "Group active layer",
    "Move active layer up",
    "Move active layer down",
    "Open layer styles",
    "Delete active layer",
    "Focus this layer",
    "Record action",
    "Undo",
    "Redo",
    "Select all",
  ]) {
    assert.match(page, new RegExp(`aria-label=[{\"]+[^\n>]*${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  }
  assert.match(focusPanel, /aria-label=\{item\.pinned \? "Unpin from Focus" : "Pin in Focus"\}/);
  assert.match(layerEditors, /aria-label="Reset levels"/);
  assert.match(layerEditors, /aria-label="Reset hue and saturation"/);
});

test("layer rows expose keyboard selection and real visibility/delete buttons", () => {
  assert.match(layerStack, /role="listbox"/);
  assert.match(layerStack, /role="option"/);
  assert.match(layerStack, /onKeyDown=/);
  assert.match(layerStack, /className="spatial-layer-visibility"/);
  assert.match(layerStack, /aria-label=\{`\$\{layer\.visible \? "Hide" : "Show"\}/);
  assert.match(layerStack, /className="spatial-layer-delete"/);
  assert.doesNotMatch(layerStack, /<i[^>]+spatial-layer-delete/);
});

test("short desktop windows preserve room for contextual editing", () => {
  const finalLowHeightRule = css.lastIndexOf("@media (max-height: 760px)");
  assert.ok(finalLowHeightRule >= 0);
  const rule = css.slice(finalLowHeightRule);
  assert.match(rule, /\.layers-card\s*\{\s*height: 48%;\s*min-height: 270px;/);
  assert.match(rule, /\.desktop-properties-card\s*\{\s*max-height: 148px;/);
});

test("native editing controls keep a legible RC type floor and keyboard focus", () => {
  const floor = css.lastIndexOf("RC readability floor");
  assert.ok(floor >= 0, "the desktop readability floor must remain the final cascade layer");
  assert.ok(floor > css.lastIndexOf("@media (max-height: 760px)"));
  const rule = css.slice(floor);
  assert.match(rule, /\.spatial-inspector button,[\s\S]*font-size: 10\.5px;/);
  assert.match(rule, /\.spatial-inspector small,[\s\S]*font-size: 9\.5px;/);
  assert.match(rule, /\.spatial-layer \.layer-name strong[\s\S]*font-size: 11px;/);
  assert.match(rule, /:focus-visible\s*\{[\s\S]*outline: 2px solid #4ba7ff;/);
});
