import { BENCHMARK_STAGES, type WorkflowMeasurement } from "./affinity-evidence";
import { qualifiedHostSamples } from "./qualification-host.mjs";

export const EVIDENCE_ROLES = ["timing", "memory", "native-project", "reopened-project", "export", "fidelity"] as const;
type Role = typeof EVIDENCE_ROLES[number] | "fixture" | "protocol" | "reference";
export type MatchedWorkflow = {
  schema: "luma/matched-workflow@2";
  app: { name: string; version: string; buildSha256: string; sourceSha256?: string };
  fixture: WorkflowMeasurement["fixture"];
  protocolSha256: string;
  referenceSha256: string;
  environment: WorkflowMeasurement["environment"];
  measurement: "gui-full-workflow";
  warmups: number;
  plannedRuns: number;
  completed: boolean;
  samples: {
    id: string;
    outcome: "pass" | "fail";
    failure?: string;
    milliseconds?: Record<typeof BENCHMARK_STAGES[number], number>;
    peakRssBytes?: number;
    saveReopenCycles?: number;
    visualFidelity?: "pass" | "fail";
    editableStructure?: "pass" | "fail";
    hostSamples: { sampledAt: string; platform: string; logicalCpus: number; loadAverage: number[]; totalMemoryBytes: number; freeMemoryBytes: number }[];
  }[];
  evidence: { id: string; path: string; sha256: string; role: Role; runId?: string }[];
};
const positive = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;
const nonempty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f\d]{64}$/i.test(value);
const ENVIRONMENT_KEYS = ["machineId", "os", "cpu", "gpu", "ramBytes", "viewportWidth", "viewportHeight", "displayScale", "powerMode", "acceleration"] as const;
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

export function validateMatchedWorkflow(value: MatchedWorkflow) {
  if (!value || value.schema !== "luma/matched-workflow@2" || value.measurement !== "gui-full-workflow" ||
      !nonempty(value.app?.name) || !nonempty(value.app?.version) || !hash(value.app?.buildSha256) ||
      (/^luma studio$/i.test(value.app.name) && !hash(value.app.sourceSha256)) ||
      !hash(value.fixture?.sha256) || !hash(value.protocolSha256) || !hash(value.referenceSha256) ||
      !["poster", "illustration", "composite", "panorama", "synthetic"].includes(value.fixture?.category)) {
    throw new Error("Identify the GUI app/build, Luma source, fixture, independent reference and exact job protocol.");
  }
  const env = value.environment;
  if (!env || ![env.machineId, env.os, env.cpu, env.gpu, env.powerMode, env.acceleration].every(nonempty) ||
      ![env.ramBytes, env.viewportWidth, env.viewportHeight, env.displayScale].every(positive)) throw new Error("Incomplete machine/display environment.");
  if (!Number.isSafeInteger(value.warmups) || value.warmups < 1 || !Number.isSafeInteger(value.plannedRuns) || value.plannedRuns < 5 || value.plannedRuns > 100 ||
      typeof value.completed !== "boolean" || !Array.isArray(value.samples) || value.samples.length > value.plannedRuns ||
      (value.completed && value.samples.length !== value.plannedRuns)) throw new Error("Declare 5–100 planned runs, a warmup and honest completion state.");
  if (!Array.isArray(value.evidence) || value.evidence.length < 3 || value.evidence.length > 1000) throw new Error("Retained artifact evidence is required.");
  const ids = new Set<string>(), paths = new Set<string>(), runs = new Set<string>();
  for (const sample of value.samples) {
    if (!sample || !nonempty(sample.id) || runs.has(sample.id) || !["pass", "fail"].includes(sample.outcome) || !Array.isArray(sample.hostSamples) || sample.hostSamples.length > 10000) throw new Error("Invalid or duplicate measured run.");
    runs.add(sample.id);
    if (sample.outcome === "fail") {
      if (!nonempty(sample.failure)) throw new Error("Keep the reason for every failed run.");
    } else if (!sample.milliseconds || !BENCHMARK_STAGES.every(stage => positive(sample.milliseconds?.[stage])) || !positive(sample.peakRssBytes) ||
        !Number.isSafeInteger(sample.saveReopenCycles) || sample.saveReopenCycles! < 3 || sample.visualFidelity !== "pass" || sample.editableStructure !== "pass") {
      throw new Error("Passing runs need all stage timings, peak RSS, three save/reopen cycles and visual/structural fidelity.");
    }
  }
  for (const item of value.evidence) {
    if (!item || !nonempty(item.id) || ids.has(item.id) || !nonempty(item.path) || paths.has(item.path) || !hash(item.sha256) ||
        ![...EVIDENCE_ROLES, "fixture", "protocol", "reference"].includes(item.role) ||
        (EVIDENCE_ROLES.includes(item.role as typeof EVIDENCE_ROLES[number]) ? !runs.has(item.runId ?? "") : item.runId !== undefined)) throw new Error("Artifacts need unique IDs/paths, hashes, roles and valid run ownership.");
    ids.add(item.id); paths.add(item.path);
  }
  for (const [role, sha] of [["fixture", value.fixture.sha256], ["protocol", value.protocolSha256], ["reference", value.referenceSha256]]) {
    if (!value.evidence.some(item => item.role === role && item.sha256.toLowerCase() === sha.toLowerCase())) throw new Error(`Retain the hashed ${role} artifact.`);
  }
  for (const sample of value.samples) {
    const roles = new Set(value.evidence.filter(item => item.runId === sample.id).map(item => item.role));
    // Failed jobs may have no native/export output; retain at least their timing log.
    const required = sample.outcome === "pass" ? EVIDENCE_ROLES : ["timing"];
    if (!required.every(role => roles.has(role as Role))) throw new Error(`Missing run-specific artifacts for ${sample.id}.`);
  }
}

