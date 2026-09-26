import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateDisplayViewport,
  documentPointToViewport,
  sameDisplayViewport,
  viewportPointToDocument,
  viewportFitScale,
  zoomViewToScale,
} from "../app/engine/viewport";

test("Actual Size is 100% pixel scale, not fit, and preserves the viewing anchor", () => {
  for (const size of [1000, 10000, 25000, 50000, 1000000]) {
    const fit = viewportFitScale(size, size, 1000, 800);
    const before = { zoom: 1, panX: 70, panY: -40 };
    const after = zoomViewToScale(before, fit, 1, 120, -80);
    const a = calculateDisplayViewport(size, size, 1000, 800, before, 2);
    const b = calculateDisplayViewport(size, size, 1000, 800, after, 2);
    assert.equal(b.cssScale, 1);
    const p = viewportPointToDocument(a, 1000, 800, 620, 320);
    const q = viewportPointToDocument(b, 1000, 800, 620, 320);
    assert.ok(Math.abs(p.x - q.x) < 1e-6 && Math.abs(p.y - q.y) < 1e-6);
    assert.ok(b.outputWidth * b.outputHeight <= 12000000);
  }
});

test("viewport allocations honor strict budgets even below quarter DPR and at extreme aspect ratios", () => {
  for (const [w, h] of [[100000, 100000], [1000000, 1], [1, 1000000], [9999, 7777]]) {
    for (const maxPixels of [1, 17, 100000, 12000000]) {
      const view = calculateDisplayViewport(50000, 50000, w, h, { zoom: 1, panX: 0, panY: 0 }, 3, { maxPixels, maxDimension: 4096 });
      assert.ok(view.outputWidth * view.outputHeight <= maxPixels, `${w}×${h}, ${maxPixels} pixels`);
      assert.ok(view.outputWidth <= 4096 && view.outputHeight <= 4096);
    }
  }
});

test("invalid zoom input preserves the view and zoom limits are actual-scale limits", () => {
  const view = { zoom: 1, panX: 12, panY: 18 };
  assert.equal(zoomViewToScale(view, 0.01, NaN), view);
  assert.equal(zoomViewToScale(view, 0, 1), view);
  assert.equal(zoomViewToScale(view, 0.01, 1000).zoom, 3200);
});

test("fit viewport preserves document aspect ratio and centers the pasteboard", () => {
  const viewport = calculateDisplayViewport(
    4000,
    2000,
    1000,
    700,
    { zoom: 1, panX: 0, panY: 0 },
    2,
  );
  assert.equal(viewport.cssScale, 0.25);
  assert.deepEqual(
    { x: viewport.x, y: viewport.y, width: viewport.width, height: viewport.height },
    { x: 0, y: -400, width: 4000, height: 2800 },
  );
  assert.equal(viewport.outputWidth, 2000);
  assert.equal(viewport.outputHeight, 1400);
  assert.equal(viewport.zoom, 0.5);
});

test("pan and zoom map the stage center back to the expected document point", () => {
  const viewport = calculateDisplayViewport(
    6000,
    4000,
    1200,
    800,
    { zoom: 2, panX: 120, panY: -80 },
    1,
  );
  const center = viewportPointToDocument(viewport, 1200, 800, 600, 400);
  assert.equal(center.x, 2700);
  assert.equal(center.y, 2200);
  const roundTrip = documentPointToViewport(viewport, 1200, 800, center.x, center.y);
  assert.deepEqual(roundTrip, { x: 600, y: 400 });
});

test("backing-store allocation is capped independently of document dimensions", () => {
  const viewport = calculateDisplayViewport(
    300_000,
    300_000,
    10_000,
    8_000,
    { zoom: 0.05, panX: 0, panY: 0 },
    3,
  );
  assert.ok(viewport.outputWidth <= 4096);
  assert.ok(viewport.outputHeight <= 4096);
  assert.ok(viewport.outputWidth * viewport.outputHeight <= 12_000_000);
  assert.ok(Number.isFinite(viewport.x));
  assert.ok(Number.isFinite(viewport.y));
});

test("viewport equality suppresses duplicate plans without swallowing real navigation", () => {
  const first = calculateDisplayViewport(
    6000,
    4000,
    1200,
    800,
    { zoom: 1.5, panX: 40, panY: -20 },
    2,
  );
  assert.equal(sameDisplayViewport(first, { ...first }), true);
  assert.equal(sameDisplayViewport(first, { ...first, x: first.x + 1e-8 }), true);
  assert.equal(sameDisplayViewport(first, { ...first, x: first.x + 0.01 }), false);
  assert.equal(sameDisplayViewport(first, { ...first, outputWidth: first.outputWidth + 1 }), false);
  assert.equal(sameDisplayViewport(first, { ...first, devicePixelRatio: 1 }), false);
  assert.equal(sameDisplayViewport(null, first), false);
});
