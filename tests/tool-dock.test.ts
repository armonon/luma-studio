import assert from "node:assert/strict";
import test from "node:test";
import { categoryForTool } from "../app/studio/tool-dock";

test("the primary dock maps representative tools into six professional categories", () => {
  assert.equal(categoryForTool("move"), "move");
  assert.equal(categoryForTool("capture-brush"), "paint");
  assert.equal(categoryForTool("sel-lasso"), "select");
  assert.equal(categoryForTool("heal"), "retouch");
  assert.equal(categoryForTool("path-text"), "create");
  assert.equal(categoryForTool("sel-sam"), "ai");
});

test("specialist tools remain in the searchable library without crowding the dock", () => {
  assert.equal(categoryForTool("tone"), null);
  assert.equal(categoryForTool("eyedropper"), null);
});
