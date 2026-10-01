import assert from "node:assert/strict";
import { test } from "node:test";
import { phoneInterface, phoneViewport, phoneKeyboardOpen, PHONE_DRAW_KEY, PHONE_VIEWPORT_LIMITS } from "../app/studio/phone-workspace";
import { TABLET_DRAW_KEY } from "../app/studio/tablet-input";
import { calculateDisplayViewport } from "../app/engine/viewport";

test("iPhone is detected in either orientation, including attached pointer", () => {
  assert.equal(phoneInterface(5, true, "iPhone", 390, 844, null), true);
  assert.equal(phoneInterface(5, false, "iPhone", 844, 390, null), true);
  assert.equal(phoneInterface(5, true, "Linux", 412, 915, null), true);
});
test("desktop/iPad are not reclassified when their window or keyboard is small", () => {
  assert.equal(phoneInterface(0, false, "MacIntel", 390, 844, null), false);
  assert.equal(phoneInterface(5, true, "MacIntel", 834, 1194, null), false);
  assert.equal(phoneInterface(5, true, "Linux", 0, 0, null), false);
});
test("explicit interface choices are honored", () => {
  assert.equal(phoneInterface(0, false, "MacIntel", 1920, 1080, "phone"), true);
  assert.equal(phoneInterface(5, true, "iPhone", 390, 844, "desktop"), false);
  assert.equal(phoneInterface(5, true, "iPhone", 390, 844, "tablet"), false);
  assert.notEqual(PHONE_DRAW_KEY, TABLET_DRAW_KEY);
});
test("keyboard viewport sizing is finite and leaves accessibility page zoom intact", () => {
  assert.deepEqual(phoneViewport(361.8, 20.3, 1), { height: 362, top: 20 });
  assert.deepEqual(phoneViewport(400, -5, 1), { height: 400, top: 0 });
  assert.equal(phoneViewport(400, 0, 2), null);
  assert.equal(phoneViewport(NaN, 0, 1), null);
  assert.equal(phoneViewport(0, 0, 1), null);
});
test("phone display budget does not grow with document dimensions", () => {
  for (const size of [2048, 10_000, 25_000, 50_000]) {
    const plan = calculateDisplayViewport(size, size, 430, 932, { zoom: 1, panX: 0, panY: 0 }, 3, PHONE_VIEWPORT_LIMITS);
    assert.ok(plan.outputWidth * plan.outputHeight <= 2_000_000);
    assert.ok(plan.outputWidth <= 2048 && plan.outputHeight <= 2048);
  }
});

test("keyboard layout requires a focused text field and excludes pinch zoom", () => {
  assert.equal(phoneKeyboardOpen(844, 420, 1, true), true);
  assert.equal(phoneKeyboardOpen(390, 210, 1, true), true);
  assert.equal(phoneKeyboardOpen(844, 420, 2, true), false);
  assert.equal(phoneKeyboardOpen(844, 420, 1, false), false);
  assert.equal(phoneKeyboardOpen(844, 800, 1, true), false);
  assert.equal(phoneKeyboardOpen(844, NaN, 1, true), false);
  assert.equal(phoneKeyboardOpen(844, 360, 1, false, true), true);
  assert.equal(phoneKeyboardOpen(844, 844, 1, false, true), false);
});
