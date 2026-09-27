import { cpus, loadavg, platform, totalmem, freemem } from "node:os";
import { execFileSync } from "node:child_process";

// A campaign admission rule, not an application memory limit or a guarantee
// that a quiet host will stay quiet. Keep raw samples so results are auditable.
export const MAX_QUALIFICATION_LOAD_PER_CPU = 1.5;

/**
 * The campaign's own CPU draw, in cores.
 *
 * The rule this feeds exists to keep *competing* work out of timing evidence,
 * and the load average cannot tell competing work from the campaign measuring
 * itself. A corpus decoding 65 MB Photoshop files is genuinely busy: a run
 * would sample the load it had just produced and refuse to continue, so a
 * large corpus reliably blocked itself partway through and the gate it feeds
 * could not be satisfied on an otherwise idle machine.
 *
 * Summing the process group covers the per-case worker children, which
 * `process.cpuUsage()` does not see. Returns null when it cannot be measured,
 * and callers then fall back to the raw load — unmeasurable self-CPU must not
 * become a free pass.
 */
export function sampleSelfCpuCores() {
  try {
    // Our own pid is not our process-group id — the shell that started us
    // usually leads the group — so ask for the group rather than assuming it.
    const group = Number(execFileSync("ps", ["-o", "pgid=", "-p", String(process.pid)], { encoding: "utf8", timeout: 5000 }).trim());
    if (!Number.isFinite(group)) return null;
    const output = execFileSync("ps", ["-Ao", "pgid=,pcpu="], { encoding: "utf8", timeout: 5000 });
    let total = 0;
    let matched = false;
    for (const line of output.split("\n")) {
      const [pgid, pcpu] = line.trim().split(/\s+/);
      if (Number(pgid) !== group) continue;
      const percent = Number(pcpu);
      if (!Number.isFinite(percent) || percent < 0) return null;
      total += percent;
      matched = true;
    }
    // Our own process must appear; an empty match means the output was not what
    // we think it is, which is a measurement failure rather than zero CPU.
    return matched ? total / 100 : null;
  } catch {
    return null;
  }
}

export function sampleQualificationHost() {
  return {
    sampledAt: new Date().toISOString(), platform: platform(),
    logicalCpus: cpus().length, loadAverage: loadavg(),
    selfCpuCores: sampleSelfCpuCores(),
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
  // Discount the campaign's own draw so the rule measures competing work, which
  // is what distorts timing. A malformed or absent measurement discounts
  // nothing: the strict raw-load rule is the fail-closed default.
  // Clamp to the core count, not to the load: ps reports a decaying lifetime
  // average that can drift above the campaign's instantaneous draw, and a
  // discount capped only by the load would let one bad measurement absorb the
  // whole of it and admit any amount of competing work. No process group can
  // use more cores than the machine has.
  const self = typeof sample.selfCpuCores === "number" && Number.isFinite(sample.selfCpuCores) && sample.selfCpuCores >= 0
    ? Math.min(sample.selfCpuCores, sample.logicalCpus)
    : 0;
  const competing = Math.max(0, load - self);
  if (competing / sample.logicalCpus > MAX_QUALIFICATION_LOAD_PER_CPU) {
    return `Host is overloaded: competing load ${competing.toFixed(2)} of ${load.toFixed(2)} on ${sample.logicalCpus} logical CPUs exceeds ${MAX_QUALIFICATION_LOAD_PER_CPU} per CPU. Pause competing work and rerun; no processes were stopped.`;
  }
  return null;
}

export function qualifiedHostSamples(samples) {
  return Array.isArray(samples) && samples.length >= 2 && samples.every(sample => qualificationHostRefusal(sample) === null);
}
