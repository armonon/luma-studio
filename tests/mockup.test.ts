import test from "node:test";
import assert from "node:assert/strict";
import {
  applyHomography, fittedArtSize, invertHomography, mockupFileName, normalizePlacement, placementMap, renderMockup,
  sceneDeltaToOffset, squareToQuad, type MockupPlacement, type MockupScene, type Quad, type RasterImage,
} from "../app/engine/mockup";
import { createMockupScene, MOCKUP_SCENES } from "../app/engine/mockup-scenes";
import { blurMask, fillPolygon } from "../app/engine/mockup-raster";

const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

test("the homography maps unit-square corners onto the quad and inverts exactly", () => {
  const quad: Quad = [[30, 40], [210, 55], [190, 260], [20, 230]];
  const H = squareToQuad(quad), inverse = invertHomography(H);
  [[0, 0], [1, 0], [1, 1], [0, 1]].forEach(([u, v], i) => {
    const [x, y] = applyHomography(H, u, v);
    close(x, quad[i][0], 1e-9); close(y, quad[i][1], 1e-9);
  });
  const [x, y] = applyHomography(H, 0.3, 0.7), [u, v] = applyHomography(inverse, x, y);
  close(u, 0.3, 1e-9); close(v, 0.7, 1e-9);
  // Perspective is real: the centre of the square is not the average of the corners.
  const [cx] = applyHomography(H, 0.5, 0.5);
  assert.ok(Math.abs(cx - (30 + 210 + 190 + 20) / 4) > 0.5);
});

test("contain fits the whole artwork; cover fills the print area", () => {
  const base: MockupPlacement = { fit: "contain", scale: 1, offsetX: 0, offsetY: 0, rotation: 0 };
  assert.deepEqual(fittedArtSize(200, 100, 0.75, base), { width: 0.75, height: 0.375 });
  assert.deepEqual(fittedArtSize(200, 100, 0.75, { ...base, fit: "cover" }), { width: 2, height: 1 });
  const map = placementMap(200, 100, 1, base);
  assert.deepEqual(map.toArt(0.5, 0.5), [100, 50]);
  assert.deepEqual(map.toArt(0, 0.25), [0, 0]);
  const rotated = placementMap(100, 100, 1, { ...base, rotation: 90 });
  const [ax, ay] = rotated.toArt(0.75, 0.5); // right of centre in print space…
  close(ax, 50, 1e-9); close(ay, 25, 1e-9); // …samples the art's top edge after a 90° clockwise turn
});

test("placement input is clamped and malformed values fall back", () => {
  const fallback: MockupPlacement = { fit: "contain", scale: 1, offsetX: 0, offsetY: 0, rotation: 0 };
  assert.deepEqual(normalizePlacement({ scale: 99, offsetX: -5, rotation: Number.NaN, fit: "stretch" as never }, fallback), { fit: "contain", scale: 3, offsetX: -1, offsetY: 0, rotation: 0 });
});

/** A synthetic flat scene: grey base, square print area, no shading or folds. */
function flatScene(size = 40): MockupScene {
  const n = size * size, base = new Uint8ClampedArray(n * 4).fill(128), printMask = new Float32Array(n);
  for (let i = 3; i < base.length; i += 4) base[i] = 255;
  fillPolygon(printMask, size, size, [[10, 10], [30, 10], [30, 30], [10, 30]]);
  return {
    id: "poster", name: "Flat", width: size, height: size, base, shading: new Float32Array(n).fill(1), printMask,
    displaceX: new Float32Array(n), displaceY: new Float32Array(n), overlay: null,
    quad: [[10, 10], [30, 10], [30, 30], [10, 30]], printAspect: 1, surface: "paper", bounds: { x0: 10, y0: 10, x1: 29, y1: 29 },
  };
}
const solid = (w: number, h: number, rgba: [number, number, number, number]): RasterImage => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set(rgba, i * 4);
  return { width: w, height: h, data };
};
const px = (out: Uint8ClampedArray, size: number, x: number, y: number) => [...out.slice((y * size + x) * 4, (y * size + x) * 4 + 4)];
const cover: MockupPlacement = { fit: "cover", scale: 1, offsetX: 0, offsetY: 0, rotation: 0 };

test("art lands inside the print area and nowhere else", () => {
  const scene = flatScene(), out = renderMockup(scene, solid(8, 8, [255, 0, 0, 255]), cover);
  assert.deepEqual(px(out, 40, 20, 20), [255, 0, 0, 255]);
  assert.deepEqual(px(out, 40, 5, 5), [128, 128, 128, 255]);
  assert.deepEqual(px(out, 40, 35, 20), [128, 128, 128, 255]);
  assert.deepEqual(renderMockup(scene, null, cover), scene.base, "no art renders the bare product");
  assert.deepEqual(renderMockup(scene, solid(8, 8, [255, 0, 0, 0]), cover), scene.base, "transparent art leaves it untouched");
});

