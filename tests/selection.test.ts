import assert from "node:assert/strict";
import test from "node:test";
import "./canvas-harness.ts";
import { createDocument } from "../app/engine/document.ts";
import {
  featherSelection,
  alphaSurfaceFromCanvas,
  planFeatherSelection,
  refineSelection,
  refineSelectionAlpha,
  selectionRegionCanvas,
} from "../app/engine/selection.ts";
import { testCanvas } from "./canvas-harness.ts";

function maskAlpha(mask: HTMLCanvasElement) {
  const image = mask.getContext("2d")!.getImageData(0, 0, mask.width, mask.height);
  const alpha = new Uint8ClampedArray(mask.width * mask.height);
  for (let pixel = 0; pixel < alpha.length; pixel += 1) alpha[pixel] = image.data[pixel * 4 + 3];
  return alpha;
}

function alphaBounds(alpha: Uint8ClampedArray, width: number, height: number) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    if (alpha[y * width + x] === 0) continue;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return maxX < 0
    ? { x: 0, y: 0, w: 0, h: 0 }
    : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function rectangularMask(width: number, height: number, x: number, y: number, w: number, h: number) {
  const mask = testCanvas(width, height);
  const context = mask.getContext("2d")!;
  context.fillStyle = "white";
  context.fillRect(x, y, w, h);
  return mask;
}

function currentSelectionMask(doc: ReturnType<typeof createDocument>) {
  const mask = selectionRegionCanvas(doc, { x: 0, y: 0, width: doc.width, height: doc.height });
  assert.ok(mask);
  return mask;
}

function fullCanvasFeather(mask: HTMLCanvasElement, radius: number) {
  const output = testCanvas(mask.width, mask.height);
  const context = output.getContext("2d")!;
  context.filter = `blur(${radius}px)`;
  context.drawImage(mask, 0, 0);
  context.filter = "none";
  return output;
}

test("selection refinement can grow, smooth, and harden an edge", () => {
  const width = 9;
  const height = 9;
  const source = new Uint8ClampedArray(width * height);
  source[4 * width + 4] = 255;
  const grown = refineSelectionAlpha(source, width, height, { smooth: 0, contrast: 0, shiftEdge: 6 });
  assert.equal(grown[4 * width + 4], 255);
  assert.equal(grown[4 * width + 3], 255);
  assert.equal(grown[3 * width + 4], 255);

  const smoothed = refineSelectionAlpha(grown, width, height, { smooth: 2, contrast: 0, shiftEdge: 0 });
  assert.ok(smoothed.some((value) => value > 0 && value < 255));
  const hardened = refineSelectionAlpha(smoothed, width, height, { smooth: 0, contrast: 40, shiftEdge: 0 });
  assert.ok(Math.abs(hardened[4 * width + 4] - 127.5) >= Math.abs(smoothed[4 * width + 4] - 127.5));
});

test("negative edge shift contracts a selection", () => {
  const width = 7;
  const height = 7;
  const source = new Uint8ClampedArray(width * height).fill(255);
  for (let x = 0; x < width; x += 1) {
    source[x] = 0;
    source[(height - 1) * width + x] = 0;
  }
  for (let y = 0; y < height; y += 1) {
    source[y * width] = 0;
    source[y * width + width - 1] = 0;
  }
  const contracted = refineSelectionAlpha(source, width, height, { smooth: 0, contrast: 0, shiftEdge: -7 });
  assert.equal(contracted[1 * width + 1], 0);
  assert.equal(contracted[3 * width + 3], 255);
});

