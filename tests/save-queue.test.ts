import assert from "node:assert/strict";
import test from "node:test";
import { CoalescedSaveQueue, recoveryCheckpointDelayMs } from "../app/engine/save-queue.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

test("superseded encodes are skipped before recovery commit", async () => {
  const first = deferred<string>();
  const second = deferred<string>();
  const produced: number[] = [];
  const committed: Array<[string, number]> = [];
  const queue = new CoalescedSaveQueue<string>({
    produce: async (revision) => {
      produced.push(revision);
      return revision === 1 ? first.promise : second.promise;
    },
    commit: async (value, revision) => { committed.push([value, revision]); },
  });

  queue.request();
  await Promise.resolve();
  queue.request();
  first.resolve("stale");
  await Promise.resolve();
  await Promise.resolve();
  second.resolve("latest");
  await queue.waitForIdle();

  assert.deepEqual(produced, [1, 2]);
  assert.deepEqual(committed, [["latest", 2]]);
});

test("a request arriving during commit is written afterward", async () => {
  const firstCommit = deferred<void>();
  const commits: number[] = [];
  const queue = new CoalescedSaveQueue<number>({
    produce: async (revision) => revision,
    commit: async (_value, revision) => {
      commits.push(revision);
      if (revision === 1) await firstCommit.promise;
    },
  });

  queue.request();
  await Promise.resolve();
  await Promise.resolve();
  queue.request();
  firstCommit.resolve();
  await queue.waitForIdle();
  assert.deepEqual(commits, [1, 2]);
});

test("errors settle the failed revision and a later request retries", async () => {
  const states: string[] = [];
  let attempts = 0;
  const queue = new CoalescedSaveQueue<number>({
    produce: async (revision) => revision,
    commit: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("disk full");
    },
    onState: (state) => states.push(state),
  });

  queue.request();
  await queue.waitForIdle();
  assert.equal(states.at(-1), "error");
  queue.request();
  await queue.waitForIdle();
  assert.equal(attempts, 2);
  assert.ok(states.includes("error"));
  assert.equal(states.at(-1), "idle");
});

test("large and layer-heavy documents avoid continuous recovery recompression", () => {
  assert.equal(recoveryCheckpointDelayMs({ documentPixels: 24_000_000, estimatedResidentBytes: 0, layers: 20 }), 1_600);
  assert.equal(recoveryCheckpointDelayMs({ documentPixels: 100_000_000, estimatedResidentBytes: 0, layers: 20 }), 4_000);
  assert.equal(recoveryCheckpointDelayMs({ documentPixels: 400_000_000, estimatedResidentBytes: 0, layers: 20 }), 8_000);
  assert.equal(recoveryCheckpointDelayMs({ documentPixels: 1, estimatedResidentBytes: 384 * 1024 * 1024, layers: 20 }), 4_000);
  assert.equal(recoveryCheckpointDelayMs({ documentPixels: 1, estimatedResidentBytes: 0, layers: 2_000 }), 8_000);
});