test("shading lights the ink and the overlay sits in front of it", () => {
  const scene = flatScene();
  scene.shading.fill(0.5);
  scene.overlay = new Float32Array(40 * 40 * 4);
  const at = (22 * 40 + 22) * 4; scene.overlay.set([0, 0, 1, 1], at);
  const out = renderMockup(scene, solid(8, 8, [200, 200, 200, 255]), cover);
  const lit = px(out, 40, 20, 20)[0];
  assert.ok(lit < 110 && lit > 80, `ink takes the substrate's light (got ${lit})`);
  assert.deepEqual(px(out, 40, 22, 22), [0, 0, 255, 255]);
});

test("displacement bends the artwork (a fold moves an edge)", () => {
  const scene = flatScene();
  // Art: left half black, right half white → a vertical edge at u = 0.5 (x = 20).
  const art = solid(2, 1, [0, 0, 0, 255]); art.data.set([255, 255, 255, 255], 4);
  const flat = renderMockup(scene, art, cover);
  scene.displaceX.fill(4);
  const bent = renderMockup(scene, art, cover);
  const edge = (out: Uint8ClampedArray) => { for (let x = 10; x < 30; x++) if (px(out, 40, x, 20)[0] > 128) return x; return -1; };
  assert.equal(edge(bent), edge(flat) - 4, "sampling 4 px to the right moves the edge 4 px left");
});

test("dragging in scene space converts to print-area offset through the perspective", () => {
  const scene = flatScene();
  const [du, dv] = sceneDeltaToOffset(scene, [15, 15], [25, 15]);
  close(du, 0.5, 1e-9); close(dv, 0, 1e-9);
});

test("every procedural scene builds, has a printable area inside its quad, and is deterministic", () => {
  for (const info of MOCKUP_SCENES) {
    const a = createMockupScene(info.id, { size: 160 }), b = createMockupScene(info.id, { size: 160 });
    assert.equal(a.width, 160); assert.equal(a.base.length, 160 * 160 * 4);
    assert.deepEqual(a.base, b.base, `${info.id} is deterministic`);
    const printable = a.printMask.reduce((n, v) => n + (v > 0.5 ? 1 : 0), 0);
    assert.ok(printable > 160 * 160 * 0.03, `${info.id} has a usable print area (${printable} px)`);
    const inverse = invertHomography(squareToQuad(a.quad));
    for (let i = 0; i < a.printMask.length; i++) if (a.printMask[i] > 0.99) {
      const [u, v] = applyHomography(inverse, i % 160 + 0.5, Math.floor(i / 160) + 0.5);
      assert.ok(u > -0.05 && u < 1.05 && v > -0.05 && v < 1.05, `${info.id} mask stays within its print quad`);
    }
    // A full red print must actually change pixels in the scene.
    const out = renderMockup(a, solid(4, 4, [255, 0, 0, 255]), info.defaultPlacement);
    let changed = 0;
    for (let i = 0; i < out.length; i += 4) if (out[i] > out[i + 1] + 60) changed++;
    assert.ok(changed > printable * 0.3, `${info.id} renders the print (${changed} px)`);
  }
});

test("garment colour changes the product but not the print geometry", () => {
  const white = createMockupScene("tshirt", { size: 120, color: "#ffffff" }), black = createMockupScene("tshirt", { size: 120, color: "#000000" });
  assert.deepEqual(white.printMask, black.printMask);
  const centre = (60 * 120 + 60) * 4;
  assert.ok(white.base[centre] > 180 && black.base[centre] < 60);
  assert.throws(() => createMockupScene("tshirt", { size: 10 }), /size/);
  assert.throws(() => createMockupScene("tshirt", { color: "red" }), /color/);
});

test("box blur preserves mass and file names are safe", () => {
  const mask = new Float32Array(31 * 31); mask[15 * 31 + 15] = 1;
  const blurred = blurMask(mask, 31, 31, 6);
  close(blurred.reduce((a, b) => a + b, 0), 1, 1e-4);
  assert.ok(blurred[15 * 31 + 15] < 0.2);
  assert.equal(mockupFileName("Dunes final.luma", "tshirt", "image/png"), "Dunes-final-mockup-tshirt.png");
  assert.equal(mockupFileName("../../etc", "phone", "image/jpeg"), "etc-mockup-phone.jpg");
});
