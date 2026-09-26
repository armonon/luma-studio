import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, unlinkSync, rmdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireQualificationLock } from "../build/qualification-lock.mjs";
import { completedCorpusEvidence } from "../build/corpus-evidence.mjs";
import { spawnSync } from "node:child_process";

test("heavy campaigns exclude each other and release only their own receipt", () => {
  const dir = mkdtempSync(join(tmpdir(), "luma-qualification-")), path = join(dir, "lock");
  try {
    const release = acquireQualificationLock("Corpus", path);
    assert.throws(() => acquireQualificationLock("Regression suite", path), /already running/);
    release(); release();
    assert.equal(existsSync(path), false);
    const second = acquireQualificationLock("Regression suite", path);
    const owner = JSON.parse(readFileSync(path, "utf8"));
    writeFileSync(path, JSON.stringify({ ...owner, token: "different-owner" }));
    second();
    assert.ok(existsSync(path), "must not unlink another owner's receipt");
  } finally { if (existsSync(path)) unlinkSync(path); rmdirSync(dir); }
});

test("malformed or stale locks fail closed instead of allowing overlapping runs", () => {
  const dir = mkdtempSync(join(tmpdir(), "luma-qualification-")), path = join(dir, "lock");
  try {
    writeFileSync(path, "invalid");
    assert.throws(() => acquireQualificationLock("Corpus", path), /unreadable/);
    writeFileSync(path, JSON.stringify({ pid: -1 }));
    assert.throws(() => acquireQualificationLock("Corpus", path), /invalid owner/);
    const exited = spawnSync(process.execPath, ["-e", ""], { timeout: 5000 });
    assert.equal(exited.status, 0);
    writeFileSync(path, JSON.stringify({ pid: exited.pid }));
    assert.throws(() => acquireQualificationLock("Corpus", path), /Stale qualification lock/);
  } finally { unlinkSync(path); rmdirSync(dir); }
});

test("release evidence rejects partial, interrupted, changed and inconsistent corpus runs", () => {
  const sample = { sampledAt: "2026-09-23T00:00:00Z", platform: "darwin", logicalCpus: 8, loadAverage: [1, 1, 1], totalMemoryBytes: 1024, freeMemoryBytes: 512 };
  const report = { completed: true, unchanged: true, interrupted: false, environmentQualified: true, hostSamples: [sample, sample], manifestSha256: "a".repeat(64), manifestUnchanged: true, total: 1, executed: 1, passed: 1, failed: 0, results: [{ id: "fixture", status: "pass", metrics: { inputSha256: "b".repeat(64) } }] };
  assert.equal(completedCorpusEvidence(report), true);
  for (const patch of [{ completed: false }, { unchanged: false }, { manifestUnchanged: false }, { manifestSha256: "missing" }, { interrupted: true }, { environmentQualified: false }, { hostSamples: [] }, { hostSamples: [sample, { ...sample, loadAverage: [100, 100, 100] }] }, { executed: 0 }, { passed: 2 }, { failed: 1 }, { results: [] }, { results: [{ id: "fixture", status: "pass" }] }]) {
    assert.equal(completedCorpusEvidence({ ...report, ...patch }), false);
  }
  assert.equal(completedCorpusEvidence({ ...report, total: 2, executed: 2, passed: 2, results: [...report.results, ...report.results] }), false);
});
