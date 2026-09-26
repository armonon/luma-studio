import assert from "node:assert/strict";
import test from "node:test";
import { selectionMetrics, selectionEvidenceGate, evaluateSelectionPair } from "../build/selection-accuracy.ts";

const mask = (values: number[]) => ({ width: values.length, height: 1, alpha: Uint8Array.from(values) });
test("accuracy metrics distinguish exact, empty, wrong and soft-edge masks", () => {
  assert.equal(selectionMetrics(mask([0, 255, 128]), mask([0, 255, 128])).iou, 1);
  assert.equal(selectionMetrics(mask([0]), mask([0])).boundaryF1, 1);
  const wrong = selectionMetrics(mask([255, 0]), mask([0, 255]), 0);
  assert.equal(wrong.iou, 0); assert.equal(wrong.boundaryF1, 0); assert.equal(wrong.alphaMAE, 1);
  const binary = selectionMetrics(mask([255]), mask([128]));
  assert.equal(binary.iou, 1); assert.ok(binary.softEdgeMAE! > 0.49);
  assert.equal(selectionMetrics(mask([0]), mask([255])).boundaryF1, 0);
});
test("dimension mismatch and unbounded boundary work are rejected", () => {
  assert.throws(() => selectionMetrics(mask([0]), mask([0, 0])));
  assert.throws(() => selectionMetrics(mask([0]), mask([0]), 900));
});
test("empty, synthetic, duplicated and Photoshop-only evidence cannot establish accuracy parity", () => {
  assert.equal(selectionEvidenceGate([]).qualified, false);
  const evidence = Array.from({ length: 60 }, (_, i) => ({ id: String(i), imageHash: "a".repeat(64), category: "objects", real: true, groundTruth: false, photoshop: true, protocol: "same image", passed: true }));
  assert.equal(selectionEvidenceGate(evidence).pairedRealCases, 0);
  assert.equal(selectionEvidenceGate(evidence.map(c => ({ ...c, groundTruth: true }))).pairedRealCases, 1);
  assert.equal(selectionEvidenceGate(evidence.map(c => ({ ...c, groundTruth: true, real: false }))).qualified, false);
});

test("paired acceptance checks independent ground truth, not just application agreement", () => {
  assert.equal(evaluateSelectionPair(mask([0, 255, 128]), mask([0, 255, 128]), mask([0, 255, 128])).passed, true);
  assert.equal(evaluateSelectionPair(mask([0, 0, 0]), mask([0, 0, 0]), mask([0, 255, 128])).passed, false);
  assert.equal(evaluateSelectionPair(mask([0]), mask([0]), mask([0])).passed, false);
  assert.equal(evaluateSelectionPair(mask([0, 255, 255]), mask([0, 255, 128]), mask([0, 255, 128])).passed, false);
});
