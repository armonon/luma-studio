import assert from "node:assert/strict";
import test from "node:test";

import { virtualRange } from "../app/studio/large-project-ui.ts";

test("100,000 layers render only a bounded viewport window", () => {
  const range = virtualRange({
    itemCount: 100_000,
    itemHeight: 46,
    viewportHeight: 460,
    scrollTop: 2_300_000,
    overscan: 8,
  });
  assert.equal(range.totalHeight, 4_600_000);
  assert.ok(range.end - range.start <= 26);
  assert.ok(range.start > 49_000);
});

test("virtual ranges clamp negative and past-end scrolling", () => {
  assert.deepEqual(virtualRange({ itemCount: 3, itemHeight: 40, viewportHeight: 80, scrollTop: -10, overscan: 0 }), {
    start: 0,
    end: 2,
    offset: 0,
    totalHeight: 120,
  });
  assert.deepEqual(virtualRange({ itemCount: 3, itemHeight: 40, viewportHeight: 80, scrollTop: 999, overscan: 0 }), {
    start: 1,
    end: 3,
    offset: 40,
    totalHeight: 120,
  });
});

test("empty layer stacks produce an empty range", () => {
  assert.deepEqual(virtualRange({ itemCount: 0, itemHeight: 46, viewportHeight: 500, scrollTop: 0 }), {
    start: 0,
    end: 0,
    offset: 0,
    totalHeight: 0,
  });
});
