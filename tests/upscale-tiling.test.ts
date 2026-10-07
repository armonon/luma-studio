import { test } from "node:test";
import assert from "node:assert/strict";
import { planUpscaleTiles, validateTileOutput } from "../app/engine/upscale-tiling";

test("tiles exactly cover the scaled output with no gaps or overlaps", () => {
  const width = 500, height = 333, scale = 2, tileSize = 128, overlap = 12;
  const plans = planUpscaleTiles(width, height, scale, tileSize, overlap);
  const covered = new Uint8Array(width * scale * height * scale);
  for (const plan of plans) {
    for (let y = plan.dest.y; y < plan.dest.y + plan.dest.height; y++) {
      for (let x = plan.dest.x; x < plan.dest.x + plan.dest.width; x++) {
        const index = y * (width * scale) + x;
        assert.equal(covered[index], 0, `pixel (${x},${y}) painted twice`);
        covered[index] = 1;
      }
    }
  }
  assert.ok(covered.every((v) => v === 1), "every output pixel must be covered exactly once");
});

test("source rects stay within the image and include the requested overlap away from edges", () => {
  const width = 300, height = 300, scale = 4, tileSize = 128, overlap = 16;
  const plans = planUpscaleTiles(width, height, scale, tileSize, overlap);
  for (const plan of plans) {
    assert.ok(plan.source.x >= 0 && plan.source.y >= 0);
    assert.ok(plan.source.x + plan.source.width <= width);
    assert.ok(plan.source.y + plan.source.height <= height);
    // An interior tile (not touching the left/top edge) must see `overlap` pixels of context before its dest.
    if (plan.dest.x / scale - overlap >= 0) {
      assert.ok(plan.source.x <= plan.dest.x / scale - overlap);
    }
  }
});

test("single tile covering the whole image has zero trim", () => {
  const plans = planUpscaleTiles(64, 48, 2, 256, 16);
  assert.equal(plans.length, 1);
  assert.deepEqual(plans[0].trim, { x: 0, y: 0 });
  assert.deepEqual(plans[0].source, { x: 0, y: 0, width: 64, height: 48 });
  assert.deepEqual(plans[0].dest, { x: 0, y: 0, width: 128, height: 96 });
});

test("tile indices are stable row-major order", () => {
  const plans = planUpscaleTiles(300, 150, 1, 128, 8);
  for (let i = 0; i < plans.length; i++) assert.equal(plans[i].index, i);
});

test("validateTileOutput accepts a tile output large enough for trim + dest, rejects a short one", () => {
  const [plan] = planUpscaleTiles(64, 64, 2, 256, 16);
  assert.ok(validateTileOutput(plan, 128, 128));
  assert.ok(!validateTileOutput(plan, 10, 10));
});

test("rejects invalid inputs", () => {
  assert.throws(() => planUpscaleTiles(0, 10, 2));
  assert.throws(() => planUpscaleTiles(10, 10, 0));
  assert.throws(() => planUpscaleTiles(10, 10, 2, 10)); // tileSize < 32
  assert.throws(() => planUpscaleTiles(10, 10, 2, 64, 40)); // overlap*2 >= tileSize
});
