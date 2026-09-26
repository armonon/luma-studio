import assert from "node:assert/strict";
import test from "node:test";
import {
  ALL_TOOL_IDS,
  MODE_TOOLS,
  TOOL_REGISTRY,
  WORKSPACE_REGISTRY,
  toolsForWorkspace,
} from "../app/studio/tool-registry";

test("every tool is registered once and belongs to one declared workspace", () => {
  assert.equal(new Set(ALL_TOOL_IDS).size, ALL_TOOL_IDS.length);
  assert.equal(Object.keys(TOOL_REGISTRY).length, ALL_TOOL_IDS.length);
  const fromWorkspaces = WORKSPACE_REGISTRY.flatMap(({ id }) => toolsForWorkspace(id).map((tool) => tool.id));
  assert.deepEqual(new Set(fromWorkspaces), new Set(ALL_TOOL_IDS));
  assert.equal(fromWorkspaces.length, ALL_TOOL_IDS.length);
});

test("tool surfaces derive labels, shortcuts, cursors, options and dispatch metadata from one registry", () => {
  for (const [workspace, tools] of Object.entries(MODE_TOOLS)) {
    for (const [id, icon, label, shortcut] of tools) {
      const definition = TOOL_REGISTRY[id];
      assert.equal(definition.workspace, workspace);
      assert.equal(definition.icon, icon);
      assert.equal(definition.label, label);
      assert.equal(definition.shortcut, shortcut);
      assert.ok(definition.cursor);
      assert.ok(definition.cursorVisual);
      assert.ok(definition.options);
      assert.ok(definition.pointer);
      assert.ok(definition.overlay);
    }
  }
  assert.equal(TOOL_REGISTRY.brush.options, "paint");
  assert.equal(TOOL_REGISTRY["sel-wand"].pointer, "selection");
  assert.equal(TOOL_REGISTRY.text.options, "type");
  assert.equal(TOOL_REGISTRY.move.cursor, "move");
  assert.equal(TOOL_REGISTRY.brush.cursorVisual, "brush");
  assert.equal(TOOL_REGISTRY["sel-quick"].cursorVisual, "brush");
  assert.equal(TOOL_REGISTRY.text.cursorVisual, "type");
  assert.equal(TOOL_REGISTRY.eyedropper.cursorVisual, "sample");
});
