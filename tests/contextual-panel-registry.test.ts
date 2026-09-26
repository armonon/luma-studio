import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { Layer, LayerKind } from "../app/engine/document.ts";
import { panelForLayer, resolveContextualPanel, workspaceForLayer } from "../app/studio/contextual-panel-registry.ts";

test("every professional adjustment routes to its own editor", () => {
  const layer = (kind: LayerKind) => ({ kind } as Layer);
  assert.equal(panelForLayer(layer("adjustment-tone")), "tone");
  assert.equal(panelForLayer(layer("adjustment-curves")), "curves");
  assert.equal(panelForLayer(layer("adjustment-levels")), "levels");
  assert.equal(panelForLayer(layer("adjustment-hsl")), "hsl");
  assert.equal(panelForLayer(layer("adjustment-pro")), "pro-adjustment");
  assert.equal(workspaceForLayer(layer("text")), "vector");
});

test("manual panels and mask focus outrank generic workspace routing", () => {
  const base = { inspector: "properties" as const, layer: null, workspace: "edit", hasSelection: false, maskFocused: false };
  assert.equal(resolveContextualPanel({ ...base, override: "channels" }), "channels");
  assert.equal(resolveContextualPanel({ ...base, override: null, maskFocused: true }), "mask");
  assert.equal(resolveContextualPanel({ ...base, override: null, inspector: "ai" }), "neural");
});

test("a docked Selection panel stays available independently of workspace and contextual routing", () => {
  const page = readFileSync(new URL("../app/studio/page.tsx", import.meta.url), "utf8");
  const panel = page.split('<DockPanelContent panelId="selection">')[1]?.split("</DockPanelContent>")[0];
  assert.ok(panel, "Selection is registered as dock content");
  assert.match(panel, /\{doc && \(/);
  assert.doesNotMatch(panel, /contextualPanel ===|workspace ===/);
  assert.doesNotMatch(
    page,
    /\{workspace === "select" && \(\s*<section[^>]*data-contextual-panel="selection"/,
  );
});
