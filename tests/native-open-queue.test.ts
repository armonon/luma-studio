import assert from "node:assert/strict";
import test from "node:test";
import { NativeOpenQueue } from "../app/studio/native-open-queue";

const tick = () => new Promise(resolve => setImmediate(resolve));

test("native open events wait for recovery/save, serialize, deduplicate and resume in order", async () => {
  const seen: string[] = [];
  const releases: Array<() => void> = [];
  const queue = new NativeOpenQueue(async path => { seen.push(path); await new Promise<void>(resolve => releases.push(resolve)); }, error => assert.fail(String(error)));
  queue.enqueue("first"); queue.enqueue("second");
  assert.equal(queue.enqueue("first"), "duplicate");
  assert.deepEqual(seen, []);
  queue.setPaused(false);
  assert.deepEqual(seen, ["first"]);
  queue.setPaused(true);
  releases.shift()!(); await tick();
  assert.deepEqual(seen, ["first"]);
  queue.setPaused(false);
  assert.deepEqual(seen, ["first", "second"]);
  releases.shift()!(); await tick();
  queue.dispose();
});

test("a failed native open does not strand later files; queue has a strict capacity", async () => {
  const errors: unknown[] = [];
  const seen: string[] = [];
  const queue = new NativeOpenQueue(async path => { seen.push(path); if (path === "bad") throw Error("corrupt"); }, error => errors.push(error), 2);
  assert.equal(queue.enqueue("bad"), "queued");
  assert.equal(queue.enqueue("good"), "queued");
  assert.equal(queue.enqueue("overflow"), "full");
  queue.setPaused(false); await tick();
  assert.deepEqual(seen, ["bad", "good"]);
  assert.equal(errors.length, 1);
  queue.dispose();
});

test("unmount invalidates active reads and prevents queued document installation", async () => {
  let release!: () => void;
  const installed: string[] = [];
  const queue = new NativeOpenQueue(async (path, isActive) => {
    await new Promise<void>(resolve => { release = resolve; });
    if (isActive()) installed.push(path);
  }, error => assert.fail(String(error)));
  queue.enqueue("active"); queue.enqueue("pending"); queue.setPaused(false);
  queue.dispose(); release(); await tick();
  assert.deepEqual(installed, []);
  assert.equal(queue.enqueue("late"), "disposed");
});
