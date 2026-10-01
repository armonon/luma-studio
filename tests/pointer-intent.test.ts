import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ToolDock from "../app/studio/tool-dock";
import { allowToolHold, canvasPointerIntent } from "../app/studio/pointer-intent";

test("finger drawing does not inherit desktop Space or a missing keyup", () => {
  assert.equal(canvasPointerIntent(0, "touch", false), "edit");
  assert.equal(canvasPointerIntent(0, "touch", true), "edit");
  assert.equal(canvasPointerIntent(2, "touch", true), "ignore");
});
test("mouse navigation stays available and secondary clicks cannot paint", () => {
  assert.equal(canvasPointerIntent(0, "mouse", false), "edit");
  assert.equal(canvasPointerIntent(0, "mouse", true), "pan");
  assert.equal(canvasPointerIntent(1, "mouse", false), "pan");
  assert.equal(canvasPointerIntent(2, "mouse", false), "ignore");
  assert.equal(canvasPointerIntent(2, "mouse", true), "ignore");
  assert.equal(canvasPointerIntent(0, "pen", false), "edit");
  assert.equal(canvasPointerIntent(2, "pen", false), "ignore");
});
test("touch and secondary buttons never start a desktop hold menu", () => {
  assert.equal(allowToolHold(0, "touch", false), false);
  assert.equal(allowToolHold(0, "touch", true), false);
  assert.equal(allowToolHold(0, "mouse", true), false);
  assert.equal(allowToolHold(2, "mouse", false), false);
  assert.equal(allowToolHold(0, "mouse", false), true);
});
test("touch dock offers direct selection and an explicit More entry", () => {
  const html = renderToStaticMarkup(createElement(ToolDock, {
    groups: [], activeWorkspace: "edit", activeTool: "brush", touchWorkspace: true,
    onSelect() {}, onAiSelect() {}, onCommand() {}, commandEnabled: () => true,
  }));
  assert.match(html, /Tap to select · More for all tools/);
  assert.match(html, /aria-label="More tools and command search"/);
  assert.doesNotMatch(html, /aria-haspopup="menu"/);
});
