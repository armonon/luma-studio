/** Compare recorded GUI workflows only; this module does not generate measurements. */
export const BENCHMARK_STAGES = ["open", "move", "undo", "save", "reopen", "export"] as const;
export type WorkflowMeasurement = {
  schema: "luma/paired-gui-benchmark@1";
  app: { name: string; version: string };
  fixture: { sha256: string; category: "poster" | "illustration" | "composite" | "panorama" | "synthetic" };
  environment: { machineId: string; os: string; cpu: string; gpu: string; ramBytes: number; viewportWidth: number; viewportHeight: number; displayScale: number; powerMode: string; acceleration: string };
  measurement: "gui-full-workflow";
  warmups: number;
  samples: { milliseconds: Record<typeof BENCHMARK_STAGES[number], number>; peakRssBytes: number; visualFidelity: "pass"; editableStructure: "pass" }[];
  evidence: { path: string; sha256: string }[];
};
const finitePositive = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value > 0;
const hash = (value: unknown) => typeof value === "string" && /^[a-f\d]{64}$/i.test(value);
const nonempty = (value: unknown) => typeof value === "string" && value.trim().length > 0;

export function validateWorkflowMeasurement(value: WorkflowMeasurement) {
  if (!value || value.schema !== "luma/paired-gui-benchmark@1" || value.measurement !== "gui-full-workflow"
    || !nonempty(value.app?.name) || !nonempty(value.app?.version) || !hash(value.fixture?.sha256)
    || !["poster", "illustration", "composite", "panorama", "synthetic"].includes(value.fixture?.category)
    || !Number.isInteger(value.warmups) || value.warmups < 1 || !Array.isArray(value.samples) || value.samples.length < 5 || value.samples.length > 100) throw new Error("Benchmark requires an identified app, hashed fixture, GUI measurements, a warmup and 5–100 measured runs.");
  const environment = value.environment;
  if (!environment || ![environment.machineId, environment.os, environment.cpu, environment.gpu, environment.powerMode, environment.acceleration].every(nonempty)
    || ![environment.ramBytes, environment.viewportWidth, environment.viewportHeight, environment.displayScale].every(finitePositive)) throw new Error("Benchmark machine/display/power/acceleration context is incomplete.");
  for (const sample of value.samples) if (!sample || !sample.milliseconds || !BENCHMARK_STAGES.every(stage => finitePositive(sample.milliseconds[stage]))
    || !finitePositive(sample.peakRssBytes) || sample.visualFidelity !== "pass" || sample.editableStructure !== "pass") throw new Error("Every run must have complete timings, peak RAM and passing visual/structural fidelity; failures cannot count as speed wins.");
  if (!Array.isArray(value.evidence) || value.evidence.length < 1 || value.evidence.length > 100 || value.evidence.some(item => !item || !nonempty(item.path) || !hash(item.sha256))) throw new Error("Retain hashed measurement/fidelity artifacts, not just averages.");
}
const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b), half = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[half] : (sorted[half - 1] + sorted[half]) / 2; };

export function compareWorkflowMeasurements(luma: WorkflowMeasurement, affinity: WorkflowMeasurement) {
  validateWorkflowMeasurement(luma); validateWorkflowMeasurement(affinity);
  if (!/^luma studio$/i.test(luma.app.name) || !/^affinity\b/i.test(affinity.app.name)) throw new Error("Expected Luma Studio and an identified Affinity application.");
  if (luma.fixture.sha256 !== affinity.fixture.sha256 || luma.fixture.category !== affinity.fixture.category) throw new Error("Benchmark fixtures do not match.");
  for (const key of Object.keys(luma.environment) as (keyof WorkflowMeasurement["environment"])[]) {
    if (luma.environment[key] !== affinity.environment[key]) throw new Error(`Benchmark environments do not match: ${key}`);
  }
  if (luma.samples.length !== affinity.samples.length) throw new Error("Use matched run counts.");
  return {
    status: "recorded-samples-compared", scope: luma.fixture.category,
    notice: "Only supplied evidence is compared. This is not independent certification or an overall product superiority claim.",
    stages: Object.fromEntries(BENCHMARK_STAGES.map(stage => {
      const lumaMs = median(luma.samples.map(run => run.milliseconds[stage]));
      const affinityMs = median(affinity.samples.map(run => run.milliseconds[stage]));
      return [stage, { lumaMs, affinityMs, affinityOverLuma: affinityMs / lumaMs }];
    })),
    peakRssBytes: { luma: Math.max(...luma.samples.map(run => run.peakRssBytes)), affinity: Math.max(...affinity.samples.map(run => run.peakRssBytes)) },
  };
}
