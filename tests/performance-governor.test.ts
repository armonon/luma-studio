import assert from "node:assert/strict";
import test from "node:test";
import { appendDirtyRegion } from "../app/engine/dirty-regions.ts";
import { AdaptiveRenderGovernor } from "../app/engine/performance-governor.ts";
import type { DisplayViewport } from "../app/engine/viewport.ts";

const viewport: DisplayViewport = {
  x: 10,
  y: 20,
  width: 1000,
  height: 500,
  zoom: 2,
  outputWidth: 2000,
  outputHeight: 1000,
  cssScale: 1,
  devicePixelRatio: 2,
};

test("adaptive preview downshifts slow interaction without changing document geometry", () => {
  const governor = new AdaptiveRenderGovernor({ slowFramesToDownshift: 2, fastFramesToUpshift: 2 });
  assert.equal(governor.record(30, "interactive"), false);
  assert.equal(governor.record(30, "interactive"), true);
  const adjusted = governor.apply(viewport);
  assert.deepEqual(
    { x: adjusted.x, y: adjusted.y, width: adjusted.width, height: adjusted.height, cssScale: adjusted.cssScale },
    { x: 10, y: 20, width: 1000, height: 500, cssScale: 1 },
  );
  assert.equal(adjusted.outputWidth, 1700);
  assert.equal(adjusted.outputHeight, 850);
  assert.equal(adjusted.devicePixelRatio, 1.7);
  assert.equal(governor.stats().downshifts, 1);
});

test("adaptive preview recovers after fast frames and always supports an idle full-quality restore", () => {
  const governor = new AdaptiveRenderGovernor({ slowFramesToDownshift: 1, fastFramesToUpshift: 2 });
  governor.record(40, "interactive");
  governor.record(40, "interactive");
  assert.equal(governor.stats().scale, 0.7);
  assert.equal(governor.record(1, "interactive"), false);
  assert.equal(governor.record(1, "interactive"), true);
  assert.equal(governor.stats().scale, 0.85);
  assert.equal(governor.restoreFullQuality(), true);
  assert.equal(governor.stats().scale, 1);
  assert.equal(governor.restoreFullQuality(), false);
});

test("dirty-region queues merge tablet samples and collapse before becoming unbounded", () => {
  let regions = appendDirtyRegion([], { x: 0, y: 0, width: 10, height: 10 });
  regions = appendDirtyRegion(regions, { x: 11, y: 0, width: 10, height: 10 });
  assert.deepEqual(regions, [{ x: 0, y: 0, width: 21, height: 10 }]);
  regions = appendDirtyRegion(regions, { x: 100, y: 100, width: 5, height: 5 });
  regions = appendDirtyRegion(regions, { x: 200, y: 200, width: 5, height: 5 }, { maximumRegions: 2 });
  assert.deepEqual(regions, [{ x: 0, y: 0, width: 205, height: 205 }]);
  assert.equal(appendDirtyRegion(regions, { x: 0, y: 0, width: 0, height: 1 }).length, 1);
});

