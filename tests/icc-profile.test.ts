import assert from "node:assert/strict";
import test from "node:test";
import {
  LINEAR_SRGB_PROFILE,
  SRGB_PROFILE,
  createColorTransform,
} from "../app/engine/color-management.ts";
import {
  IccProfileParseError,
  evaluateToneCurve,
  inferNativeWhitePoint,
  invertToneCurve,
  parseIccProfile,
} from "../app/engine/icc-profile.ts";
import { D65_WHITE } from "../app/engine/color-math.ts";
import { buildIcc, linearSrgbA2B1LutTag, matrixTrcIcc, setSignature, setU32 } from "./icc-fixture.ts";

test("parses ICC v4 RGB matrix/TRC tags and capability metadata", () => {
  const parsed = parseIccProfile(matrixTrcIcc());
  assert.equal(parsed.name, "Synthetic sRGB matrix profile");
  assert.equal(parsed.version, "4.3.0");
  assert.equal(parsed.deviceClass, "mntr");
  assert.equal(parsed.colorSpace, "RGB");
  assert.equal(parsed.defaultRenderingIntent, "relative-colorimetric");
  assert.equal(parsed.capabilities.model, "matrix-trc");
  assert.equal(parsed.capabilities.canTransform, true);
  assert.equal(parsed.tags.rTRC.type, "para");
  assert.ok(parsed.id.startsWith("icc:"));

  const trc = parsed.trc![0];
  assert.ok(Math.abs(evaluateToneCurve(trc, 0.04045) - 0.0031308) < 2e-6);
  assert.ok(Math.abs(invertToneCurve(trc, evaluateToneCurve(trc, 0.735)) - 0.735) < 1e-9);
  const nativeWhite = inferNativeWhitePoint(parsed);
  nativeWhite.forEach((value, index) => assert.ok(Math.abs(value - D65_WHITE[index]) < 5e-5));
});

test("parsed matrix profile produces the same transform as the built-in profile", () => {
  const parsed = parseIccProfile(matrixTrcIcc());
  const parsedToSrgb = createColorTransform(parsed, SRGB_PROFILE);
  const result = parsedToSrgb.applyRgba([0.18, 0.52, 0.91, 0.42]);
  [0.18, 0.52, 0.91].forEach((value, index) => assert.ok(Math.abs(result[index] - value) < 2e-4));
  assert.equal(result[3], 0.42);
});

test("recognizes LUT profiles but exposes an honest external-CMM fallback", () => {
  const lutPayload = new Uint8Array(8);
  setSignature(lutPayload, 0, "mft2");
  const profile = parseIccProfile(buildIcc([{ signature: "A2B0", bytes: lutPayload }]));
  assert.equal(profile.capabilities.model, "unsupported-lut");
  assert.equal(profile.capabilities.canTransform, false);
  assert.equal(profile.capabilities.fallback?.suggestedEngine, "LittleCMS/WASM");
  assert.match(profile.capabilities.fallback!.reason, /LUT or multi-process/);
  assert.throws(() => createColorTransform(profile, SRGB_PROFILE), /requires ICC LUT/);
});

test("decodes classic mft2 LUT profiles and uses their native intent table", () => {
  const profile = parseIccProfile(buildIcc([
    { signature: "A2B1", bytes: linearSrgbA2B1LutTag() },
  ]));
  assert.equal(profile.capabilities.model, "lut");
  assert.equal(profile.capabilities.canUseAsSource, true);
  assert.equal(profile.capabilities.canUseAsDestination, false);
  assert.equal(profile.capabilities.renderingIntents["relative-colorimetric"], "native");
  assert.equal(profile.lutToPcs["relative-colorimetric"]?.gridPoints, 2);

  const transform = createColorTransform(profile, LINEAR_SRGB_PROFILE, {
    renderingIntent: "relative-colorimetric",
  });
  const actual = transform.applyRgb([0.18, 0.52, 0.91]);
  [0.18, 0.52, 0.91].forEach((expected, index) => {
    assert.ok(Math.abs(actual[index] - expected) < 8e-5, `${index}: ${actual[index]} != ${expected}`);
  });
  assert.equal(transform.metadata.effectiveIntent, "relative-colorimetric");
  assert.equal(transform.metadata.extendedRange, "clamped");
});

test("rejects truncated profiles and contains malformed tag offsets", () => {
  assert.throws(() => parseIccProfile(new Uint8Array(64)), IccProfileParseError);
  const profile = matrixTrcIcc();
  // Corrupt the rXYZ table entry while leaving the rest of the profile readable.
  setU32(profile, 132 + 2 * 12 + 4, profile.length + 10);
  const parsed = parseIccProfile(profile);
  assert.equal(parsed.capabilities.canTransform, false);
  assert.ok(parsed.warnings.some((warning) => /out of bounds/.test(warning)));
});
