import assert from "node:assert/strict";
import test from "node:test";
import {
  ColorProfileRegistry,
  ColorTransformCache,
  DISPLAY_P3_PROFILE,
  LINEAR_DISPLAY_P3_PROFILE,
  LINEAR_SRGB_PROFILE,
  REC2020_PROFILE,
  SRGB_PROFILE,
  createColorTransform,
  createProofingTransform,
  compileGpuColorTransform,
  profileForWorkingColorSpace,
} from "../app/engine/color-management.ts";
import {
  D50_WHITE,
  D65_WHITE,
  adaptXyz,
  multiplyMatrixVector,
} from "../app/engine/color-math.ts";

function close(actual: ArrayLike<number>, expected: ArrayLike<number>, tolerance = 1e-6) {
  assert.equal(actual.length, expected.length);
  for (let index = 0; index < actual.length; index += 1) {
    assert.ok(
      Math.abs(actual[index] - expected[index]) <= tolerance,
      `${actual[index]} differed from ${expected[index]} at component ${index}`,
    );
  }
}

test("Bradford adaptation maps the D65 reference white to ICC D50", () => {
  close(adaptXyz(D65_WHITE, D65_WHITE, D50_WHITE), D50_WHITE, 1e-10);
});

test("built-in sRGB red matches the published D50 PCS reference vector", () => {
  // W3C CSS Color 4 conversion sample, within rounding differences in Bradford constants.
  close(multiplyMatrixVector(SRGB_PROFILE.matrixToPcs!, [1, 0, 0]), [0.4360657, 0.2224932, 0.0139239], 1.2e-5);
  close(multiplyMatrixVector(SRGB_PROFILE.matrixToPcs!, [1, 1, 1]), D50_WHITE, 2e-5);
});

test("matrix/TRC transforms round-trip across wide-gamut spaces", () => {
  const source = [0.82, 0.21, 0.47] as const;
  const toP3 = createColorTransform(SRGB_PROFILE, DISPLAY_P3_PROFILE);
  const toSrgb = createColorTransform(DISPLAY_P3_PROFILE, SRGB_PROFILE);
  close(toSrgb.applyRgb(toP3.applyRgb(source)), source, 2e-9);

  const toRec2020 = createColorTransform(SRGB_PROFILE, REC2020_PROFILE);
  const fromRec2020 = createColorTransform(REC2020_PROFILE, SRGB_PROFILE);
  close(fromRec2020.applyRgb(toRec2020.applyRgb(source)), source, 2e-9);
});

test("Luma working-space labels resolve to linear-light profiles", () => {
  assert.equal(profileForWorkingColorSpace("srgb"), LINEAR_SRGB_PROFILE);
  assert.equal(profileForWorkingColorSpace("linear-srgb"), LINEAR_SRGB_PROFILE);
  assert.equal(profileForWorkingColorSpace("display-p3"), LINEAR_DISPLAY_P3_PROFILE);
});

test("float RGBA conversion preserves alpha and round-trips extended-range channels", () => {
  const input = new Float32Array([
    -0.12, 0.4, 1.35, 0.125,
    2.1, -0.01, 0.3, 0.875,
  ]);
  const toLinear = createColorTransform(SRGB_PROFILE, LINEAR_SRGB_PROFILE);
  const toEncoded = createColorTransform(LINEAR_SRGB_PROFILE, SRGB_PROFILE);
  const linear = toLinear.applyRgbaBuffer(input);
  assert.equal(linear[3], input[3]);
  assert.equal(linear[7], input[7]);
  const roundTrip = toEncoded.applyRgbaBuffer(linear);
  close(roundTrip, input, 2e-6);
});

test("intent support is explicit rather than silently claiming ICC LUT behavior", () => {
  const perceptual = createColorTransform(SRGB_PROFILE, DISPLAY_P3_PROFILE, {
    renderingIntent: "perceptual",
    blackPointCompensation: true,
  });
  assert.equal(perceptual.metadata.requestedIntent, "perceptual");
  assert.equal(perceptual.metadata.effectiveIntent, "relative-colorimetric");
  assert.match(perceptual.metadata.intentFallback!, /do not contain perceptual gamut mapping/);
  assert.equal(SRGB_PROFILE.capabilities.renderingIntents.perceptual, "fallback-relative");

  const absolute = createColorTransform(SRGB_PROFILE, DISPLAY_P3_PROFILE, {
    renderingIntent: "absolute-colorimetric",
    blackPointCompensation: true,
  });
  assert.equal(absolute.metadata.effectiveIntent, "absolute-colorimetric");
  assert.equal(absolute.metadata.blackPointCompensation, "disabled");
});

test("proof transform identifies Display-P3 red as outside sRGB without changing source alpha", () => {
  const proof = createProofingTransform(DISPLAY_P3_PROFILE, SRGB_PROFILE, SRGB_PROFILE);
  const result = proof.applyRgba([1, 0, 0, 0.375]);
  assert.equal(result.outOfGamut, true);
  assert.ok(result.proofDeviceRgb.some((value) => value < 0 || value > 1));
  assert.ok(result.deltaE76 > 10);
  assert.equal(result.rgba[3], 0.375);

  const inGamut = proof.applyRgba([0.4, 0.4, 0.4, 0.5]);
  assert.equal(inGamut.outOfGamut, false);
  assert.ok(inGamut.deltaE76 < 1e-6);
});

test("transform cache and profile registry invalidate predictably", () => {
  const cache = new ColorTransformCache();
  const first = cache.get(SRGB_PROFILE, DISPLAY_P3_PROFILE);
  const second = cache.get(SRGB_PROFILE, DISPLAY_P3_PROFILE);
  assert.equal(first, second);
  assert.deepEqual(cache.stats, { size: 1, hits: 1, misses: 1 });

  const registry = new ColorProfileRegistry();
  assert.equal(registry.require("builtin:display-p3"), DISPLAY_P3_PROFILE);
  registry.createTransform("builtin:srgb", "builtin:display-p3");
  assert.equal(registry.transforms.stats.size, 1);
  registry.unregister("builtin:display-p3");
  assert.deepEqual(registry.transforms.stats, { size: 0, hits: 0, misses: 0 });
});

test("GPU compilation emits a matrix and paired 1D TRC tables", () => {
  const compiled = compileGpuColorTransform(SRGB_PROFILE, LINEAR_DISPLAY_P3_PROFILE, {}, 257);
  assert.equal(compiled.supported, true);
  if (!compiled.supported) return;
  assert.equal(compiled.sourceDecodeLut.length, 257 * 3);
  assert.equal(compiled.destinationEncodeLut.length, 257 * 3);
  assert.equal(compiled.sourceDecodeLut[0], 0);
  assert.equal(compiled.sourceDecodeLut[256 * 3], 1);
  assert.equal(compiled.metadata.alpha, "preserve-unmodified");
  assert.throws(
    () => compileGpuColorTransform(SRGB_PROFILE, LINEAR_SRGB_PROFILE, {}, 1),
    /LUT size/,
  );
});
