import test from "node:test";
import assert from "node:assert/strict";
import { Studio } from "../app/engine/studio";
import { renderClean } from "../app/engine/renderer";
import { testCanvas } from "./canvas-harness";

const variants = [
  { name: "zero opacity", opacity: 0, fill: 1, mask: 255 },
  { name: "master opacity", opacity: .5, fill: 1, mask: 255 },
  { name: "fill opacity", opacity: 1, fill: .5, mask: 255 },
  { name: "white mask", opacity: 1, fill: 1, mask: 255, masked: true },
  { name: "half mask", opacity: 1, fill: 1, mask: 128, masked: true },
  { name: "black mask", opacity: 1, fill: 1, mask: 0, masked: true },
  { name: "opacity times fill times mask", opacity: .5, fill: .5, mask: 128, masked: true },
];
for (const alpha of [0, 64, 160, 255]) for (const variant of variants) {
  test(`normal invert ${variant.name} preserves coverage and interpolates color at alpha ${alpha}`, () => {
    const studio = new Studio(1, 1, testCanvas(1, 1));
    try {
      const input = studio.addBlankRaster("Input");
      input.bitmap!.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray([80, 120, 160, alpha]), 1, 1), 0, 0);
      const before = testCanvas(1, 1); renderClean(studio.doc, before);
      const original = before.getContext("2d")!.getImageData(0, 0, 1, 1).data;
      const adjustment = studio.addProAdjustmentLayer("invert");
      adjustment.opacity = variant.opacity;
      adjustment.fillOpacity = variant.fill;
      if (variant.masked) {
        adjustment.mask = testCanvas(1, 1);
        adjustment.mask.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray([255, 255, 255, variant.mask]), 1, 1), 0, 0);
      }
      const after = testCanvas(1, 1); renderClean(studio.doc, after);
      const actual = after.getContext("2d")!.getImageData(0, 0, 1, 1).data;
      assert.equal(actual[3], original[3], `adjustment must not change backdrop alpha: ${[...actual]}`);
      if (alpha === 0) return;
      const strength = variant.opacity * variant.fill * variant.mask / 255;
      // Compare in 8-bit premultiplied space: multiple Canvas roundtrips
      // accumulate quantization, amplified on straight-RGB readback at low
      // alpha. Coverage remains exact; allow two premultiplied color units.
      for (let channel = 0; channel < 3; channel++) {
        const expected = original[channel] * (1 - strength) + (255 - original[channel]) * strength;
        assert.ok(Math.abs(actual[channel] - expected) * alpha / 255 <= 2, `channel ${channel}: ${actual[channel]} vs ${expected}`);
      }
    } finally { studio.dispose(); }
  });
}

for (const alpha of [0, 64, 160, 255]) test(`combined raster/vector masks and pass opacity preserve alpha ${alpha}`, () => {
  const studio = new Studio(3, 1, testCanvas(3, 1));
  try {
    const input = studio.addBlankRaster("Input");
    const bytes = new Uint8ClampedArray(12);
    for (let x = 0; x < 3; x++) bytes.set([80, 120, 160, alpha], x * 4);
    input.bitmap!.getContext("2d")!.putImageData(new ImageData(bytes, 3, 1), 0, 0);
    const before = testCanvas(3, 1); renderClean(studio.doc, before);
    const original = before.getContext("2d")!.getImageData(0, 0, 3, 1).data;
    const adjustment = studio.addProAdjustmentLayer("invert");
    adjustment.opacity = adjustment.fillOpacity = .5;
    adjustment.blendStack = [{ id: "normal", enabled: true, mode: "source-over", opacity: .5 }];
    adjustment.mask = testCanvas(3, 1);
    const masks = new Uint8ClampedArray(12);
    [128, 255, 255].forEach((a, x) => masks.set([255, 255, 255, a], x * 4));
    adjustment.mask.getContext("2d")!.putImageData(new ImageData(masks, 3, 1), 0, 0);
    adjustment.vectorMask = {
      anchors: [[0, 0], [2, 0], [2, 1], [0, 1]].map(([x, y]) => ({ x, y, hIn: { dx: 0, dy: 0 }, hOut: { dx: 0, dy: 0 } })),
      closed: true, fill: "#ffffff", stroke: "none", strokeWidth: 0,
    };
    const after = testCanvas(3, 1); renderClean(studio.doc, after);
    const actual = after.getContext("2d")!.getImageData(0, 0, 3, 1).data;
    for (let x = 0; x < 3; x++) {
      const off = x * 4;
      assert.equal(actual[off + 3], original[off + 3]);
      if (!alpha) continue;
      const strength = .125 * [128 / 255, 1, 0][x];
      for (let c = 0; c < 3; c++) {
        const expected = original[off + c] * (1 - strength) + (255 - original[off + c]) * strength;
        assert.ok(Math.abs(actual[off + c] - expected) * alpha / 255 <= 2, `pixel ${x}, channel ${c}`);
      }
    }
  } finally { studio.dispose(); }
});
