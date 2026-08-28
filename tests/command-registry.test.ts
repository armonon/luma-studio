import assert from "node:assert/strict";
import test from "node:test";
import { menuCommands } from "../app/desktop/menu-model";
import { COMMAND_DEFINITIONS, createCommandRegistry } from "../app/studio/command-registry";

test("the command registry covers every command exposed by the native menu exactly once", () => {
  const menu = menuCommands();
  assert.equal(new Set(menu).size, menu.length);
  assert.deepEqual(new Set(Object.keys(COMMAND_DEFINITIONS)), new Set(menu));
  for (const id of menu) assert.ok(COMMAND_DEFINITIONS[id].label);
});

test("all command surfaces share enabled, checked, and guarded execution", () => {
  const executed: string[] = [];
  const registry = createCommandRegistry({
    execute: (id) => executed.push(id),
    enabled: (id) => id !== "save",
    checked: (id) => id === "toggle-guides",
  });
  assert.equal(registry.execute("save"), false);
  assert.deepEqual(executed, []);
  assert.equal(registry.execute("open"), true);
  assert.deepEqual(executed, ["open"]);
  assert.equal(registry.get("toggle-guides").checked(), true);
});