/** Evidence comparison only. No results are generated or inferred for an absent app. */
export function compareMatchedWorkflows(luma: MatchedWorkflow, competitor: MatchedWorkflow) {
  validateMatchedWorkflow(luma); validateMatchedWorkflow(competitor);
  if (!/^luma studio$/i.test(luma.app.name) || !/^(GIMP|Affinity(?: Designer| Photo| Publisher)?|Adobe Photoshop)$/i.test(competitor.app.name)) throw new Error("Expected Luma Studio and an identified supported competitor.");
  if (luma.fixture.sha256.toLowerCase() !== competitor.fixture.sha256.toLowerCase() || luma.fixture.category !== competitor.fixture.category ||
      luma.protocolSha256.toLowerCase() !== competitor.protocolSha256.toLowerCase() || luma.referenceSha256.toLowerCase() !== competitor.referenceSha256.toLowerCase()) throw new Error("Fixture, job protocol and independent reference must match.");
  if (ENVIRONMENT_KEYS.some(key => luma.environment[key] !== competitor.environment[key])) throw new Error("Benchmark environments do not match.");
  if (luma.plannedRuns !== competitor.plannedRuns || luma.warmups !== competitor.warmups) throw new Error("Use matched planned runs and warmups.");
  const blockers: string[] = [];
  for (const record of [luma, competitor]) {
    if (!record.completed) blockers.push(`${record.app.name}: incomplete campaign`);
    for (const sample of record.samples) {
      if (sample.outcome === "fail") blockers.push(`${record.app.name}/${sample.id}: ${sample.failure}`);
      if (!qualifiedHostSamples(sample.hostSamples)) blockers.push(`${record.app.name}/${sample.id}: missing or overloaded host evidence`);
    }
  }
  const base = {
    scope: luma.fixture.category, competitor: competitor.app.name, blockers,
    notice: "Recorded GUI evidence only. Hashes do not authenticate measurements or certify product superiority. Independent artifact review remains required.",
  };
  if (blockers.length) return { ...base, status: "not-qualified" as const };
  return {
    ...base, status: "recorded-samples-compared" as const,
    stages: Object.fromEntries(BENCHMARK_STAGES.map(stage => {
      const a = luma.samples.map(sample => sample.milliseconds![stage]), b = competitor.samples.map(sample => sample.milliseconds![stage]);
      return [stage, { lumaMedianMs: median(a), competitorMedianMs: median(b), lumaMaxMs: Math.max(...a), competitorMaxMs: Math.max(...b), competitorOverLuma: median(b) / median(a) }];
    })),
    peakRssBytes: { luma: Math.max(...luma.samples.map(sample => sample.peakRssBytes!)), competitor: Math.max(...competitor.samples.map(sample => sample.peakRssBytes!)) },
  };
}
