import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { DEFAULT_DEPLOY_ORIGIN } from "../app/deploy-origin.ts";

const config = JSON.parse(
  readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"),
) as {
  app: { windows: Array<Record<string, unknown>>; security?: { csp?: string } };
  build: Record<string, unknown>;
};

const mainWindow = config.app.windows[0];
const mainCapability = JSON.parse(
  readFileSync(new URL("../src-tauri/capabilities/main.json", import.meta.url), "utf8"),
) as { windows?: string[]; permissions?: string[] };

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

test("the main webview can receive native shell events", () => {
  // Custom invokes are available without a core capability, which let Save As
  // work while every Rust -> webview event silently failed. Native menus,
  // Finder opens, and dirty-window close protection all depend on this grant.
  assert.ok(mainCapability.windows?.includes("main"));
  assert.ok(
    mainCapability.permissions?.includes("core:event:default"),
    "menu, open-file, and close-request listeners require core:event permissions",
  );
});

test("the CSP allows the origin the desktop app actually calls", () => {
  // A JSON config cannot import the constant, so the link is enforced here.
  // Move the deploy host without updating the CSP and every AI edit in the
  // desktop app fails on a connect-src violation.
  const csp = config.app.security?.csp ?? "";
  const connect = /connect-src ([^;]*)/.exec(csp)?.[1] ?? "";
  assert.ok(
    connect.includes(DEFAULT_DEPLOY_ORIGIN),
    `connect-src must list ${DEFAULT_DEPLOY_ORIGIN}; got "${connect.trim()}"`,
  );
});

test("packaged lettering permits WebAssembly without enabling JavaScript eval", () => {
  for (const path of ["../src-tauri/tauri.conf.json", "../src-tauri/tauri.dev.conf.json"]) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    const script = /script-src ([^;"`\n]*)/.exec(source)?.[1] ?? "";
    assert.ok(script.includes("'wasm-unsafe-eval'"), `${path} must permit the bundled shaper`);
    assert.ok(!script.includes("'unsafe-eval'"), `${path} must not permit JavaScript eval`);
  }
});
