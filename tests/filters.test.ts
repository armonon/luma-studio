import assert from "node:assert/strict";
import test from "node:test";
import "./canvas-harness.ts";
import { createDocument, createRasterLayer } from "../app/engine/document.ts";
import {
  SMART_FILTER_KINDS,
  applySmartFilters,
  SMART_FILTER_SPECS,
  dustAndScratches,
  displace,
  filterRegionForSelection,
  gaussianBlur,
  highPass,
  lensBlur,
  invertColors,
  maximumFilter,
  medianFilter,
  minimumFilter,
  motionBlur,
  reduceNoise,
  smartFilterInfluenceRadius,
  surfaceBlur,
  unsharpMask,
} from "../app/engine/filters.ts";
import { pixelAt, solidCanvas, testCanvas } from "./canvas-harness.ts";

function rectangularSelection(width: number, height: number, x: number, y: number, w: number, h: number) {
  const mask = testCanvas(width, height);
  const context = mask.getContext("2d")!;
  context.fillStyle = "white";
  context.fillRect(x, y, w, h);
  return { mask, bounds: { x, y, w, h } };
}

function patternedCanvas(width: number, height: number) {
  const canvas = testCanvas(width, height);
  const context = canvas.getContext("2d")!;
  const image = context.createImageData(width, height);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const offset = (y * width + x) * 4;
    image.data[offset] = (x * 17 + y * 3) % 256;
    image.data[offset + 1] = (x * 5 + y * 19) % 256;
    image.data[offset + 2] = (x * 11 + y * 7) % 256;
    image.data[offset + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

test("oversized Gaussian radii preserve a solid small image", () => {
  for (const [width, height] of [[1, 1], [1, 5], [5, 1], [2, 2]] as const) {
    const bitmap = solidCanvas(width, height, "rgba(128, 96, 64, 1)");
    const layer = createRasterLayer("small", bitmap);
    gaussianBlur(createDocument(width, height), layer, 64);
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      assert.deepEqual(pixelAt(bitmap, x, y), { r: 128, g: 96, b: 64, a: 255 });
    }
  }
});

test("oversized Gaussian radii never introduce transparent or invalid edge pixels", () => {
  const bitmap = solidCanvas(2, 2, "rgba(255, 255, 255, 1)");
  const context = bitmap.getContext("2d")!;
  context.fillStyle = "rgba(0, 0, 0, 1)";
  context.fillRect(0, 0, 1, 1);
  const layer = createRasterLayer("contrast", bitmap);
  gaussianBlur(createDocument(2, 2), layer, 64);
  for (let y = 0; y < 2; y += 1) for (let x = 0; x < 2; x += 1) {
    const pixel = pixelAt(bitmap, x, y);
    assert.equal(pixel.a, 255);
    assert.ok(pixel.r >= 0 && pixel.r <= 255);
    assert.equal(pixel.r, pixel.g);
    assert.equal(pixel.g, pixel.b);
  }
});

test("selected point filters read and write only the selection rectangle", () => {
  const width = 512;
  const height = 384;
  const bitmap = solidCanvas(width, height, "rgba(20, 40, 60, 1)");
  const layer = createRasterLayer("bounded", bitmap);
  const doc = createDocument(width, height);
  doc.selection = rectangularSelection(width, height, 203, 117, 9, 7);

  const context = bitmap.getContext("2d")!;
  const originalGetImageData = context.getImageData.bind(context);
  const reads: number[][] = [];
  context.getImageData = ((...args: Parameters<typeof context.getImageData>) => {
    reads.push(args.slice(0, 4) as number[]);
    return originalGetImageData(...args);
  }) as typeof context.getImageData;

  invertColors(doc, layer);

  assert.deepEqual(reads, [[203, 117, 9, 7]]);
  assert.deepEqual(pixelAt(bitmap, 205, 120), { r: 235, g: 215, b: 195, a: 255 });
  assert.deepEqual(pixelAt(bitmap, 202, 120), { r: 20, g: 40, b: 60, a: 255 });
  assert.deepEqual(pixelAt(bitmap, 212, 120), { r: 20, g: 40, b: 60, a: 255 });
  assert.ok(reads[0][2] * reads[0][3] < (width * height) / 1000);
});

test("selection regions map from document coordinates into transformed layer pixels", () => {
  const bitmap = solidCanvas(100, 80, "rgba(10, 20, 30, 1)");
  const layer = createRasterLayer("transformed", bitmap);
  layer.transform = { tx: 20, ty: 10, sx: 2, sy: 0.5, rotation: 0 };
  const doc = createDocument(240, 120);
  doc.selection = rectangularSelection(240, 120, 40, 20, 20, 10);

  assert.deepEqual(filterRegionForSelection(doc, layer), {
    x: 10,
    y: 20,
    width: 10,
    height: 20,
  });

  invertColors(doc, layer);
  assert.deepEqual(pixelAt(bitmap, 15, 30), { r: 245, g: 235, b: 225, a: 255 });
  assert.deepEqual(pixelAt(bitmap, 9, 30), { r: 10, g: 20, b: 30, a: 255 });
  assert.deepEqual(pixelAt(bitmap, 20, 30), { r: 10, g: 20, b: 30, a: 255 });
});

test("selection region bounds remain tight for rotated layers", () => {
  const bitmap = solidCanvas(80, 80, "black");
  const layer = createRasterLayer("rotated", bitmap);
  layer.transform = { tx: 50, ty: 10, sx: 1, sy: 1, rotation: Math.PI / 2 };
  const doc = createDocument(100, 100);
  doc.selection = rectangularSelection(100, 100, 30, 20, 10, 20);

  assert.deepEqual(filterRegionForSelection(doc, layer), {
    x: 10,
    y: 10,
    width: 20,
    height: 10,
  });

  invertColors(doc, layer);
  assert.deepEqual(pixelAt(bitmap, 15, 15), { r: 255, g: 255, b: 255, a: 255 });
  assert.deepEqual(pixelAt(bitmap, 5, 15), { r: 0, g: 0, b: 0, a: 255 });
});

test("bounded selected Gaussian matches a full-image blur within the selection", () => {
  const width = 64;
  const height = 56;
  const original = patternedCanvas(width, height);
  const selectedBitmap = testCanvas(width, height);
  selectedBitmap.getContext("2d")!.drawImage(original, 0, 0);
  const referenceBitmap = testCanvas(width, height);
  referenceBitmap.getContext("2d")!.drawImage(original, 0, 0);
  const selectedLayer = createRasterLayer("selected", selectedBitmap);
  const referenceLayer = createRasterLayer("reference", referenceBitmap);
  const selectedDoc = createDocument(width, height);
  selectedDoc.selection = rectangularSelection(width, height, 25, 19, 11, 9);

  gaussianBlur(selectedDoc, selectedLayer, 4);
  gaussianBlur(createDocument(width, height), referenceLayer, 4);

  for (let y = 19; y < 28; y += 1) for (let x = 25; x < 36; x += 1) {
    assert.deepEqual(pixelAt(selectedBitmap, x, y), pixelAt(referenceBitmap, x, y));
  }
  for (const [x, y] of [[24, 22], [36, 22], [30, 18], [30, 28]] as const) {
    assert.deepEqual(pixelAt(selectedBitmap, x, y), pixelAt(original, x, y));
  }
});

test("empty selections skip filter allocations and leave pixels unchanged", () => {
  const bitmap = solidCanvas(128, 96, "rgba(30, 60, 90, 1)");
  const layer = createRasterLayer("empty", bitmap);
  const doc = createDocument(128, 96);
  doc.selection = rectangularSelection(128, 96, 0, 0, 0, 0);
  const context = bitmap.getContext("2d")!;
  const originalGetImageData = context.getImageData.bind(context);
  let reads = 0;
  context.getImageData = ((...args: Parameters<typeof context.getImageData>) => {
    reads += 1;
    return originalGetImageData(...args);
  }) as typeof context.getImageData;

  invertColors(doc, layer);

  assert.equal(reads, 0);
  assert.deepEqual(pixelAt(bitmap, 64, 48), { r: 30, g: 60, b: 90, a: 255 });
});

test("selected unsharp mask includes a bounded blur halo, not the whole layer", () => {
  const width = 400;
  const height = 300;
  const bitmap = patternedCanvas(width, height);
  const layer = createRasterLayer("unsharp", bitmap);
  const doc = createDocument(width, height);
  doc.selection = rectangularSelection(width, height, 190, 140, 8, 6);
  const context = bitmap.getContext("2d")!;
  const originalGetImageData = context.getImageData.bind(context);
  const reads: number[][] = [];
  context.getImageData = ((...args: Parameters<typeof context.getImageData>) => {
    reads.push(args.slice(0, 4) as number[]);
    return originalGetImageData(...args);
  }) as typeof context.getImageData;

  unsharpMask(doc, layer, 3, 0.8);

  assert.equal(reads.length, 1);
  assert.ok(reads[0][0] < 190 && reads[0][1] < 140);
  assert.ok(reads[0][2] < 40 && reads[0][3] < 40);
  assert.ok(reads[0][2] * reads[0][3] < (width * height) / 100);
  assert.deepEqual(pixelAt(bitmap, 50, 50), pixelAt(patternedCanvas(width, height), 50, 50));
});

test("professional smart-filter catalogue is complete and provides deterministic defaults", () => {
  assert.equal(SMART_FILTER_KINDS.length, 15);
  assert.deepEqual(new Set(SMART_FILTER_KINDS).size, SMART_FILTER_KINDS.length);
  for (const kind of SMART_FILTER_KINDS) {
    assert.ok(SMART_FILTER_SPECS[kind].label.length > 2);
    assert.ok(SMART_FILTER_SPECS[kind].category.length > 2);
  }
  assert.ok(smartFilterInfluenceRadius({ kind: "high-pass", params: { radius: 4 } }) > 4);
  assert.equal(smartFilterInfluenceRadius({ kind: "invert", params: {} }), 0);
});

test("lens blur uses an aperture footprint and preserves a flat field", () => {
  const flat = solidCanvas(18, 18, "rgba(60, 100, 140, .5)");
  lensBlur(createDocument(18, 18), createRasterLayer("flat", flat), 5, 6, 0, 0.2);
  const pixel = pixelAt(flat, 9, 9);
  assert.ok(Math.abs(pixel.r - 60) <= 1);
  assert.ok(Math.abs(pixel.g - 100) <= 1);
  assert.ok(Math.abs(pixel.b - 140) <= 1);
  assert.equal(pixel.a, 127);
});

test("reduce noise smooths chroma noise while protecting a strong edge", () => {
  const bitmap = solidCanvas(16, 8, "rgb(30,30,30)");
  const context = bitmap.getContext("2d")!;
  context.fillStyle = "rgb(220,220,220)";
  context.fillRect(8, 0, 8, 8);
  context.fillStyle = "rgb(30,0,60)";
  context.fillRect(3, 3, 1, 1);
  reduceNoise(createDocument(16, 8), createRasterLayer("noise", bitmap), 2, 1, 0.75, 1);
  assert.ok(pixelAt(bitmap, 3, 3).b < 60, "isolated color noise is reduced");
  assert.ok(pixelAt(bitmap, 7, 4).r < 80, "dark side remains dark");
  assert.ok(pixelAt(bitmap, 8, 4).r > 170, "bright side remains bright");
});

test("displace warps along the requested axis and reports exact overscan", () => {
  const bitmap = solidCanvas(24, 12, "black");
  bitmap.getContext("2d")!.fillStyle = "white";
  bitmap.getContext("2d")!.fillRect(12, 0, 1, 12);
  displace(createDocument(24, 12), createRasterLayer("grid", bitmap), 4, 12, 0);
  assert.notEqual(pixelAt(bitmap, 12, 3).r, pixelAt(bitmap, 12, 6).r);
  assert.equal(smartFilterInfluenceRadius({ kind: "displace", params: { amount: -11 } }), 13);
});

test("high pass turns flat color into neutral gray and preserves alpha", () => {
  const bitmap = solidCanvas(12, 12, "rgba(32, 180, 90, .5)");
  highPass(createDocument(12, 12), createRasterLayer("flat", bitmap), 3);
  const pixel = pixelAt(bitmap, 6, 6);
  assert.ok(pixel.r >= 127 && pixel.r <= 129);
  assert.ok(pixel.g >= 127 && pixel.g <= 129);
  assert.ok(pixel.b >= 127 && pixel.b <= 129);
  assert.equal(pixel.a, 127);
});

test("motion blur spreads an impulse along its angle without crossing the perpendicular axis", () => {
  const bitmap = solidCanvas(15, 15, "black");
  const context = bitmap.getContext("2d")!;
  context.fillStyle = "white";
  context.fillRect(7, 7, 1, 1);
  motionBlur(createDocument(15, 15), createRasterLayer("impulse", bitmap), 4, 0);
  assert.ok(pixelAt(bitmap, 4, 7).r > 0);
  assert.equal(pixelAt(bitmap, 7, 4).r, 0);
  assert.equal(pixelAt(bitmap, 7, 7).a, 255);
});

test("median, maximum and minimum implement distinct morphology operations", () => {
  const salt = solidCanvas(9, 9, "black");
  salt.getContext("2d")!.fillStyle = "white";
  salt.getContext("2d")!.fillRect(4, 4, 1, 1);
  medianFilter(createDocument(9, 9), createRasterLayer("salt", salt), 1);
  assert.equal(pixelAt(salt, 4, 4).r, 0, "median removes isolated salt");

  const bright = solidCanvas(9, 9, "black");
  bright.getContext("2d")!.fillStyle = "white";
  bright.getContext("2d")!.fillRect(4, 4, 1, 1);
  maximumFilter(createDocument(9, 9), createRasterLayer("bright", bright), 1);
  assert.equal(pixelAt(bright, 3, 4).r, 255, "maximum expands highlights");

  const dark = solidCanvas(9, 9, "white");
  dark.getContext("2d")!.fillStyle = "black";
  dark.getContext("2d")!.fillRect(4, 4, 1, 1);
  minimumFilter(createDocument(9, 9), createRasterLayer("dark", dark), 1);
  assert.equal(pixelAt(dark, 3, 4).r, 0, "minimum expands shadows");
});

test("surface blur protects strong edges while dust removal replaces isolated defects", () => {
  const edge = solidCanvas(12, 6, "rgb(20,20,20)");
  const context = edge.getContext("2d")!;
  context.fillStyle = "rgb(230,230,230)";
  context.fillRect(6, 0, 6, 6);
  context.fillStyle = "rgb(35,35,35)";
  context.fillRect(2, 2, 1, 1);
  surfaceBlur(createDocument(12, 6), createRasterLayer("surface", edge), 2, 25);
  assert.ok(pixelAt(edge, 5, 3).r < 60);
  assert.ok(pixelAt(edge, 6, 3).r > 190);

  const dust = solidCanvas(9, 9, "rgb(80,80,80)");
  dust.getContext("2d")!.fillStyle = "white";
  dust.getContext("2d")!.fillRect(4, 4, 1, 1);
  dustAndScratches(createDocument(9, 9), createRasterLayer("dust", dust), 1, 20);
  assert.equal(pixelAt(dust, 4, 4).r, 80);
  assert.equal(pixelAt(dust, 3, 4).r, 80);
});

test("displace ripples the same way in document space at every zoom", () => {
  // Every other smart filter takes its radius in pixels and gets multiplied by
  // displayScale so the preview matches the export. Displace's amplitude and
  // wavelength are pixel quantities too, but were passed through raw: at 2x
  // zoom the ripple stayed fixed in output pixels, so in document space it had
  // half the amplitude and half the wavelength. The canvas showed one image
  // and the exported file another, with zoom deciding which.
  const measure = (displayScale: number) => {
    const size = 256 * displayScale;
    const canvas = testCanvas(size, size);
    const paint = canvas.getContext("2d")!;
    paint.fillStyle = "#000000";
    paint.fillRect(0, 0, size, size);
    paint.fillStyle = "#ffffff";
    paint.fillRect(0, 0, 128 * displayScale, size);

    applySmartFilters(
      canvas as unknown as HTMLCanvasElement,
      [{ id: "d", kind: "displace", enabled: true, opacity: 1, params: { amount: 20, scale: 48 } }],
      displayScale,
    );

    // Where the white/black boundary ended up on each row, in document space.
    const edges: number[] = [];
    for (let y = 0; y < size; y += 1) {
      let edge = 0;
      for (let x = 0; x < size; x += 1) if (pixelAt(canvas, x, y).r > 128) edge = x;
      edges.push(edge / displayScale);
    }
    return Math.max(...edges) - Math.min(...edges);
  };

  const oneToOne = measure(1);
  assert.ok(oneToOne > 20, `the ripple should be plainly visible at 1x (got ${oneToOne})`);
  assert.ok(
    Math.abs(measure(2) - oneToOne) <= 2,
    `the same ripple at 2x zoom (1x: ${oneToOne}, 2x: ${measure(2)})`,
  );
});

test("displace overscan covers the amplitude it will actually use", () => {
  // The influence radius feeds viewportLayerPlan's overscan. If it reports the
  // unscaled amplitude while applySmartFilters displaces by the scaled one, a
  // zoomed tile samples past what was rendered for it and leaves a seam.
  const filter = { kind: "displace" as const, params: { amount: 20 } };
  assert.equal(smartFilterInfluenceRadius(filter, 1), 22);
  assert.equal(smartFilterInfluenceRadius(filter, 2), 42);
});
