import assert from "node:assert/strict";
import test from "node:test";
import {
  cmykToRgb,
  displaySrgbToWorking,
  labToXyz,
  linearRgbToXyz,
  rgbToCmyk,
  softProofDisplayRgb,
  workingToDisplaySrgb,
  xyzToLab,
} from "../app/engine/color.ts";

function close(actual: readonly number[], expected: readonly number[], tolerance = 1e-5) {
  actual.forEach((value, index) => assert.ok(
    Math.abs(value - expected[index]) <= tolerance,
    `${value} differed from ${expected[index]}`,
  ));
}

test("sRGB and Display P3 working conversions round-trip", () => {
  const display = [0.82, 0.21, 0.47] as const;
  close(workingToDisplaySrgb(displaySrgbToWorking(display, "srgb"), "srgb"), display);
  close(workingToDisplaySrgb(displaySrgbToWorking(display, "display-p3"), "display-p3"), display);
});

test("D65 Lab conversion round-trips XYZ", () => {
  const xyz = linearRgbToXyz([0.33, 0.55, 0.12]);
  close(labToXyz(xyzToLab(xyz)), xyz, 1e-6);
});

test("fallback CMYK conversion round-trips RGB", () => {
  const rgb = [0.2, 0.6, 0.9] as const;
  close(cmykToRgb(rgbToCmyk(rgb)), rgb);
});

test("CMYK proofing applies paper simulation and reports gamut compression", () => {
  const proof = softProofDisplayRgb([0.05, 0.95, 0.9], "cmyk-generic", "absolute-colorimetric", true);
  assert.ok(proof.rgb[0] > 0);
  assert.ok(proof.rgb[2] < 0.9);
  assert.equal(proof.outOfGamut, true);
});
