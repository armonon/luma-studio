import { cpus, loadavg, platform, totalmem, freemem } from "node:os";

// A campaign admission rule, not an application memory limit or a guarantee
// that a quiet host will stay quiet. Keep raw samples so results are auditable.
export const MAX_QUALIFICATION_LOAD_PER_CPU = 1.5;

export function sampleQualificationHost() {
  return {
    sampledAt: new Date().toISOString(), platform: platform(),
    logicalCpus: cpus().length, loadAverage: loadavg(),
    totalMemoryBytes: totalmem(), freeMemoryBytes: freemem(),
  };
}

export function qualificationHostRefusal(sample) {
  if (!sample || !["darwin", "linux"].includes(sample.platform) ||
      !Number.isSafeInteger(sample.logicalCpus) || sample.logicalCpus < 1 ||
      !Array.isArray(sample.loadAverage) || sample.loadAverage.length !== 3 ||
      sample.loadAverage.some(value => typeof value !== "number" || !Number.isFinite(value) || value < 0) ||
      !Number.isFinite(Date.parse(sample.sampledAt)) ||
      !Number.isSafeInteger(sample.totalMemoryBytes) || sample.totalMemoryBytes <= 0 ||
      !Number.isSafeInteger(sample.freeMemoryBytes) || sample.freeMemoryBytes < 0 || sample.freeMemoryBytes > sample.totalMemoryBytes) {
    return "Host load evidence is unavailable or malformed; timing qualification requires a supported host probe.";
  }
  // Both the short and medium averages must settle before timing resumes.
  const load = Math.max(sample.loadAverage[0], sample.loadAverage[1]);
  if (load / sample.logicalCpus > MAX_QUALIFICATION_LOAD_PER_CPU) {
    return `Host is overloaded: load ${load.toFixed(2)} on ${sample.logicalCpus} logical CPUs exceeds ${MAX_QUALIFICATION_LOAD_PER_CPU} per CPU. Pause competing work and rerun; no processes were stopped.`;
  }
  return null;
}

export function qualifiedHostSamples(samples) {
  return Array.isArray(samples) && samples.length >= 2 && samples.every(sample => qualificationHostRefusal(sample) === null);
}
