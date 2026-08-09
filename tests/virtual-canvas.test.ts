import assert from "node:assert/strict";
import test from "node:test";
import { CancellableTileScheduler, TileRequestCancelledError } from "../app/engine/tile-scheduler.ts";
import { computeResidencyBudget, TileResidencyCache } from "../app/engine/tile-residency.ts";
import {
  PyramidDirtyTracker,
  ViewportTilePlanner,
  VirtualCanvasPyramid,
} from "../app/engine/virtual-canvas.ts";

test("virtual pyramid describes terapixel canvases without allocating tile state", () => {
  const pyramid = new VirtualCanvasPyramid(1_000_000, 750_000, 256);
  assert.equal(pyramid.level(0).totalTiles, 11_447_510);
  assert.equal(pyramid.maxLevel, 12);
  assert.deepEqual(pyramid.level(12), {
    level: 12,
    scale: 4096,
    width: 245,
    height: 184,
    columns: 1,
    rows: 1,
    totalTiles: 1,
  });
  const edge = pyramid.address(0, pyramid.level(0).columns - 1, pyramid.level(0).rows - 1);
  assert.equal(edge.documentRect.x + edge.documentRect.width, 1_000_000);
  assert.equal(edge.documentRect.y + edge.documentRect.height, 750_000);
  assert.equal(pyramid.level(0), pyramid.level(0), "immutable level geometry is cached");
  assert.equal(Object.isFrozen(pyramid.level(0)), true);
});

test("viewport planner selects mip levels and creates deterministic bounded priorities", () => {
  const pyramid = new VirtualCanvasPyramid(100_000, 80_000, 256);
  const planner = new ViewportTilePlanner(pyramid);
  const plan = planner.plan(
    { x: 10_000, y: 20_000, width: 2_048, height: 1_024, zoom: 0.125 },
    { prefetchMarginTiles: 1, fallbackLevels: 2 },
  );
  assert.equal(plan.level, 3);
  assert.ok(plan.visibleTileCount > 0);
  assert.ok(plan.prefetchTileCount > 0);
  assert.ok(plan.fallbackTileCount > 0);
  assert.deepEqual(
    [...plan.requests].sort((a, b) => b.priority - a.priority).map((item) => item.key),
    plan.requests.map((item) => item.key),
  );
  assert.ok(plan.requests.slice(0, plan.visibleTileCount).every((item) => item.reason === "visible"));

  const capped = planner.plan(
    { x: 0, y: 0, width: 20_000, height: 20_000, zoom: 1 },
    { maxRequests: 10, prefetchMarginTiles: 4 },
  );
  assert.equal(capped.requests.length, 10);
  assert.equal(capped.truncated, true);
});

test("viewport planning stays bounded for a terapixel-wide visible region", () => {
  const pyramid = new VirtualCanvasPyramid(1_000_000_000, 1_000_000_000, 256);
  const plan = new ViewportTilePlanner(pyramid).plan(
    { x: 0, y: 0, width: 1_000_000_000, height: 1_000_000_000, zoom: 1 },
    { maxRequests: 32, prefetchMarginTiles: 0, fallbackLevels: 0 },
  );
  assert.equal(plan.requests.length, 32);
  assert.equal(plan.truncated, true);
  assert.ok(plan.requests.every((request) => request.address.column > 1_000_000));
});

test("viewport planning clips off-canvas views and validates zoom", () => {
  const planner = new ViewportTilePlanner(new VirtualCanvasPyramid(4096, 4096));
  assert.equal(planner.plan({ x: 5000, y: 0, width: 100, height: 100, zoom: 1 }).requests.length, 0);
  const partial = planner.plan({ x: -128, y: -128, width: 256, height: 256, zoom: 1 });
  assert.deepEqual(partial.viewport, { x: 0, y: 0, width: 128, height: 128 });
  assert.throws(() => planner.plan({ x: 0, y: 0, width: 10, height: 10, zoom: 0 }), /zoom/);
});

test("dirty regions propagate through the pyramid and drains can target a level", () => {
  const pyramid = new VirtualCanvasPyramid(2048, 1024, 256);
  const dirty = new PyramidDirtyTracker(pyramid);
  const first = dirty.invalidate({ x: 255, y: 255, width: 2, height: 2 });
  assert.equal(first.revision, 1);
  assert.equal(dirty.stats().byLevel[0], 4);
  assert.ok(dirty.stats().dirtyTiles > 4);
  assert.ok(dirty.peek().every((entry) => entry.revision === 1));

  const base = dirty.drain(0);
  assert.equal(base.length, 4);
  assert.equal(dirty.stats().byLevel[0], undefined);
  assert.ok(dirty.drain().every((entry) => entry.address.level > 0));
  assert.equal(dirty.stats().dirtyTiles, 0);
});

test("large and global invalidations remain constant-memory generations", () => {
  const pyramid = new VirtualCanvasPyramid(1_000_000_000, 1_000_000_000, 256);
  const dirty = new PyramidDirtyTracker(pyramid, 16);
  const invalidation = dirty.invalidate({ x: 0, y: 0, width: pyramid.width, height: pyramid.height });
  assert.ok(invalidation.broadLevels.length > 0);
  assert.ok(dirty.stats().dirtyTiles <= 16 * (pyramid.maxLevel + 1));
  assert.equal(dirty.revisionFor("0/0/0"), invalidation.revision);
  assert.equal(dirty.revisionFor(`0/${pyramid.level(0).columns - 1}/0`), invalidation.revision);

  const globalRevision = dirty.invalidateAll();
  assert.equal(dirty.stats().dirtyTiles, 0);
  assert.equal(dirty.revisionFor(`${pyramid.maxLevel}/0/0`), globalRevision);
});

