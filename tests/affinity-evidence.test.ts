import test from "node:test";
import assert from "node:assert/strict";
import { compareWorkflowMeasurements, type WorkflowMeasurement } from "../build/affinity-evidence.ts";
// Synthetic measurements exercise validation only; never published as performance evidence.
const record = (name: string): WorkflowMeasurement => ({
  schema: "luma/paired-gui-benchmark@1", app: { name, version: "test-only" }, fixture: { sha256: "a".repeat(64), category: "synthetic" },
  environment: { machineId: "test", os: "test", cpu: "test", gpu: "test", ramBytes: 1024, viewportWidth: 1280, viewportHeight: 800, displayScale: 1, powerMode: "AC", acceleration: "GPU" },
  measurement: "gui-full-workflow", warmups: 1,
  samples: Array.from({ length: 5 }, () => ({ milliseconds: { open: 100, move: 10, undo: 10, save: 100, reopen: 100, export: 100 }, peakRssBytes: 100, visualFidelity: "pass", editableStructure: "pass" })),
  evidence: [{ path: "test-only.png", sha256: "b".repeat(64) }],
});
test("matched evidence rejects mismatched contexts, missing runs and fidelity failures", () => {
  const luma = record("Luma Studio"), affinity = record("Affinity Designer");
  assert.equal(compareWorkflowMeasurements(luma, affinity).stages.open.affinityOverLuma, 1);
  affinity.environment.viewportWidth = 1440; assert.throws(() => compareWorkflowMeasurements(luma, affinity), /environments/); affinity.environment.viewportWidth = 1280;
  affinity.samples.pop(); assert.throws(() => compareWorkflowMeasurements(luma, affinity), /measured runs/);
  const failed = record("Affinity Designer"); failed.samples[0].visualFidelity = "fail" as "pass";
  assert.throws(() => compareWorkflowMeasurements(luma, failed), /fidelity/);
  const engine = record("Affinity Designer"); engine.measurement = "engine-only" as "gui-full-workflow";
  assert.throws(() => compareWorkflowMeasurements(luma, engine), /GUI/);
  const wrong = record("Affinity Designer"); wrong.fixture.sha256 = "c".repeat(64);
  assert.throws(() => compareWorkflowMeasurements(luma, wrong), /fixtures/);
});
