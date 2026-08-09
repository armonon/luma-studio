import assert from "node:assert/strict";
import test from "node:test";
import { curatePrimaryTools } from "../app/studio/tool-dock";

const tools = Array.from({ length: 12 }, (_, index) => ({ id: `tool-${index + 1}` }));

test("the primary desktop tool dock never exceeds six tools", () => {
  assert.deepEqual(curatePrimaryTools(tools, "tool-2").map((tool) => tool.id), [
    "tool-1", "tool-2", "tool-3", "tool-4", "tool-5", "tool-6",
  ]);
});

test("an active overflow tool remains visible without expanding the dock", () => {
  assert.deepEqual(curatePrimaryTools(tools, "tool-11").map((tool) => tool.id), [
    "tool-1", "tool-2", "tool-3", "tool-4", "tool-5", "tool-11",
  ]);
});

test("small workspaces do not grow placeholder entries", () => {
  assert.equal(curatePrimaryTools(tools.slice(0, 2), "tool-2").length, 2);
});
