import assert from "node:assert/strict";
import test from "node:test";

import { FrameCoalescer, browserFrameCoalescer } from "../app/studio/frame-coalescer.ts";

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

test("browser frame scheduling preserves its host receiver and coalesces a burst", () => {
  let callback: FrameRequestCallback | undefined;
  let scheduled = 0, cancelled = 0, updates = 0;
  const host = {
    requestAnimationFrame(next: FrameRequestCallback) { assert.equal(this, host); callback = next; scheduled++; return 1; },
    cancelAnimationFrame(id: number) { assert.equal(this, host); assert.equal(id, 1); cancelled++; },
  };
  const coalescer = browserFrameCoalescer(() => updates++, host);
  for (let i = 0; i < 1000; i++) coalescer.push(true);
  assert.equal(scheduled, 1);
  callback!(0); assert.equal(updates, 1);
  coalescer.push(true); coalescer.cancel(); assert.equal(cancelled, 1);
});
