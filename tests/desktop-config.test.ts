import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const config = JSON.parse(
  readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"),
) as {
  app: { windows: Array<Record<string, unknown>> };
  build: Record<string, unknown>;
};

const mainWindow = config.app.windows[0];

test("native drag-drop interception stays disabled", () => {
  // Tauri v2 defaults dragDropEnabled to true. When true the native window
  // consumes OS file drops and the webview never receives dragover/drop, so
  // the studio's HTML import handler — shared with the web edition — silently
  // does nothing in the desktop app. This was a real shipped bug.
  assert.equal(
    mainWindow.dragDropEnabled,
    false,
    "dragDropEnabled must be false or desktop drag-and-drop import breaks",
  );
});

test("the desktop window can still show the full inspector", () => {
  // The inspector column clips below ~1400px of *document* width; the window
  // minimum has to leave room for it plus the rails.
  assert.ok(
    typeof mainWindow.minWidth === "number" && mainWindow.minWidth >= 1100,
    `minWidth ${String(mainWindow.minWidth)} is too small for the inspector`,
  );
});

test("the desktop build points at a static frontend", () => {
  // Without frontendDist a packaged build has nothing to serve.
  assert.equal(config.build.frontendDist, "../dist-desktop");
});
