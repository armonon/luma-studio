import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeShortcut,
  normalizeWorkflowPreferences,
  resolveShortcut,
  shortcutConflict,
} from "../app/engine/workflow-preferences.ts";

const workspaces = ["edit", "select", "develop"] as const;
const tools = ["brush", "move", "wand"] as const;

test("workflow preferences retain valid customization and repair stale values", () => {
  const preferences = normalizeWorkflowPreferences({
    workspaceOrder: ["develop", "missing", "edit", "develop"],
    hiddenTools: ["wand", "deleted", "wand"],
    shortcutOverrides: { brush: " q ", move: "too long", deleted: "x" },
    contextualInspector: false,
  }, workspaces, tools);
  assert.deepEqual(preferences.workspaceOrder, ["develop", "edit", "select"]);
  assert.deepEqual(preferences.hiddenTools, ["wand"]);
  assert.deepEqual(preferences.shortcutOverrides, { brush: "Q" });
  assert.equal(preferences.contextualInspector, false);
});

test("shortcut resolution normalizes keys and detects workspace collisions", () => {
  const preferences = normalizeWorkflowPreferences({ shortcutOverrides: { brush: "q" } }, workspaces, tools);
  assert.equal(normalizeShortcut(" 7 "), "7");
  assert.equal(normalizeShortcut("F1"), null);
  assert.equal(resolveShortcut("brush", "B", preferences), "Q");
  assert.equal(shortcutConflict([["brush", "B"], ["move", "V"]], "move", "q", preferences), "brush");
  assert.equal(shortcutConflict([["brush", "B"], ["move", "V"]], "move", "x", preferences), null);
});
