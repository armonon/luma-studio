import test from "node:test";
import assert from "node:assert/strict";
import "./canvas-harness.ts";
import type { Psd, Layer } from "ag-psd";
import { readPsd, writePsd } from "../app/engine/ag-psd-io.ts";
import { BlnM } from "ag-psd/dist-es/descriptor.js";
import { importPsd, exportPhotoshopDocument } from "../app/engine/psd.ts";

const linear = { name: "Linear", curve: [{ x: 0, y: 0 }, { x: 255, y: 255 }] };

for (const psb of [false, true]) {
  test(`${psb ? "PSB" : "PSD"} shadow descriptors never synthesize an empty contour`, () => {
    const custom = { name: "Custom", curve: [{ x: 0, y: 0 }, { x: 120, y: 210 }, { x: 255, y: 255 }] };
    const child: Layer = { name: "Effects", effects: {
      dropShadow: [
        { enabled: false, opacity: .5, size: { units: "Pixels", value: 8 } },
        { enabled: true, contour: { name: "", curve: [] } },
        { enabled: true, contour: custom },
      ],
      solidFill: [{ enabled: true, color: { r: 20, g: 40, b: 60 }, opacity: 1 }],
    } };
    const input: Psd = { width: 4, height: 4, children: [{ name: "Group", children: [child] }] };
    const before = structuredClone(input);
    const output = readPsd(writePsd(input, { psb, noBackground: true }));
    const effects = output.children![0].children![0].effects!;
    assert.deepEqual(effects.dropShadow?.map(shadow => shadow.contour), [linear, linear, custom]);
    assert.equal(effects.dropShadow![0].enabled, false);
    assert.deepEqual(effects.solidFill![0].color, { r: 20, g: 40, b: 60 });
    assert.deepEqual(input, before, "export must not mutate document or retained descriptors");
  });
}

test("Photoshop short vivid-light enum preserves the entire modern effects block", () => {
  const encode = BlnM.encode;
  let bytes: ArrayBuffer;
  try {
    BlnM.encode = mode => mode === "vivid light" ? "BlnM.vLit" : encode(mode);
    bytes = writePsd({ width: 4, height: 4, children: [{ name: "Styled", effects: {
      solidFill: [{ enabled: true, blendMode: "vivid light", opacity: .6, color: { r: 1, g: 2, b: 3 } }],
      stroke: [{ enabled: true, size: { units: "Pixels", value: 7 }, position: "outside" }],
    } }] });
  } finally { BlnM.encode = encode; }
  const effects = readPsd(bytes).children![0].effects!;
  assert.equal(effects.solidFill![0].blendMode, "vivid light");
  assert.equal(effects.stroke![0].size!.value, 7, "modern-only stroke must not disappear into legacy fallback");
});

test("unreadable effects fail explicitly even when the codec permits missing features", () => {
  const encode = BlnM.encode;
  let bytes: ArrayBuffer;
  try {
    BlnM.encode = () => "BlnM.notARealMode";
    bytes = writePsd({ width: 4, height: 4, children: [{ effects: {
      solidFill: [{ enabled: true, blendMode: "normal", color: { r: 0, g: 0, b: 0 } }],
    } }] });
  } finally { BlnM.encode = encode; }
  assert.throws(() => readPsd(bytes, { throwForMissingFeatures: false }), /effects could not be read safely/);
  assert.doesNotThrow(() => readPsd(writePsd({ width: 4, height: 4 })), "failed read must not contaminate the next document");
});

test("effect contours and gradient stops cross codec units exactly when edited", async () => {
  const contour = { name: "Curve", curve: [{ x: 0, y: 0 }, { x: 51, y: 204 }, { x: 255, y: 255 }] };
  const source = writePsd({ width: 4, height: 4, children: [{ name: "Styled", imageData: {
    width: 4, height: 4, data: new Uint8ClampedArray(64).fill(255),
  }, effects: {
    dropShadow: [{ enabled: true, opacity: .5, contour }],
    gradientOverlay: [{ enabled: true, opacity: 1, gradient: {
      type: "solid", name: "Gradient", colorStops: [
        { color: { r: 255, g: 0, b: 0 }, location: 0, midpoint: .5 },
        { color: { r: 0, g: 255, b: 0 }, location: .25, midpoint: .5 },
        { color: { r: 0, g: 0, b: 255 }, location: 1, midpoint: .5 },
      ], opacityStops: [{ opacity: 1, location: 0, midpoint: .5 }, { opacity: 1, location: 1, midpoint: .5 }],
    } }],
  } }] }, { noBackground: true });
  const doc = await importPsd(source);
  const shadow = doc.layers[0].effects!.find(effect => effect.kind === "drop-shadow")!;
  assert.deepEqual(shadow.contour, [{ x: 0, y: 0 }, { x: .2, y: .8 }, { x: 1, y: 1 }]);
  assert.deepEqual(doc.layers[0].effects!.find(effect => effect.kind === "gradient-overlay")!.stops!.map(stop => stop.offset), [0, .25, 1]);
  shadow.opacity = .75; // Force semantic serialization, not descriptor passthrough.
  const effects = readPsd(exportPhotoshopDocument(doc).buffer).children![0].effects!;
  assert.deepEqual(effects.dropShadow![0].contour!.curve, contour.curve);
  const gradient = effects.gradientOverlay![0].gradient!;
  assert.equal(gradient.type, "solid");
  if (gradient.type === "solid") {
    assert.deepEqual(gradient.colorStops.map(stop => stop.location), [0, .25, 1]);
    assert.deepEqual(gradient.colorStops.map(stop => stop.midpoint), [.5, .5, .5]);
    assert.deepEqual(gradient.opacityStops.map(stop => stop.location), [0, 1]);
  }
});
