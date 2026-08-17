import assert from "node:assert/strict";
import test from "node:test";

import {
  DESKTOP_DEMO_LAYERS,
  DESKTOP_TOOL_RAIL,
  desktopRadialOverlayPosition,
  initialStudioPresentation,
  shouldMountLegacyInspector,
  shouldRevealDesktopPassDeck,
  studioUiWorkPolicy,
} from "../app/studio/desktop-presentation.ts";

test("desktop opens as a focused native editing surface", () => {
  assert.deepEqual(initialStudioPresentation(true), {
    workspace: "transform",
    tool: "radial-warp",
    assetsOpen: false,
    zoom: 1.55,
    showRadialOverlay: true,
  });
});

test("web keeps the familiar general-purpose starting state", () => {
  assert.deepEqual(initialStudioPresentation(false), {
    workspace: "edit",
    tool: "brush",
    assetsOpen: true,
    zoom: 1,
    showRadialOverlay: false,
  });
});

test("desktop demo layers and the compact tool rail stay purpose-built", () => {
  assert.deepEqual(
    DESKTOP_DEMO_LAYERS.map((layer) => layer.name),
    ["Background", "Foreground Detail", "Local Contrast", "Color Grade", "Sky Enhance"],
  );
  assert.ok(DESKTOP_TOOL_RAIL.length >= 12 && DESKTOP_TOOL_RAIL.length <= 16);
  assert.equal(new Set(DESKTOP_TOOL_RAIL).size, DESKTOP_TOOL_RAIL.length);
});

test("Space reveals the contextual desktop deck with or without a selected layer", () => {
  assert.equal(shouldRevealDesktopPassDeck({ desktop: true, code: "Space", repeat: false, hasSelectedLayer: true, editingText: false }), true);
  assert.equal(shouldRevealDesktopPassDeck({ desktop: true, code: "Space", repeat: false, hasSelectedLayer: false, editingText: false }), true);
  assert.equal(shouldRevealDesktopPassDeck({ desktop: false, code: "Space", repeat: false, hasSelectedLayer: true, editingText: false }), false);
  assert.equal(shouldRevealDesktopPassDeck({ desktop: true, code: "Space", repeat: true, hasSelectedLayer: true, editingText: false }), false);
  assert.equal(shouldRevealDesktopPassDeck({ desktop: true, code: "Space", repeat: false, hasSelectedLayer: true, editingText: true }), false);
  assert.equal(shouldRevealDesktopPassDeck({ desktop: true, code: "Enter", repeat: false, hasSelectedLayer: true, editingText: false }), false);
});

test("desktop does not mount the CSS-hidden legacy inspector tree", () => {
  assert.equal(shouldMountLegacyInspector(true), false);
  assert.equal(shouldMountLegacyInspector(false), true);
  assert.equal(shouldMountLegacyInspector(false, true), false);
});

test("desktop computes heavy diagnostics only when their native surfaces open", () => {
  assert.deepEqual(studioUiWorkPolicy({
    desktop: true,
    inspector: "layers",
    exportOpen: false,
    historyOpen: false,
  }), {
    engineDiagnostics: false,
    photoshopPreflight: false,
    historyTree: false,
  });
  assert.deepEqual(studioUiWorkPolicy({
    desktop: true,
    inspector: "layers",
    exportOpen: true,
    historyOpen: true,
  }), {
    engineDiagnostics: false,
    photoshopPreflight: true,
    historyTree: true,
  });
  assert.deepEqual(studioUiWorkPolicy({
    desktop: false,
    inspector: "properties",
    exportOpen: false,
    historyOpen: false,
  }), {
    engineDiagnostics: true,
    photoshopPreflight: true,
    historyTree: true,
  });
  assert.deepEqual(studioUiWorkPolicy({
    desktop: false,
    nativeBuild: true,
    inspector: "properties",
    exportOpen: false,
    historyOpen: false,
  }), {
    engineDiagnostics: false,
    photoshopPreflight: false,
    historyTree: false,
  });
});

test("radial overlay placement is deterministic without React pointer state", () => {
  assert.deepEqual(desktopRadialOverlayPosition({
    point: { x: 500, y: 300 },
    documentWidth: 1000,
    documentHeight: 600,
    radius: 100,
  }), { left: "40%", top: "33.33333333333333%" });
  assert.deepEqual(desktopRadialOverlayPosition({
    point: null,
    documentWidth: 1000,
    documentHeight: 1000,
    radius: 100,
  }), { left: "24%", top: "33%" });
});
