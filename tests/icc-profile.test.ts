import assert from "node:assert/strict";
import test from "node:test";
import {
  LINEAR_SRGB_PROFILE,
  SRGB_PROFILE,
  createColorTransform,
} from "../app/engine/color-management.ts";
import {
  IccProfileParseError,
  evaluateIccLut,
  evaluateToneCurve,
  inferNativeWhitePoint,
  invertToneCurve,
  parseIccProfile,
} from "../app/engine/icc-profile.ts";
import { D65_WHITE } from "../app/engine/color-math.ts";
import {
  buildIcc,
  identityClutMabTag,
  linearSrgbA2B1LutTag,
  linearSrgbMultiFunctionTag,
  matrixTrcIcc,
  orderedClassicB2ALutTag,
  setS15Fixed16,
  setSignature,
  setU32,
} from "./icc-fixture.ts";

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
  assert.throws(() => createColorTransform(profile, SRGB_PROFILE), /requires an ICC LUT/);
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

test("decodes ICC v4 mAB and mBA matrix-equivalent transforms", () => {
  const profile = parseIccProfile(buildIcc([
    { signature: "A2B1", bytes: linearSrgbMultiFunctionTag("mAB") },
    { signature: "B2A1", bytes: linearSrgbMultiFunctionTag("mBA") },
  ]));
  assert.equal(profile.capabilities.model, "lut");
  assert.equal(profile.capabilities.canUseAsSource, true);
  assert.equal(profile.capabilities.canUseAsDestination, true);
  assert.equal(profile.lutToPcs["relative-colorimetric"]?.type, "mAB");
  assert.equal(profile.lutFromPcs["relative-colorimetric"]?.type, "mBA");

  const sample = [0.18, 0.52, 0.91] as const;
  const toWorking = createColorTransform(profile, LINEAR_SRGB_PROFILE, {
    renderingIntent: "relative-colorimetric",
  });
  const fromWorking = createColorTransform(LINEAR_SRGB_PROFILE, profile, {
    renderingIntent: "relative-colorimetric",
  });
  sample.forEach((expected, index) => {
    assert.ok(Math.abs(toWorking.applyRgb(sample)[index] - expected) < 1.2e-4);
    assert.ok(Math.abs(fromWorking.applyRgb(sample)[index] - expected) < 1.2e-4);
  });
});

test("evaluates the permitted A-CLUT-B mAB processing model", () => {
  const profile = parseIccProfile(buildIcc([
    { signature: "A2B1", bytes: identityClutMabTag() },
  ]));
  const lut = profile.lutToPcs["relative-colorimetric"]!;
  assert.equal(lut.type, "mAB");
  const actual = evaluateIccLut(lut, [0.19, 0.53, 0.87]);
  [0.19, 0.53, 0.87].forEach((expected, index) => {
    assert.ok(Math.abs(actual[index] - expected) < 1e-12);
  });
});

test("mAB 3×4 matrix applies its three offset terms", () => {
  const tag = linearSrgbMultiFunctionTag("mAB");
  const matrixOffset = 32 + 3 * 12;
  [0.1, 0.2, 0.3].forEach((value, index) => {
    setS15Fixed16(tag, matrixOffset + (9 + index) * 4, value);
  });
  const profile = parseIccProfile(buildIcc([{ signature: "A2B1", bytes: tag }]));
  const result = evaluateIccLut(profile.lutToPcs["relative-colorimetric"]!, [0, 0, 0]);
  [0.1, 0.2, 0.3].forEach((expected, index) => {
    assert.ok(Math.abs(result[index] - expected) < 8e-6);
  });
});

test("classic LUT applies its matrix before nonlinear input tables", () => {
  const profile = parseIccProfile(buildIcc([
    { signature: "B2A1", bytes: orderedClassicB2ALutTag() },
  ]));
  const lut = profile.lutFromPcs["relative-colorimetric"]!;
  const result = evaluateIccLut(lut, [1, 0.4, 0.6]);
  assert.ok(Math.abs(result[0] - 0.25) < 2e-5);
  assert.ok(Math.abs(result[1] - 0.4) < 2e-5);
  assert.ok(Math.abs(result[2] - 0.6) < 2e-5);
});

test("device-link profiles are never misclassified as PCS profiles", () => {
  const profile = parseIccProfile(buildIcc([
    { signature: "A2B1", bytes: linearSrgbMultiFunctionTag("mAB") },
  ], { deviceClass: "link" }));
  assert.equal(profile.deviceClass, "link");
  assert.equal(profile.capabilities.canTransform, false);
  assert.equal(profile.capabilities.fallback?.suggestedEngine, "LittleCMS/WASM");
  assert.match(profile.capabilities.fallback!.reason, /Device-link profiles transform directly/);
  assert.ok(profile.warnings.some((warning) => /cannot be treated as PCS/.test(warning)));
});

test("float DToB multi-process tags remain explicit external-engine fallbacks", () => {
  const mpet = new Uint8Array(16);
  setSignature(mpet, 0, "mpet");
  const profile = parseIccProfile(buildIcc([
    { signature: "D2B3", bytes: mpet },
  ]));
  assert.equal(profile.capabilities.model, "unsupported-lut");
  assert.equal(profile.capabilities.canTransform, false);
  assert.equal(profile.capabilities.fallback?.suggestedEngine, "LittleCMS/WASM");
  assert.ok(profile.warnings.some((warning) => /Float DToB\/BToD/.test(warning)));
});

test("malformed mAB element combinations never become executable", () => {
  const missingB = identityClutMabTag();
  setU32(missingB, 12, 0);
  const profile = parseIccProfile(buildIcc([
    { signature: "A2B1", bytes: missingB },
  ]));
  assert.equal(profile.capabilities.canTransform, false);
  assert.ok(profile.warnings.some((warning) => /required B curve set/.test(warning)));
});

test("rejects multi-function LUT types assigned to the wrong transform direction", () => {
  const profile = parseIccProfile(buildIcc([
    { signature: "A2B1", bytes: linearSrgbMultiFunctionTag("mBA") },
  ]));
  assert.equal(profile.capabilities.canTransform, false);
  assert.ok(profile.warnings.some((warning) => /A2B requires mAB/.test(warning)));
});

test("intent metadata reports a mixed transform when only one profile has a native table", () => {
  const source = parseIccProfile(buildIcc([
    { signature: "A2B0", bytes: linearSrgbMultiFunctionTag("mAB") },
  ]));
  const transform = createColorTransform(source, LINEAR_SRGB_PROFILE, {
    renderingIntent: "perceptual",
  });
  assert.equal(transform.metadata.effectiveIntent, "mixed");
  assert.match(transform.metadata.intentFallback!, /destination profile lacked native perceptual tables/);
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