test("residency evicts clean low-priority LRU tiles and reports telemetry", () => {
  const cache = new TileResidencyCache<string>(300);
  assert.equal(cache.admit("old", "a", 100, { priority: 1 }).accepted, true);
  assert.equal(cache.admit("recent", "b", 100, { priority: 1 }).accepted, true);
  assert.equal(cache.admit("important", "c", 100, { priority: 10 }).accepted, true);
  assert.equal(cache.get("old"), "a");
  assert.equal(cache.get("missing"), undefined);

  const admission = cache.admit("viewport", "d", 100, { priority: 5 });
  assert.equal(admission.accepted, true);
  assert.deepEqual(admission.evicted.map((entry) => entry.key), ["recent"]);
  assert.equal(cache.has("important"), true);
  assert.equal(cache.stats().residentBytes, 300);
  assert.equal(cache.stats().hits, 1);
  assert.equal(cache.stats().misses, 1);
  assert.equal(cache.stats().hitRate, 0.5);
});

test("residency protects dirty and pinned tiles until callers release them", () => {
  const cache = new TileResidencyCache<string>(200);
  cache.admit("dirty", "a", 100, { dirty: true });
  cache.admit("pinned", "b", 100, { pinned: true });
  const rejected = cache.admit("new", "c", 100, { priority: 100 });
  assert.deepEqual(rejected, { accepted: false, reason: "protected-working-set", evicted: [] });
  assert.equal(cache.stats().rejections, 1);

  cache.markPersisted("dirty");
  const accepted = cache.admit("new", "c", 100, { priority: 100 });
  assert.equal(accepted.accepted, true);
  assert.deepEqual(accepted.evicted.map((entry) => entry.key), ["dirty"]);
  cache.unpin("pinned");
  const shrunk = cache.setBudget(50);
  assert.equal(shrunk.overBudgetBytes, 0);
  assert.equal(cache.stats().residentTiles, 0);
});

test("residency budgets reserve headroom and obey configured bounds", () => {
  const gib = 1024 ** 3;
  assert.equal(computeResidencyBudget({ availableMemoryBytes: 8 * gib }), 1.9375 * gib);
  assert.equal(computeResidencyBudget({
    availableMemoryBytes: 512 * 1024 ** 2,
    reserveBytes: 256 * 1024 ** 2,
    fraction: 0.25,
  }), 64 * 1024 ** 2);
  assert.throws(() => computeResidencyBudget({ availableMemoryBytes: gib, fraction: 2 }), /fraction/);
});

test("residency admissions that fit do not evict the working set", () => {
  const cache = new TileResidencyCache<number>(10_000);
  for (let index = 0; index < 100; index += 1) {
    assert.equal(cache.admit(`tile-${index}`, index, 100).accepted, true);
  }
  assert.equal(cache.stats().residentTiles, 100);
  assert.equal(cache.stats().residentBytes, 10_000);
  assert.equal(cache.stats().evictions, 0);
});

test("scheduler enforces concurrency, priority order, and request deduplication", async () => {
  const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));
  const releases = new Map<string, () => void>();
  const starts: string[] = [];
  let active = 0;
  let peak = 0;
  const scheduler = new CancellableTileScheduler<{ key: string; priority: number }, string>(1, async (request) => {
    starts.push(request.key);
    active += 1;
    peak = Math.max(peak, active);
    await new Promise<void>((resolve) => releases.set(request.key, resolve));
    active -= 1;
    return request.key;
  });

  const first = scheduler.request({ key: "first", priority: 1 });
  const low = scheduler.request({ key: "low", priority: 1 });
  const high = scheduler.request({ key: "high", priority: 10 });
  const duplicate = scheduler.request({ key: "high", priority: 20 });
  await nextTurn();
  assert.deepEqual(starts, ["first"]);
  releases.get("first")!();
  assert.equal(await first, "first");
  await nextTurn();
  assert.deepEqual(starts, ["first", "high"]);
  releases.get("high")!();
  assert.equal(await high, "high");
  assert.equal(await duplicate, "high");
  await nextTurn();
  releases.get("low")!();
  assert.equal(await low, "low");
  assert.equal(peak, 1);
  assert.equal(scheduler.stats().deduplicated, 1);
  assert.equal(scheduler.stats().completed, 3);
});

test("scheduler cancels obsolete queued and in-flight viewport work", async () => {
  const releases = new Map<string, () => void>();
  const signals = new Map<string, AbortSignal>();
  const scheduler = new CancellableTileScheduler<{ key: string; priority: number }, string>(1, async (request, signal) => {
    signals.set(request.key, signal);
    await new Promise<void>((resolve) => releases.set(request.key, resolve));
    return request.key;
  });
  const running = scheduler.request({ key: "running", priority: 1 });
  const queued = scheduler.request({ key: "queued", priority: 1 });
  await Promise.resolve();
  assert.equal(scheduler.retain(new Set(["replacement"])), 2);
  await assert.rejects(queued, TileRequestCancelledError);
  assert.equal(signals.get("running")?.aborted, true);
  releases.get("running")!();
  await assert.rejects(running, TileRequestCancelledError);
  assert.equal(scheduler.stats().cancelled, 2);
});
