import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { commandForShortcut } from "../app/desktop/command-shortcuts";
import { categoryForTool } from "../app/studio/tool-dock";

test("Campaign shortcut is not intercepted by the command library",()=>{
  assert.equal(commandForShortcut({key:"k",metaKey:true,ctrlKey:false,altKey:true,shiftKey:false}),"panel-campaign");
  const source=readFileSync(new URL("../app/studio/tool-dock.tsx",import.meta.url),"utf8");
  assert.match(source,/!event\.defaultPrevented && !event\.altKey && !event\.shiftKey/);
});

test("the primary dock maps representative tools into six professional categories", () => {
  assert.equal(categoryForTool("move"), "move");
  assert.equal(categoryForTool("capture-brush"), "paint");
  assert.equal(categoryForTool("sel-lasso"), "select");
  assert.equal(categoryForTool("heal"), "retouch");
  assert.equal(categoryForTool("path-text"), "create");
  assert.equal(categoryForTool("sel-sam"), "ai");
  assert.equal(categoryForTool("radial-warp"), "move");
  assert.equal(categoryForTool("puppet-warp"), null, "the single-point radial push must not be sold as Puppet Warp");
});

test("specialist tools remain in the searchable library without crowding the dock", () => {
  assert.equal(categoryForTool("tone"), null);
  assert.equal(categoryForTool("eyedropper"), null);
});
