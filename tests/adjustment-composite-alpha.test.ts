import test from "node:test";
import assert from "node:assert/strict";
import { Studio } from "../app/engine/studio";
import { NEUTRAL_TONE } from "../app/engine/document";
import { renderClean } from "../app/engine/renderer";
import { testCanvas } from "./canvas-harness";

for (const alpha of [0, 64, 160, 255]) test(`full-strength normal tonal adjustment preserves alpha ${alpha} and applies once`, () => {
  const studio = new Studio(1, 1, testCanvas(1, 1));
  try {
    const layer = studio.addBlankRaster("Input");
    layer.bitmap!.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray([80, 120, 160, alpha]), 1, 1), 0, 0);
    const original = testCanvas(1, 1); renderClean(studio.doc, original);
    const expected = testCanvas(1, 1), ec = expected.getContext("2d")!;
    ec.filter = "brightness(1.175)"; ec.drawImage(original, 0, 0);
    const tone = studio.addAdjustmentLayer("tone");
    studio.updateTone(tone.id, { ...NEUTRAL_TONE, exposure: .5 });
    const actual = testCanvas(1, 1); renderClean(studio.doc, actual);
    const a = actual.getContext("2d")!.getImageData(0, 0, 1, 1).data;
    const b = expected.getContext("2d")!.getImageData(0, 0, 1, 1).data;
    assert.equal(a[3], b[3], "color adjustment must not add opacity");
    for (let c = 0; c < 3; c++) assert.ok(Math.abs(a[c] - b[c]) <= 2, `channel ${c}: ${a[c]} vs ${b[c]}`);
  } finally { studio.dispose(); }
});

for (const alpha of [64, 160, 255]) test(`normal full-strength curves adjustment preserves alpha ${alpha} and inverts once`, () => {
  const studio = new Studio(1, 1, testCanvas(1, 1));
  try {
    const layer = studio.addBlankRaster("Input");
    layer.bitmap!.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray([80, 120, 160, alpha]), 1, 1), 0, 0);
    const original = testCanvas(1, 1); renderClean(studio.doc, original);
    const input = original.getContext("2d")!.getImageData(0, 0, 1, 1).data;
    const curve = studio.addCurvesLayer();
    studio.updateCurves(curve.id, {
      rgb: [{ x: 0, y: 1 }, { x: 1, y: 0 }],
      r: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
      g: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
      b: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
    });
    const actual = testCanvas(1, 1); renderClean(studio.doc, actual);
    const output = actual.getContext("2d")!.getImageData(0, 0, 1, 1).data;
    assert.equal(output[3], input[3]);
    for (let c = 0; c < 3; c++) assert.ok(Math.abs(output[c] - (255 - input[c])) <= 2);
  } finally { studio.dispose(); }
});
