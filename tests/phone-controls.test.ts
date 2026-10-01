import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import StudioTitlebar from "../app/studio/studio-titlebar";
import ToolPalette from "../app/studio/tool-palette";
import { saveStatusLabel } from "../app/studio/save-status";
import { TabletPanel } from "../app/studio/tablet-panel";
import DownloadConfirmation from "../app/studio/download-confirmation";

const props = {
  desktop: false, phone: true, projectName: "Poster", saveState: "unsaved" as const,
  dirty: true, projectSaving: false, zoom: 100, canUndo: true, canRedo: false,
  exportOpen: false, filtersOpen: false, onBack() {}, onCommand() {},
  commandEnabled: () => true, onReview() {},
};
const render = (overrides: Partial<Parameters<typeof StudioTitlebar>[0]> = {}) =>
  renderToStaticMarkup(createElement(StudioTitlebar, { ...props, ...overrides }));

test("phone exposes save directly, with dirty state, without removing shared editing", () => {
  const html = render();
  assert.match(html, /studio-phone-save[^>]*aria-label="Save project"[^>]*data-save-state="dirty"/);
  assert.match(html, /role="status">Unsaved changes/);
  assert.match(html, /Shared editing \(alpha\)/);
  assert.doesNotMatch(html, /aria-label="Start shared editing"/);
});

test("phone shows the existing Luma monogram and keeps Fit canvas available", () => {
  assert.match(render(), /studio-phone-brand[^>]*role="img"[^>]*aria-label="Luma Studio"/);
  assert.match(render(), />Fit canvas<\/span>/);
  assert.doesNotMatch(render({ phone: false }), /studio-phone-brand/);
});

test("phone save reflects command availability, busy and error states", () => {
  assert.match(render({ commandEnabled: () => false }), /studio-phone-save[^>]*disabled=""/);
  assert.match(render({ projectSaving: true }), /studio-phone-save[^>]*aria-busy="true"[^>]*disabled=""/);
  assert.match(render({ saveState: "error" }), /studio-phone-save[^>]*data-save-state="error"/);
  assert.match(render({ dirty: false, saveState: "saved" }), /studio-phone-save[^>]*data-save-state="clean"/);
});

test("desktop titlebar retains its original share entry and no extra save button", () => {
  const html = render({ phone: false, desktop: true });
  assert.doesNotMatch(html, /studio-phone-save|phone-save-status/);
  assert.match(html, /aria-label="Start shared editing"/);
});

test("recovery status never claims a portable file has been saved", () => {
  assert.equal(saveStatusLabel("saving", true, false), "Updating recovery…");
  assert.equal(saveStatusLabel("saved", true, false), "Unsaved changes");
  assert.equal(saveStatusLabel("error", true, false), "Save needs attention");
  assert.equal(saveStatusLabel("saved", true, true), "Saving project…");
});

test("touch tool library is focusable without requiring search input focus", () => {
  const html = renderToStaticMarkup(createElement(ToolPalette, {
    groups: [], activeTool: "brush", autoFocusSearch: false,
    commandEnabled: () => false, onSelect() {}, onCommand() {}, onClose() {},
  }));
  assert.match(html, /tabindex="-1"[^>]*class="tool-palette"[^>]*role="dialog"/);
  assert.match(html, /aria-label="Find a tool or shortcut"/);
  assert.doesNotMatch(html, /autofocus/i);
});

test("phone save status is described accessibly and visible outside the menu", () => {
  const html = render({ onFocusCanvas() {} });
  assert.match(html, /aria-describedby="phone-save-status"/);
  assert.match(html, /class="phone-document-status"/);
  assert.match(html, /Close document…/);
  assert.match(html, /Focus canvas/);
});

test("mobile panels expose size controls and categorized registry entries", () => {
  const html = renderToStaticMarkup(createElement(TabletPanel, { panel: "layers", onSelect() {}, onClose() {} }, null));
  assert.match(html, /data-size="half"/);
  assert.match(html, /aria-label="Panel size"/);
  assert.match(html, /optgroup label="Essentials"/);
  assert.match(html, /optgroup label="Adjustments"/);
  assert.match(html, /optgroup label="Production"/);
  assert.equal((html.match(/<option /g) ?? []).length, 22);
});

test("browser download confirmation defaults to keeping the document unsaved", () => {
  const html = renderToStaticMarkup(createElement(DownloadConfirmation, { name: "Poster.luma", onResolve() {} }));
  assert.match(html, /role="dialog" aria-modal="true"/);
  assert.ok(html.indexOf("Keep document unsaved") < html.indexOf("I verified the saved file"));
  assert.match(html, /browser cannot tell Luma whether the file was saved/);
});
