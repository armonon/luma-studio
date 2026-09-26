import assert from "node:assert/strict";
import test from "node:test";
import { rulerTicks, rulerGuidePosition } from "../app/studio/workspace-ruler-model";
import { commandForShortcut } from "../app/desktop/command-shortcuts";
import { createCommandRegistry } from "../app/studio/command-registry";

test("rulers align document origin and negative pasteboard coordinates", () => {
  const ticks = rulerTicks(-200, 1000, 1);
  assert.equal(ticks.find(t => t.value === 0)?.percent, 20);
  assert.equal(ticks[0].value, -200);
  assert.equal(ticks.at(-1)?.percent, 100);
});
test("ruler labels adapt to zoom and stay bounded for extreme documents", () => {
  for (const scale of [.000001, .01, 1, 32]) {
    const ticks = rulerTicks(-123 / scale, 1600 / scale, scale);
    assert.ok(ticks.length > 10 && ticks.length < 130);
    const major = ticks.filter(t => t.major);
    assert.ok((major[1].value - major[0].value) * scale >= 79);
    assert.ok(ticks.every(t => t.percent >= 0 && t.percent <= 100));
  }
  assert.ok(rulerTicks(0, 1e12, 1).length <= 2048);
});
test("invalid viewport geometry is rejected", () => {
  for (const args of [[NaN, 100, 1], [0, 0, 1], [0, 100, 0], [Infinity, 1, 1]]) assert.deepEqual(rulerTicks(...args as [number, number, number]), []);
});
test("guide drop uses the same zoom/pan coordinates and rejects outside drops", () => {
  assert.equal(rulerGuidePosition(250, 1000, -100, 2000, 5000), 400);
  assert.equal(rulerGuidePosition(250, 1000, 500, 500, 5000), 625);
  assert.equal(rulerGuidePosition(10, 1000, 0, 1000, 1000), null);
  assert.equal(rulerGuidePosition(1100, 1000, 0, 1000, 1000), null);
  assert.equal(rulerGuidePosition(50, 1000, -200, 1000, 1000), null);
  assert.equal(rulerGuidePosition(500, 1000, 1000, 1000, 1000), null);
});
test("rulers use a central checked command and Cmd/Ctrl+R", () => {
  let visible = true;
  const registry = createCommandRegistry({ checked: id => id === "toggle-rulers" && visible, execute: () => { visible = !visible; } });
  assert.equal(registry.get("toggle-rulers").checked(), true);
  registry.execute("toggle-rulers");
  assert.equal(registry.get("toggle-rulers").checked(), false);
  assert.equal(commandForShortcut({ key: "r", metaKey: true, ctrlKey: false, shiftKey: false, altKey: false }), "toggle-rulers");
  assert.equal(commandForShortcut({ key: "r", metaKey: false, ctrlKey: true, shiftKey: false, altKey: false }), "toggle-rulers");
});