for (const scenario of [
  {
    name: "interior grow, smooth, and contrast",
    size: [240, 180] as const,
    bounds: { x: 105, y: 80, w: 9, h: 7 },
    params: { smooth: 5, contrast: 28, shiftEdge: 50 },
  },
  {
    name: "document-edge grow and smooth",
    size: [220, 170] as const,
    bounds: { x: 0, y: 0, w: 8, h: 6 },
    params: { smooth: 6, contrast: 0, shiftEdge: 37.5 },
  },
  {
    name: "contraction followed by smoothing",
    size: [210, 160] as const,
    bounds: { x: 80, y: 55, w: 30, h: 24 },
    params: { smooth: 4, contrast: 12, shiftEdge: -50 },
  },
] as const) {
  test(`bounded refinement has full-canvas parity for ${scenario.name}`, () => {
    const [width, height] = scenario.size;
    const mask = rectangularMask(
      width,
      height,
      scenario.bounds.x,
      scenario.bounds.y,
      scenario.bounds.w,
      scenario.bounds.h,
    );
    const originalAlpha = maskAlpha(mask);
    const expected = refineSelectionAlpha(originalAlpha, width, height, scenario.params);
    const doc = createDocument(width, height);
    doc.selection = { surface: alphaSurfaceFromCanvas(mask), bounds: { ...scenario.bounds } };
    const context = mask.getContext("2d")!;
    const originalGetImageData = context.getImageData.bind(context);
    const reads: number[][] = [];
    context.getImageData = ((...args: Parameters<typeof context.getImageData>) => {
      reads.push(args.slice(0, 4) as number[]);
      return originalGetImageData(...args);
    }) as typeof context.getImageData;

    assert.equal(refineSelection(doc, scenario.params), true);
    context.getImageData = originalGetImageData as typeof context.getImageData;

    assert.equal(reads.length, 0, "tilewise refinement must not revisit the legacy document canvas");
    assert.deepEqual(maskAlpha(currentSelectionMask(doc)), expected);
    assert.deepEqual(doc.selection?.bounds, alphaBounds(expected, width, height));
  });
}

test("empty selection refinement performs no pixel allocation", () => {
  const mask = testCanvas(512, 384);
  const doc = createDocument(512, 384);
  doc.selection = { mask, bounds: { x: 0, y: 0, w: 0, h: 0 } };
  const context = mask.getContext("2d")!;
  const originalGetImageData = context.getImageData.bind(context);
  let reads = 0;
  context.getImageData = ((...args: Parameters<typeof context.getImageData>) => {
    reads += 1;
    return originalGetImageData(...args);
  }) as typeof context.getImageData;

  assert.equal(refineSelection(doc, { smooth: 32, contrast: 100, shiftEdge: 100 }), true);
  assert.equal(reads, 0);
  assert.deepEqual(doc.selection.bounds, { x: 0, y: 0, w: 0, h: 0 });
});

for (const scenario of [
  {
    name: "interior selection",
    size: [320, 240] as const,
    bounds: { x: 147, y: 109, w: 17, h: 13 },
    radius: 4,
  },
  {
    name: "top-left document edge",
    size: [280, 210] as const,
    bounds: { x: 0, y: 0, w: 21, h: 15 },
    radius: 5,
  },
  {
    name: "bottom-right document edge with a fractional radius",
    size: [260, 190] as const,
    bounds: { x: 241, y: 173, w: 19, h: 17 },
    radius: 2.5,
  },
] as const) {
  test(`bounded feather has exact full-canvas parity for ${scenario.name}`, () => {
    const [width, height] = scenario.size;
    const mask = rectangularMask(
      width,
      height,
      scenario.bounds.x,
      scenario.bounds.y,
      scenario.bounds.w,
      scenario.bounds.h,
    );
    const expectedMask = fullCanvasFeather(mask, scenario.radius);
    const expectedAlpha = maskAlpha(expectedMask);
    const doc = createDocument(width, height);
    doc.selection = { mask, bounds: { ...scenario.bounds } };

    featherSelection(doc, scenario.radius);

    const actualMask = currentSelectionMask(doc);
    assert.equal(actualMask.width, width);
    assert.equal(actualMask.height, height);
    assert.deepEqual(maskAlpha(actualMask), expectedAlpha);
    assert.deepEqual(doc.selection?.bounds, alphaBounds(expectedAlpha, width, height));
  });
}

test("feather scratch allocation depends on selection and radius, not document area", () => {
  const bounds = { x: 20_000, y: 21_000, w: 100, h: 80 };
  const plan = planFeatherSelection(bounds, 50_000, 50_000, 8);

  assert.deepEqual(plan.care, { x: 19_966, y: 20_966, w: 168, h: 148 });
  assert.deepEqual(plan.work, { x: 19_932, y: 20_932, w: 236, h: 216 });
  assert.ok(plan.work.w * plan.work.h < 51_000);
  assert.ok(plan.work.w * plan.work.h < (50_000 * 50_000) / 40_000);
});

test("empty selection feathering leaves legacy storage untouched", () => {
  const mask = testCanvas(640, 480);
  const doc = createDocument(640, 480);
  doc.selection = { mask, bounds: { x: 0, y: 0, w: 0, h: 0 } };

  featherSelection(doc, 32);

  assert.equal(doc.selection.mask, mask);
  assert.equal(doc.selection.surface, undefined);
  assert.deepEqual(doc.selection.bounds, { x: 0, y: 0, w: 0, h: 0 });
});
