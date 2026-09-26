import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { compareMatchedWorkflows, validateMatchedWorkflow, EVIDENCE_ROLES, type MatchedWorkflow } from "../build/matched-workflow-evidence";
import { loadMatchedEvidence } from "../build/load-matched-evidence";

// Artificial numbers for validator tests ONLY; these are not app measurements.
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
function record(name = "Luma Studio"): MatchedWorkflow {
  const host = { sampledAt: "2026-09-23T00:00:00Z", platform: "darwin", logicalCpus: 8, loadAverage: [1, 1, 1], totalMemoryBytes: 1024, freeMemoryBytes: 512 };
  const samples = Array.from({ length: 5 }, (_, i) => ({
    id: `run-${i}`, outcome: "pass" as const, milliseconds: { open: 100, move: 10, undo: 10, save: 100, reopen: 100, export: 100 },
    peakRssBytes: 100, saveReopenCycles: 3, visualFidelity: "pass" as const, editableStructure: "pass" as const, hostSamples: [host, { ...host, sampledAt: "2026-09-23T00:00:01Z" }],
  }));
  return {
    schema: "luma/matched-workflow@2", app: { name, version: "test-only", buildSha256: hash("build"), sourceSha256: hash("source") },
    fixture: { sha256: hash("fixture"), category: "synthetic" }, protocolSha256: hash("protocol"), referenceSha256: hash("reference"),
    environment: { machineId: "test", os: "test", cpu: "test", gpu: "test", ramBytes: 1024, viewportWidth: 1280, viewportHeight: 800, displayScale: 1, powerMode: "AC", acceleration: "default" },
    measurement: "gui-full-workflow", warmups: 1, plannedRuns: 5, completed: true, samples,
    evidence: [
      ...(["fixture", "protocol", "reference"] as const).map(role => ({ id: role, path: `${role}.txt`, sha256: hash(role), role })),
      ...samples.flatMap(sample => EVIDENCE_ROLES.map(role => ({ id: `${sample.id}-${role}`, path: `${sample.id}-${role}.txt`, sha256: hash(`${sample.id}-${role}`), role, runId: sample.id }))),
    ],
  };
}

test("matched GUI evidence supports GIMP without claiming an overall winner", () => {
  for (const name of ["GIMP", "Affinity Designer", "Adobe Photoshop"]) {
    const result = compareMatchedWorkflows(record(), record(name));
    assert.equal(result.status, "recorded-samples-compared");
    assert.equal(result.competitor, name);
    if (result.status === "recorded-samples-compared") assert.equal(result.stages.open.competitorOverLuma, 1);
  }
});

test("missing builds, mismatched jobs, incomplete artifacts and incomplete round trips cannot qualify", () => {
  for (const mutate of [
    (r: MatchedWorkflow) => { delete r.app.sourceSha256; },
    (r: MatchedWorkflow) => { r.samples[0].saveReopenCycles = 1; },
    (r: MatchedWorkflow) => { r.samples[0].visualFidelity = "fail"; },
    (r: MatchedWorkflow) => { r.evidence.pop(); },
    (r: MatchedWorkflow) => { r.evidence[4].runId = "absent"; },
    (r: MatchedWorkflow) => { r.evidence[4].path = r.evidence[3].path; },
    (r: MatchedWorkflow) => { r.samples[1].id = r.samples[0].id; },
    (r: MatchedWorkflow) => { r.samples[0].milliseconds!.open = Infinity; },
  ]) { const r = record(); mutate(r); assert.throws(() => validateMatchedWorkflow(r)); }
  for (const mutate of [
    (r: MatchedWorkflow) => { r.environment.viewportWidth = 1440; },
    (r: MatchedWorkflow) => { r.warmups = 2; },
    (r: MatchedWorkflow) => { r.protocolSha256 = hash("other"); r.evidence[1].sha256 = r.protocolSha256; },
  ]) { const r = record("GIMP"); mutate(r); assert.throws(() => compareMatchedWorkflows(record(), r)); }
});

test("failed, interrupted or overloaded jobs retain failures and emit no speed ratios", () => {
  const failed = record("GIMP");
  failed.samples[0].outcome = "fail"; failed.samples[0].failure = "Reopen lost editability";
  delete failed.samples[0].milliseconds;
  failed.evidence = failed.evidence.filter(e => e.runId !== "run-0" || e.role === "timing");
  const result = compareMatchedWorkflows(record(), failed);
  assert.equal(result.status, "not-qualified");
  assert.ok(result.blockers.some(message => message.includes("lost editability")));
  assert.equal("stages" in result, false);
  const incomplete = record("GIMP"); incomplete.completed = false;
  assert.equal(compareMatchedWorkflows(record(), incomplete).status, "not-qualified");
  const overloaded = record("GIMP"); overloaded.samples[0].hostSamples[1].loadAverage = [200, 200, 200];
  assert.equal(compareMatchedWorkflows(record(), overloaded).status, "not-qualified");
});

test("artifact ingestion verifies actual hashes and rejects escaping symlinks", async () => {
  const dir = await mkdtemp(join(tmpdir(), "luma-matched-evidence-"));
  const outside = await mkdtemp(join(tmpdir(), "luma-matched-outside-"));
  try {
    const r = record(), manifest = join(dir, "record.json");
    for (const item of r.evidence) await writeFile(join(dir, item.path), item.id);
    await writeFile(manifest, JSON.stringify(r));
    assert.equal((await loadMatchedEvidence(manifest)).samples.length, 5);
    await writeFile(join(dir, "fixture.txt"), "modified");
    await assert.rejects(loadMatchedEvidence(manifest), /hash mismatched/);
    await writeFile(join(outside, "fixture.txt"), "fixture");
    await symlink(join(outside, "fixture.txt"), join(dir, "escape.txt"));
    r.evidence[0].path = "escape.txt";
    await writeFile(manifest, JSON.stringify(r));
    await assert.rejects(loadMatchedEvidence(manifest), /symlink escapes/);
    r.evidence[0].path = "../escape.txt";
    await writeFile(manifest, JSON.stringify(r));
    await assert.rejects(loadMatchedEvidence(manifest), /inside the manifest/);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
