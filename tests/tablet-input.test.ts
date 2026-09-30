import { test } from "node:test";
import assert from "node:assert/strict";
import { navigateTouches, tabletInterface, TabletPointerSession, TABLET_VIEWPORT_LIMITS } from "../app/studio/tablet-input";
import { calculateDisplayViewport } from "../app/engine/viewport";

test("tablet capability detection handles iPad desktop UA, trackpad, and explicit previews", () => {
  assert.equal(tabletInterface(5, false, "MacIntel", null), true);
  assert.equal(tabletInterface(5, true, "Linux", null), true);
  assert.equal(tabletInterface(0, false, "MacIntel", null), false);
  assert.equal(tabletInterface(5, true, "MacIntel", "desktop"), false);
  assert.equal(tabletInterface(0, false, "MacIntel", "tablet"), true);
});
test("one finger pans without scaling and adding/removing fingers does not jump", () => {
  const view = { zoom: 2, panX: 20, panY: 30 };
  assert.deepEqual(navigateTouches(view, [{ x: 2, y: 3 }], [{ x: 12, y: -7 }], 0.5), { zoom: 2, panX: 30, panY: 20 });
  assert.equal(navigateTouches(view, [{ x: 0, y: 0 }], [{ x: 0, y: 0 }, { x: 10, y: 0 }], 1), view);
});
test("pinch keeps its document anchor fixed while centroid translation pans", () => {
  const result = navigateTouches({ zoom: 1, panX: 0, panY: 0 }, [{ x: 40, y: 20 }, { x: 60, y: 20 }], [{ x: 40, y: 25 }, { x: 80, y: 25 }], 0.5);
  assert.deepEqual(result, { zoom: 2, panX: -40, panY: -15 });
  assert.equal((60 - result.panX) / result.zoom, 50);
  assert.equal((25 - result.panY) / result.zoom, 20);
});
test("degenerate and nonfinite pinch input cannot poison the view", () => {
  const view = { zoom: 1, panX: 0, panY: 0 };
  assert.equal(navigateTouches(view, [{ x: NaN, y: 0 }], [{ x: 2, y: 0 }], 1), view);
  const next = navigateTouches(view, [{ x: 0, y: 0 }, { x: 0, y: 0 }], [{ x: 10, y: 10 }, { x: 10, y: 10 }], 1);
  assert.deepEqual(next, { zoom: 1, panX: 10, panY: 10 });
});
test("Pencil takes ownership; palms never edit or resume navigating on pen release", () => {
  const s = new TabletPointerSession(), p = { x: 0, y: 0 };
  assert.equal(s.down(1, "touch", false, p), "navigate");
  assert.equal(s.down(2, "pen", false, p), "edit");
  assert.equal(s.touches.size, 0);
  assert.equal(s.blocked.has(1), true);
  assert.equal(s.down(3, "touch", false, p), "ignore");
  s.up(3); assert.equal(s.editor, 2);
  s.up(2); assert.equal(s.editor, null); assert.equal(s.blocked.has(1), true);
  s.up(1); assert.equal(s.blocked.size, 0);
});
test("finger drawing owns one pointer and ignores secondary touches", () => {
  const s = new TabletPointerSession(), p = { x: 0, y: 0 };
  assert.equal(s.down(1, "touch", true, p), "edit");
  assert.equal(s.down(2, "touch", true, p), "ignore");
  s.up(2); assert.equal(s.editor, 1);
  s.up(1); assert.equal(s.editor, null);
  assert.equal(s.down(3, "touch", false, p), "navigate");
});

test("tablet backing buffers stay within budget even for extreme projects and high DPR", () => {
  for (const width of [10_000, 25_000, 50_000, 1_000_000]) {
    const plan = calculateDisplayViewport(width, width, 1366, 1024, { zoom: 1, panX: 0, panY: 0 }, 3, TABLET_VIEWPORT_LIMITS);
    assert.ok(plan.outputWidth * plan.outputHeight <= 4_000_000);
    assert.ok(plan.outputWidth <= 3072 && plan.outputHeight <= 3072);
  }
});
