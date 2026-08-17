import assert from "node:assert/strict";
import test from "node:test";

import { FrameCoalescer } from "../app/studio/frame-coalescer.ts";

test("frame coalescer applies only the newest high-frequency input", () => {
  const callbacks = new Map<number, () => void>();
  const cancelled: number[] = [];
  const applied: number[] = [];
  let nextId = 0;
  const coalescer = new FrameCoalescer<number>(
    (callback) => { const id = ++nextId; callbacks.set(id, callback); return id; },
    (id) => { cancelled.push(id); callbacks.delete(id); },
    (value) => applied.push(value),
  );

  coalescer.push(1);
  coalescer.push(2);
  coalescer.push(3);
  assert.equal(callbacks.size, 1);
  callbacks.get(1)!();
  assert.deepEqual(applied, [3]);

  coalescer.push(4);
  coalescer.flush();
  assert.deepEqual(applied, [3, 4]);
  assert.deepEqual(cancelled, [2]);
});

test("frame coalescer cancellation drops pending work", () => {
  const scheduled: { callback: (() => void) | null } = { callback: null };
  const applied: number[] = [];
  const coalescer = new FrameCoalescer<number>(
    (next) => { scheduled.callback = next; return 7; },
    () => { scheduled.callback = null; },
    (value) => applied.push(value),
  );
  coalescer.push(9);
  coalescer.cancel();
  scheduled.callback?.();
  assert.deepEqual(applied, []);
});
