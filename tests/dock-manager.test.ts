import assert from "node:assert/strict";
import test from "node:test";
import {
  closeDockPanel,
  collapseDockGroup,
  defaultDockLayout,
  moveDockPanel,
  moveDockPanelToGroup,
  openDockPanel,
  reorderDockPanel,
  resizeDockGroup,
  resizeDockSplit,
  sanitizeDockLayout,
  selectDockPanel,
  splitDockPanel,
} from "../app/studio/dock-model";
import { STUDIO_PANEL_REGISTRY } from "../app/studio/panel-registry";

test("every shipped studio panel has complete, valid central metadata", () => {
  const panels = STUDIO_PANEL_REGISTRY.list();
  assert.ok(panels.length >= 20);
  assert.equal(new Set(panels.map(({ id }) => id)).size, panels.length);
  for (const panel of panels) {
    assert.ok(panel.title && panel.icon && panel.component);
    assert.ok(panel.minimumWidth > 0);
    assert.ok(panel.preferredWidth >= panel.minimumWidth);
    assert.ok(panel.minimumHeight > 0);
  }
});

test("dock layout supports tabs, ordering, collapse, resize, close, reopen, dock and float", () => {
  let layout = defaultDockLayout("Essentials");
  const groupId = layout.groups.find(group => group.panelIds.includes("properties"))!.id;
  layout = selectDockPanel(layout, groupId, "properties");
  assert.equal(layout.groups.find(group => group.id === groupId)!.activePanelId, "properties");
  layout = reorderDockPanel(layout, groupId, "neural", 0);
  assert.equal(layout.groups.find(group => group.id === groupId)!.panelIds[0], "neural");
  layout = collapseDockGroup(layout, groupId, true);
  assert.equal(layout.groups.find(group => group.id === groupId)!.collapsed, true);
  layout = resizeDockGroup(layout, groupId, 420);
  assert.equal(layout.groups.find(group => group.id === groupId)!.size, 420);
  layout = resizeDockSplit(layout, groupId, 1.8);
  assert.equal(layout.groups.find(group => group.id === groupId)!.weight, 1.8);
  layout = splitDockPanel(layout, "neural", "bottom", STUDIO_PANEL_REGISTRY);
  assert.equal(layout.groups.find((group) => group.panelIds.includes("neural"))?.dock, "bottom");
  layout = moveDockPanelToGroup(layout, "neural", groupId, 0);
  assert.equal(layout.groups.find((group) => group.id === groupId)?.panelIds[0], "neural");
  layout = closeDockPanel(layout, "properties");
  assert.ok(layout.closed.includes("properties"));
  layout = openDockPanel(layout, "properties", STUDIO_PANEL_REGISTRY);
  assert.ok(layout.groups.some((group) => group.panelIds.includes("properties")));
  layout = moveDockPanel(layout, "neural", "floating", STUDIO_PANEL_REGISTRY);
  assert.ok(layout.floating.some((panel) => panel.panelId === "neural"));
});

test("persisted layouts are repaired, bounded, and stripped of unknown panels", () => {
  const layout = sanitizeDockLayout({
    version: 2,
    workspace: "Custom",
    groups: [{ id: "right", dock: "right", panelIds: ["layers", "bogus", "layers"], activePanelId: "bogus", size: 99999, weight: 99, collapsed: false }],
    floating: [{ panelId: "properties", x: -100, y: -50, width: 2, height: 3 }],
    closed: ["neural", "bogus"],
  }, STUDIO_PANEL_REGISTRY);
  assert.deepEqual(layout.groups[0].panelIds, ["layers"]);
  assert.equal(layout.groups[0].activePanelId, "layers");
  assert.equal(layout.groups[0].size, 680);
  assert.equal(layout.groups[0].weight, 4);
  assert.equal(layout.floating[0].x, 0);
  assert.ok(layout.floating[0].width >= STUDIO_PANEL_REGISTRY.require("properties").minimumWidth);
  assert.deepEqual(layout.closed, ["neural"]);
});
