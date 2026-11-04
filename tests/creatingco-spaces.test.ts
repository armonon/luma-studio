import assert from "node:assert/strict";
import test from "node:test";
import { CREATIVE_SPACES, CREATIVE_ACTIONS, creativeSpaceForWorkspace } from "../app/studio/creatingco-spaces";
import { TOOL_REGISTRY, WORKSPACE_REGISTRY } from "../app/studio/tool-registry";
import { STUDIO_PANEL_REGISTRY } from "../app/studio/panel-registry";

test("creative spaces and shortcuts target registered Luma tools, workspaces and panels", () => {
  const workspaces = new Set(WORKSPACE_REGISTRY.map(item => item.id));
  for (const destination of [...Object.values(CREATIVE_SPACES).map(space => space.entry), ...Object.values(CREATIVE_ACTIONS)]) {
    if (destination.tool) {
      assert.ok(destination.workspace);
      assert.equal(TOOL_REGISTRY[destination.tool].workspace, destination.workspace);
    }
    if (destination.workspace) assert.ok(workspaces.has(destination.workspace));
    if (destination.panel) assert.ok(STUDIO_PANEL_REGISTRY.require(destination.panel));
  }
  for (const space of Object.values(CREATIVE_SPACES)) {
    for (const action of space.actions) assert.ok(CREATIVE_ACTIONS[action]);
  }
});

test("initial creative space follows Luma's starting workspace", () => {
  assert.equal(creativeSpaceForWorkspace("develop"), "photo");
  assert.equal(creativeSpaceForWorkspace("vector"), "design");
  assert.equal(creativeSpaceForWorkspace("edit"), "create");
});
