import test from "node:test";
import assert from "node:assert/strict";
import { qualificationHostRefusal, qualifiedHostSamples } from "../build/qualification-host.mjs";

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
