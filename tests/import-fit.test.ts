import assert from "node:assert/strict";
import test from "node:test";
import { pixelAt, solidCanvas, testCanvas } from "./canvas-harness.ts";
import { createDocument, fitImageRect } from "../app/engine/document.ts";
import { Studio } from "../app/engine/studio.ts";
import { renderClean } from "../app/engine/renderer.ts";

// Importing an image into an existing document used to draw it at 0,0 at
// native size: anything larger than the canvas was silently cropped, anything
// smaller was pinned to the top-left corner with transparency around it.
// These pin the "contain and centre" behaviour.

test("a larger image is scaled down to fit, not cropped", () => {
  const r = fitImageRect(4000, 2000, 1000, 1000);
  assert.equal(r.scale, 0.25, "limited by the wider axis");
  assert.equal(r.width, 1000);
  assert.equal(r.height, 500);
  assert.equal(r.x, 0, "fills horizontally");
  assert.equal(r.y, 250, "letterboxed vertically");
});

test("a tall image is limited by height", () => {
  const r = fitImageRect(1000, 4000, 1000, 1000);
  assert.equal(r.scale, 0.25);
  assert.equal(r.width, 250);
  assert.equal(r.height, 1000);
  assert.equal(r.x, 375, "pillarboxed horizontally");
  assert.equal(r.y, 0);
});

test("aspect ratio is always preserved", () => {
  for (const [sw, sh] of [[1600, 900], [900, 1600], [1234, 567], [50, 3000]]) {
    const r = fitImageRect(sw, sh, 800, 800);
    assert.ok(
      Math.abs(r.width / r.height - sw / sh) < 1e-9,
      `${sw}x${sh} distorted: got ${r.width}x${r.height}`,
    );
  }
});

test("a smaller image is centred at native size, not upscaled", () => {
  // Enlarging on import would invent detail the file does not contain.
  const r = fitImageRect(200, 100, 1000, 800);
  assert.equal(r.scale, 1);
  assert.equal(r.width, 200);
  assert.equal(r.height, 100);
  assert.equal(r.x, 400);
  assert.equal(r.y, 350);
});

test("upscaling is available when explicitly requested", () => {
  const r = fitImageRect(200, 100, 1000, 800, { allowUpscale: true });
  assert.equal(r.scale, 5);
  assert.equal(r.width, 1000);
  assert.equal(r.height, 500);
});

test("degenerate sizes do not produce NaN", () => {
  const cases: Array<[number, number, number, number]> = [
    [0, 100, 10, 10],
    [100, 0, 10, 10],
    [100, 100, 0, 10],
    [100, 100, 10, 0],
  ];
  for (const [sw, sh, dw, dh] of cases) {
    const r = fitImageRect(sw, sh, dw, dh);
    for (const v of [r.x, r.y, r.width, r.height, r.scale]) {
      assert.ok(Number.isFinite(v), `non-finite value for ${sw}x${sh} -> ${dw}x${dh}`);
    }
  }
});

// --- end to end through the real import path -------------------------------

/** A Studio with a fixed-size document, as if a project were already open. */
function studioWithCanvas(width: number, height: number) {
  const studio = new Studio(width, height, testCanvas(width, height));
  studio.doc.layers = [];
  Object.assign(studio.doc, createDocument(width, height));
  return studio;
}

/** Stand-in for an <img>; the engine only reads naturalWidth/Height and draws it. */
function fakeImage(width: number, height: number, color: string) {
  const canvas = solidCanvas(width, height, color);
  return Object.assign(canvas, { naturalWidth: width, naturalHeight: height }) as unknown as HTMLImageElement;
}

test("importing an oversized image keeps its far corner visible", () => {
  const studio = studioWithCanvas(100, 100);
  // 400x200 red -> scaled to 100x50, centred vertically (y 25..75).
  studio.addRasterFromImage("wide", fakeImage(400, 200, "#ff0000"));

  const target = testCanvas(100, 100);
  renderClean(studio.doc, target);

  // Bottom-right of the image would have been cropped away by the old 0,0 draw.
  const nearRight = pixelAt(target, 97, 50);
  assert.ok(nearRight.a > 200, `expected image at the right edge, got alpha ${nearRight.a}`);
  assert.ok(nearRight.r > 200 && nearRight.g < 60, "expected red at the right edge");

  // Letterbox bands stay empty.
  assert.equal(pixelAt(target, 50, 5).a, 0, "top band should be transparent");
  assert.equal(pixelAt(target, 50, 95).a, 0, "bottom band should be transparent");
  studio.dispose();
});

test("importing a smaller image centres it instead of pinning top-left", () => {
  const studio = studioWithCanvas(100, 100);
  // 20x20 blue -> centred at x/y 40..60.
  studio.addRasterFromImage("small", fakeImage(20, 20, "#0000ff"));

  const target = testCanvas(100, 100);
  renderClean(studio.doc, target);

  const centre = pixelAt(target, 50, 50);
  assert.ok(centre.a > 200 && centre.b > 200, "expected the image at the centre");
  assert.equal(pixelAt(target, 3, 3).a, 0, "top-left corner must be empty now");
  studio.dispose();
});
