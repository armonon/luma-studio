import assert from "node:assert/strict";
import test from "node:test";
import "./canvas-harness.ts";
import { Studio } from "../app/engine/studio.ts";
import { createDocument, createProAdjustmentLayer, createRasterLayer } from "../app/engine/document.ts";
import {
  PRO_ADJUSTMENT_KINDS,
  applyProAdjustmentToImageData,
  cloneProAdjustment,
  defaultProAdjustment,
} from "../app/engine/pro-adjustments.ts";
import type { ProAdjustmentParams } from "../app/engine/pro-adjustments.ts";
import { renderClean } from "../app/engine/renderer.ts";
import { glCanRenderDocument } from "../app/engine/gl-renderer.ts";
import { pixelAt, solidCanvas, testCanvas } from "./canvas-harness.ts";

function image(r: number, g: number, b: number, a = 255) {
  return new ImageData(new Uint8ClampedArray([r, g, b, a]), 1, 1);
}

test("professional adjustment catalogue has usable defaults and deep clones", () => {
  assert.equal(PRO_ADJUSTMENT_KINDS.length, 10);
  for (const kind of PRO_ADJUSTMENT_KINDS) assert.equal(defaultProAdjustment(kind).kind, kind);
  const balance = defaultProAdjustment("color-balance");
  assert.equal(balance.kind, "color-balance");
  const clone = cloneProAdjustment(balance);
  assert.notEqual(clone, balance);
  assert.notEqual(clone.kind === "color-balance" && clone.midtones, balance.midtones);
});

test("relight field is spatial, directional, warm, and leaves distant pixels intact", () => {
  const input = new ImageData(new Uint8ClampedArray(3 * 3 * 4).fill(0), 3, 3);
  for (let offset = 0; offset < input.data.length; offset += 4) input.data.set([80, 80, 80, 177], offset);
  const output = applyProAdjustmentToImageData(input, {
    kind: "relight-field", centerX: 0.5, centerY: 0.5, radius: 0.34,
    intensity: 1, angle: 0, temperature: 0.8, falloff: 1,
  }, { originX: 0, originY: 0, scaleX: 1, scaleY: 1, documentWidth: 3, documentHeight: 3 });
  const center = (1 * 3 + 1) * 4;
  assert.ok(output.data[center] > 80);
  assert.ok(output.data[center] > output.data[center + 2]);
  assert.equal(output.data[0], 80);
  assert.equal(output.data[center + 3], 177);
});

test("black and white, threshold, posterize and invert preserve alpha", () => {
  const monochrome = applyProAdjustmentToImageData(image(230, 40, 20, 91), defaultProAdjustment("black-white"));
  assert.equal(monochrome.data[0], monochrome.data[1]);
  assert.equal(monochrome.data[1], monochrome.data[2]);
  assert.equal(monochrome.data[3], 91);

  const threshold = applyProAdjustmentToImageData(image(30, 30, 30, 92), { kind: "threshold", level: 0.5 });
  assert.deepEqual([...threshold.data], [0, 0, 0, 92]);
  const inverted = applyProAdjustmentToImageData(image(10, 20, 30, 93), { kind: "invert" });
  assert.deepEqual([...inverted.data], [245, 235, 225, 93]);
  const posterized = applyProAdjustmentToImageData(image(120, 180, 240, 94), { kind: "posterize", levels: 2 });
  assert.deepEqual([...posterized.data], [0, 255, 255, 94]);
});

test("color balance, photo filter, channel mixer, lookup and gradient map alter the intended channels", () => {
  const balance = applyProAdjustmentToImageData(image(100, 100, 100), {
    kind: "color-balance", shadows: [0, 0, 0], midtones: [0.25, 0, 0], highlights: [0, 0, 0], preserveLuminosity: false,
  });
  assert.ok(balance.data[0] > balance.data[1]);

  const warm = applyProAdjustmentToImageData(image(120, 120, 120), {
    kind: "photo-filter", color: "#ff8000", density: 0.7, preserveLuminosity: false,
  });
  assert.ok(warm.data[0] > warm.data[2]);

  const mixed = applyProAdjustmentToImageData(image(200, 50, 10), {
    kind: "channel-mixer", matrix: [0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0],
  });
  assert.deepEqual([...mixed.data], [50, 200, 10, 255]);

  const lookup = applyProAdjustmentToImageData(image(190, 100, 40), { kind: "color-lookup", preset: "teal-orange", intensity: 1 });
  assert.notDeepEqual([...lookup.data], [190, 100, 40, 255]);

  const mapped = applyProAdjustmentToImageData(image(128, 128, 128), {
    kind: "gradient-map", shadow: "#000000", highlight: "#ff0000", reverse: false, smoothness: 1,
  });
  assert.ok(mapped.data[0] > 100);
  assert.equal(mapped.data[1], 0);
  assert.equal(mapped.data[2], 0);
});

test("professional adjustments render as real masked layers and use an honest GPU fallback", () => {
  const doc = createDocument(8, 8);
  doc.layers = [
    createProAdjustmentLayer("Invert", { kind: "invert" }),
    createRasterLayer("base", solidCanvas(8, 8, "rgb(10,20,30)")),
  ];
  const target = testCanvas(8, 8);
  renderClean(doc, target);
  assert.deepEqual(pixelAt(target, 4, 4), { r: 245, g: 235, b: 225, a: 255 });
  assert.equal(glCanRenderDocument(doc), false);
});

test("live professional adjustment edits collapse into one undo operation", () => {
  const studio = new Studio(8, 8, testCanvas(8, 8));
  const layer = studio.addProAdjustmentLayer("threshold");
  studio.liveUpdateProAdjustment(layer.id, { kind: "threshold", level: 0.2 });
  studio.liveUpdateProAdjustment(layer.id, { kind: "threshold", level: 0.7 });
  studio.updateProAdjustment(layer.id, { kind: "threshold", level: 0.8 });
  assert.equal(layer.proAdjustment?.kind === "threshold" && layer.proAdjustment.level, 0.8);
  studio.undo();
  assert.equal(layer.proAdjustment?.kind === "threshold" && layer.proAdjustment.level, 0.5);
  studio.dispose();
});

test("a params object that is not an adjustment is refused rather than stored", () => {
  // The Pro adjustment panel hands `commit` straight to DOM handlers
  // (onPointerUp/onBlur/onKeyUp), which React invokes with a SyntheticEvent.
  // A defaulted parameter never sees its default in that position, so the event
  // itself used to reach cloneProAdjustment, whose `default` arm spread it into
  // the layer: the panel then lost every control (no `kind` matches) and the
  // adjustment silently stopped affecting the composite.
  const syntheticEventShaped = { type: "pointerup", target: {}, nativeEvent: {} };
  assert.throws(
    () => cloneProAdjustment(syntheticEventShaped as unknown as ProAdjustmentParams),
    /Not a professional adjustment/,
  );
  assert.throws(() => cloneProAdjustment(undefined as unknown as ProAdjustmentParams), /Not a professional adjustment/);

  // Every real kind still clones, and deeply.
  for (const kind of PRO_ADJUSTMENT_KINDS) {
    const clone = cloneProAdjustment(defaultProAdjustment(kind));
    assert.equal(clone.kind, kind);
  }
});
