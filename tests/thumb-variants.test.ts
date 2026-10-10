import { test } from "node:test";
import assert from "node:assert/strict";
import { generateThumbVariants, THUMB_WIDTH, THUMB_HEIGHT } from "../app/engine/thumb-variants";

test("canvas size matches the YouTube thumbnail spec", () => {
  assert.equal(THUMB_WIDTH, 1280);
  assert.equal(THUMB_HEIGHT, 720);
});

test("generates the requested number of variants, each with a distinct layout", () => {
  const variants = generateThumbVariants("How to build a deck", 3);
  assert.equal(variants.length, 3);
  const layouts = new Set(variants.map((v) => v.layout));
  assert.equal(layouts.size, 3, "3 variants should not repeat a layout");
});

test("is deterministic for the same title and count", () => {
  const a = generateThumbVariants("Ten minute ramen", 3);
  const b = generateThumbVariants("Ten minute ramen", 3);
  assert.deepEqual(a, b);
});

test("different titles can produce different layout orders", () => {
  const a = generateThumbVariants("Alpha title", 3).map((v) => v.layout);
  const b = generateThumbVariants("A totally different video", 3).map((v) => v.layout);
  assert.notDeepEqual(a, b);
});

test("title alignment always opposes the subject side, and centers for a centered subject", () => {
  for (const variant of generateThumbVariants("Side alignment check", 3)) {
    if (variant.layout === "subject-left") assert.equal(variant.titleAlign, "right");
    if (variant.layout === "subject-right") assert.equal(variant.titleAlign, "left");
    if (variant.layout === "subject-center") assert.equal(variant.titleAlign, "center");
  }
});

test("rejects an out-of-range variant count", () => {
  assert.throws(() => generateThumbVariants("x", 0));
  assert.throws(() => generateThumbVariants("x", 4));
});

test("blank title falls back to a stable seed instead of throwing", () => {
  assert.equal(generateThumbVariants("", 3).length, 3);
  assert.equal(generateThumbVariants("   ", 3).length, 3);
});
