import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../app/studio/page.tsx", import.meta.url), "utf8");
const focusPanel = readFileSync(new URL("../app/studio/layer-focus-panel.tsx", import.meta.url), "utf8");
const layerEditors = readFileSync(new URL("../app/studio/layer-editors.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

test("desktop icon-only commands expose stable assistive names", () => {
  for (const label of [
    "Add paint layer",
    "Add tone adjustment",
    "Add curves adjustment",
    "Add levels adjustment",
    "Add HSL adjustment",
    "Group active layer",
    "Move active layer up",
    "Move active layer down",
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

test("short desktop windows preserve room for contextual editing", () => {
  const finalLowHeightRule = css.lastIndexOf("@media (max-height: 760px)");
  assert.ok(finalLowHeightRule >= 0);
  const rule = css.slice(finalLowHeightRule);
  assert.match(rule, /\.layers-card\s*\{\s*height: 36%;\s*min-height: 200px;/);
  assert.match(rule, /\.desktop-properties-card\s*\{\s*max-height: 190px;/);
});
