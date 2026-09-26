import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ShellErrorBoundary } from "../app/studio/shell-error-boundary";
import { saveStatusLabel } from "../app/studio/save-status";
import { resolveToolKey } from "../app/studio/tool-shortcuts";

test("desktop shortcuts reach tools outside the current workspace and respect customizations", () => {
  const prefs = { hiddenTools: [], shortcutOverrides: {} };
  assert.equal(resolveToolKey("b", "transform", prefs, true)?.id, "brush");
  assert.equal(resolveToolKey("t", "edit", prefs, true)?.id, "text");
  assert.equal(resolveToolKey("p", "transform", prefs, true)?.id, "radial-warp");
  assert.equal(resolveToolKey("b", "transform", prefs, false), undefined);
  assert.equal(resolveToolKey("b", "transform", { hiddenTools: ["brush", "mask-add"], shortcutOverrides: {} }, true), undefined);
  assert.equal(resolveToolKey("b", "transform", { ...prefs, shortcutOverrides: { brush: "Z" } }, true)?.id, "mask-add");
  assert.equal(resolveToolKey("z", "transform", { ...prefs, shortcutOverrides: { brush: "Z" } }, true)?.id, "brush");
});

test("title status follows document dirtiness rather than stale recovery/UI state", () => {
  assert.equal(saveStatusLabel("saved", true, false), "Unsaved changes");
  assert.equal(saveStatusLabel("unsaved", false, false), "No unsaved changes");
  assert.equal(saveStatusLabel("saving", true, false), "Updating recovery…");
  assert.equal(saveStatusLabel("saved", true, true), "Saving project…");
});

test("optional shell failures offer Save/Close without reloading or replacing the document owner", () => {
  const boundary = new ShellErrorBoundary({ title: "Tools", children: createElement("span", null, "healthy"), onSave: () => {}, onDismiss: () => {} });
  assert.equal(renderToStaticMarkup(boundary.render()), "<span>healthy</span>");
  boundary.state = ShellErrorBoundary.getDerivedStateFromError();
  const fallback = renderToStaticMarkup(boundary.render());
  assert.match(fallback, /role="alert"/); assert.match(fallback, /Save project/); assert.match(fallback, /Close/);
  const code = readFileSync(new URL("../app/studio/shell-error-boundary.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(code, /location\.reload|resetDocument|importProject/);
});

test("shell chunks and modal import routes are protected and shortcuts use the tool activation route", () => {
  const page = readFileSync(new URL("../app/studio/page.tsx", import.meta.url), "utf8");
  for (const title of ["Application controls", "Tools", "Tool options", "Status", "Export", "New document", "Rename layer", "PDF import", "Layer Focus", "Layer style"]) assert.ok(page.includes(`<ShellErrorBoundary title="${title}"`));
  assert.match(page, /activateTool\(t\.id, t\.workspace\)/);
  assert.match(page, /pdfChoice\.resolve\(null\)/);
  assert.match(page, /studio\.prepareVectorDelivery\(format\)/);
  assert.match(page, /vectorTarget\.assertCurrent\(\);\s*const blob = await studio\.exportVectorDocument\(vectorTarget\.report\.format\);\s*vectorTarget\.assertCurrent\(\)/);
  assert.match(page, /<ShellErrorBoundary title="Vector delivery preflight"/);
  const exportUi = readFileSync(new URL("../app/studio/export-popover.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(exportUi, /Editable fidelity check passed/);
  assert.match(exportUi, /event\.stopPropagation\(\)/);
  assert.match(exportUi, /event\.key === "Tab"|event\.key !== "Tab"/);
  assert.match(page, /layerRenameTarget \|\| showExportMenu \|\| printTarget \|\| vectorTarget \|\| recolorSession\) return false/);
  assert.match(page, /setPaused\([^;]*Boolean\(vectorTarget\)/);
});
