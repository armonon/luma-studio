import assert from "node:assert/strict";
import test from "node:test";
import { acquireAiEditPermit, resetAiEditRateLimitsForTests } from "../app/api/ai/edit/handler";

test("AI edit permits cap concurrent work and release idempotently", () => {
  resetAiEditRateLimitsForTests();
  const first = acquireAiEditPermit("artist@example.com", 1000);
  const second = acquireAiEditPermit("artist@example.com", 1000);
  assert.equal(first.allowed, true);
  assert.equal(second.allowed, true);
  assert.deepEqual(acquireAiEditPermit("artist@example.com", 1000), {
    allowed: false,
    reason: "concurrency",
    retryAfter: 2,
    resetAt: 601000,
  });
  if (first.allowed) { first.release(); first.release(); }
  assert.equal(acquireAiEditPermit("artist@example.com", 1000).allowed, true);
});

test("AI edit permits enforce a fixed per-user window", () => {
  resetAiEditRateLimitsForTests();
  for (let index = 0; index < 12; index++) {
    const permit = acquireAiEditPermit("artist@example.com", 5000);
    assert.equal(permit.allowed, true);
    if (permit.allowed) permit.release();
  }
  const limited = acquireAiEditPermit("artist@example.com", 5000);
  assert.equal(limited.allowed, false);
  if (!limited.allowed) assert.equal(limited.reason, "rate");
  assert.equal(acquireAiEditPermit("artist@example.com", 605000).allowed, true);
});
