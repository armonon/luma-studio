/**
 * Headless canvas harness.
 *
 * The compositor in `app/engine/renderer.ts` is the code that decides what
 * every pixel actually looks like, and it was untested because it needs a real
 * 2D context. This installs a Node-backed canvas so those paths can run under
 * `node --test` with no browser.
 *
 * Nothing here touches production code: `newCanvas()` calls
 * `document.createElement("canvas")`, so we only need a minimal `document`
 * shim plus the couple of globals the engine constructs directly.
 *
 * Import this module for its side effects before importing engine modules.
 */

import { createCanvas, ImageData as NapiImageData, loadImage } from "@napi-rs/canvas";

// Cast through `unknown`: the Node canvas types are structurally close to the
// DOM ones but not assignable to them, and intersecting with `typeof globalThis`
// would keep lib.dom's declarations and reject the assignment.
const g = globalThis as unknown as Record<string, unknown>;

if (!g.ImageData) g.ImageData = NapiImageData;

if (!g.createImageBitmap) {
  g.createImageBitmap = async (blob: Blob) => {
    const image = await loadImage(new Uint8Array(await blob.arrayBuffer()));
    return Object.assign(image, { close() {} });
  };
}

if (!g.document) {
  g.document = {
    createElement(tag: string) {
      if (tag !== "canvas") throw new Error(`canvas-harness only creates <canvas>, got <${tag}>`);
      // 1x1 placeholder; engine code assigns .width/.height immediately after.
      return createCanvas(1, 1);
    },
  };
}

/** Allocate a canvas directly, bypassing the document shim. */
export function testCanvas(width: number, height: number) {
  return createCanvas(width, height) as unknown as HTMLCanvasElement;
}

/** Fill a canvas with one solid colour — the usual golden-test input. */
export function solidCanvas(width: number, height: number, color: string) {
  const canvas = testCanvas(width, height);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, height);
  return canvas;
}

/** RGBA of a single pixel, as plain numbers. */
export function pixelAt(canvas: HTMLCanvasElement, x: number, y: number) {
  const { data } = canvas.getContext("2d")!.getImageData(x, y, 1, 1);
  return { r: data[0], g: data[1], b: data[2], a: data[3] };
}

/**
 * Assert a pixel matches an expected RGBA within a tolerance. Canvas
 * compositing rounds through 8-bit at several stages, so exact equality is the
 * wrong bar; ±2 catches real regressions without being brittle.
 */
export function expectPixel(
  actual: { r: number; g: number; b: number; a: number },
  expected: { r: number; g: number; b: number; a?: number },
  tolerance = 2,
) {
  const checks: Array<[string, number, number]> = [
    ["r", actual.r, expected.r],
    ["g", actual.g, expected.g],
    ["b", actual.b, expected.b],
  ];
  if (expected.a !== undefined) checks.push(["a", actual.a, expected.a]);
  const failures = checks
    .filter(([, got, want]) => Math.abs(got - want) > tolerance)
    .map(([ch, got, want]) => `${ch}: expected ${want}, got ${got}`);
  return failures;
}
