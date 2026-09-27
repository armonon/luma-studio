import test from "node:test";
import assert from "node:assert/strict";
import { qualificationHostRefusal, qualifiedHostSamples, sampleQualificationHost } from "../build/qualification-host.mjs";

const sample = { sampledAt: "2026-09-23T00:00:00Z", platform: "darwin", logicalCpus: 8, loadAverage: [1, 2, 3], totalMemoryBytes: 24 * 1024 ** 3, freeMemoryBytes: 1024 ** 3 };
test("timing qualification refuses overloaded, unsupported or malformed hosts", () => {
  assert.equal(qualificationHostRefusal(sample), null);
  assert.equal(qualificationHostRefusal({ ...sample, loadAverage: [12, 12, 100] }), null);
  for (const patch of [{ logicalCpus: 0 }, { platform: "win32" }, { sampledAt: "invalid" }, { loadAverage: [NaN, 1, 1] }, { loadAverage: [1, 2] }, { loadAverage: [13, 2, 3] }, { loadAverage: [1, 13, 3] }, { freeMemoryBytes: Infinity }]) {
    assert.equal(typeof qualificationHostRefusal({ ...sample, ...patch }), "string");
  }
  assert.equal(qualifiedHostSamples([sample]), false);
  assert.equal(qualifiedHostSamples([sample, sample]), true);
  assert.equal(qualifiedHostSamples([sample, { ...sample, loadAverage: [200, 200, 200] }]), false);
});

test("the load rule discounts the campaign's own draw and fails closed without it", () => {
  // The rule exists to keep competing work out of timing evidence, but the load
  // average cannot tell competing work from the campaign measuring itself. A
  // corpus decoding 65 MB Photoshop files is genuinely busy, so a run sampled
  // the load it had just produced and refused to continue: it got through seven
  // of eight real projects and then blocked on load 13.66 of its own making,
  // leaving the gate unsatisfiable on an idle machine.
  const busy = { ...sample, logicalCpus: 8, loadAverage: [13.6, 13.6, 13.6] };

  // Raw load is over the limit, but nearly all of it is ours.
  assert.equal(qualificationHostRefusal({ ...busy, selfCpuCores: 12.5 }), null);
  // Ours plus genuinely competing work is still refused, and the message says so.
  assert.match(
    String(qualificationHostRefusal({ ...busy, selfCpuCores: 1 })),
    /competing load 12\.60 of 13\.60/,
  );

  // Absent, malformed or negative self-CPU discounts nothing: an unmeasurable
  // campaign must not become a free pass. The original sample carries no
  // selfCpuCores at all, so the strict rule still applies to it.
  for (const patch of [{}, { selfCpuCores: null }, { selfCpuCores: NaN }, { selfCpuCores: -5 }, { selfCpuCores: "12" }]) {
    assert.equal(typeof qualificationHostRefusal({ ...busy, ...patch }), "string");
  }
  // A self measurement is clamped to the core count, so an over-reported one
  // cannot absorb the whole load and admit unlimited competing work.
  assert.equal(typeof qualificationHostRefusal({ ...busy, selfCpuCores: 99, loadAverage: [40, 40, 40] }), "string");
  assert.equal(qualificationHostRefusal({ ...busy, selfCpuCores: 99, loadAverage: [8, 8, 8] }), null, "all eight cores ours is still ours");
});

test("a real host sample reports its own CPU draw", () => {
  // Guards the measurement itself: process.cpuUsage() cannot see the per-case
  // worker children, so this sums the process group, and getting the group id
  // wrong (our pid is not our pgid) silently reported null and disabled the
  // discount entirely.
  const live = sampleQualificationHost();
  assert.ok(typeof live.selfCpuCores === "number" && live.selfCpuCores >= 0,
    `self CPU must be measurable on a supported host, got ${live.selfCpuCores}`);
});
