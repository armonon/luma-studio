import assert from "node:assert/strict";
import test from "node:test";
import { testCanvas, solidCanvas, pixelAt } from "./canvas-harness.ts";
import { createDocument, createRasterLayer } from "../app/engine/document.ts";
import { renderClean, renderTiledClean } from "../app/engine/renderer.ts";
import { PrecisionTileSurface } from "../app/engine/tile-store.ts";
import { displaySrgbToWorking } from "../app/engine/color.ts";

// Include the darkest sRGB codes (most damaged by linear 8-bit quantization),
// several tile boundaries, opaque pixels and the retained browser fixture's
// partial-alpha range. Compare against canvas readback, not unpremultiplied
// bytes that canvas itself cannot represent exactly.
function gradient() {
  const canvas = testCanvas(513, 37), ctx = canvas.getContext("2d")!;
  const image = ctx.createImageData(canvas.width, canvas.height);
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const i = (y * image.width + x) * 4;
    image.data.set([x % 256, (x + y) % 256, y * 7 % 256, y < 16 ? 255 : 160 + y], i);
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

for (const [name, render] of [["full", renderClean], ["tiled", renderTiledClean]] as const) {
  test(`${name} 8-bit export preserves authoritative sRGB bitmap instead of quantizing through linear rgba8`, () => {
    const bitmap = gradient(), doc = createDocument(bitmap.width, bitmap.height);
    const layer = createRasterLayer("Imported gradient", bitmap);
    const expected = bitmap.getContext("2d")!.getImageData(0, 0, bitmap.width, bitmap.height);
    layer.surface = PrecisionTileSurface.fromImageData(expected, "rgba8", "srgb", 128);
    doc.layers = [layer];
    for (let attempt = 0; attempt < 2; attempt++) {
      const target = testCanvas(bitmap.width, bitmap.height);
      render(doc, target);
      const actual = target.getContext("2d")!.getImageData(0, 0, bitmap.width, bitmap.height);
      let maxRGB = 0, maxAlpha = 0;
      for (let i = 0; i < actual.data.length; i++) {
        const delta = Math.abs(actual.data[i] - expected.data[i]);
        if (i % 4 === 3) maxAlpha = Math.max(maxAlpha, delta);
        else maxRGB = Math.max(maxRGB, delta);
      }
      assert.ok(maxRGB <= 2, `max RGB error ${maxRGB} exceeds fixed canvas tolerance 2`);
      assert.equal(maxAlpha, 0);
    }
  });

  for (const format of ["rgba16f", "rgba32f"] as const) for (const colorSpace of ["srgb", "display-p3", "linear-srgb"] as const) {
    test(`${name} ${format}/${colorSpace} still uses the working surface, not its clipped bitmap`, () => {
      const doc = createDocument(2, 2), layer = createRasterLayer("Precision", solidCanvas(2, 2, "#ff0000"));
      const surface = new PrecisionTileSurface(2, 2, format, colorSpace);
      const rgb = displaySrgbToWorking([34 / 255, 153 / 255, 102 / 255], colorSpace);
      for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) surface.writePixel(x, y, [...rgb, 1]);
      layer.surface = surface; doc.layers = [layer];
      const target = testCanvas(2, 2); render(doc, target);
      assert.deepEqual(pixelAt(target, 0, 0), { r: 34, g: 153, b: 102, a: 255 });
    });
  }

  for (const proxy of [false, true]) {
    test(`${name} rgba8 ${proxy ? "preview proxy" : "tile-only"} retains its full-resolution surface`, () => {
      const doc = createDocument(2, 2), bitmap = solidCanvas(2, 2, "#00ff00");
      const layer = createRasterLayer("Tiles", bitmap);
      layer.surface = PrecisionTileSurface.fromImageData(bitmap.getContext("2d")!.getImageData(0, 0, 2, 2));
      layer.bitmap = proxy ? solidCanvas(1, 1, "#ff0000") : undefined;
      doc.layers = [layer]; const target = testCanvas(2, 2); render(doc, target);
      assert.deepEqual(pixelAt(target, 1, 1), { r: 0, g: 255, b: 0, a: 255 });
    });
  }
}

test("explicit 32→8 conversion refreshes a stale bitmap from the converted master, including transparent tiles", async () => {
  const { Studio } = await import("../app/engine/studio.ts");
  const studio = new Studio(257, 1, testCanvas(257, 1));
  try {
    const layer = studio.addRasterLayerFromCanvas(solidCanvas(257, 1, "#ff0000"), "Precision");
    studio.setDocumentPrecision(32, "srgb");
    // High-depth master is authoritative. A preview can be stale/clipped; the
    // first tile is green and the absent second tile must remain transparent.
    layer.surface = new PrecisionTileSurface(257, 1, "rgba32f", "srgb", 256);
    layer.surface.writePixel(0, 0, [0, 1, 0, 1]);
    studio.setDocumentPrecision(8, "srgb");
    const target = testCanvas(257, 1); renderClean(studio.doc, target);
    assert.deepEqual(pixelAt(target, 0, 0), { r: 0, g: 255, b: 0, a: 255 });
    assert.deepEqual(pixelAt(target, 256, 0), { r: 0, g: 0, b: 0, a: 0 });
    studio.undo();
    const undone = testCanvas(257, 1); renderClean(studio.doc, undone);
    assert.deepEqual(pixelAt(undone, 0, 0), { r: 0, g: 255, b: 0, a: 255 });
    studio.redo();
    const redone = testCanvas(257, 1); renderClean(studio.doc, redone);
    assert.deepEqual(pixelAt(redone, 0, 0), { r: 0, g: 255, b: 0, a: 255 });
    assert.deepEqual(pixelAt(redone, 256, 0), { r: 0, g: 0, b: 0, a: 0 });
  } finally { studio.dispose(); }
});
