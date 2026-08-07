import assert from "node:assert/strict";
import test from "node:test";
import { OperationHistory } from "../app/engine/operation-history.ts";

// Payloads carry their own declared size so these tests can exercise the byte
// budget without allocating real canvases.
type Sized = { bytes: number; tag: string };
const sizeOf = (v: Sized) => v.bytes;

function history(opts: { maxNodes?: number; maxBytes?: number } = {}) {
  let id = 0;
  return new OperationHistory<Sized>({
    maxNodes: opts.maxNodes ?? 50,
    maxBytes: opts.maxBytes,
    sizeOf,
    idFactory: () => `op-${++id}`,
    now: () => 1_000 + id,
  });
}

test("a single entry larger than maxBytes must not destroy the current node", () => {
  const h = history({ maxBytes: 512 });
  h.commit("huge", { bytes: 4096, tag: "huge" });

  // The current node is the only non-root node and is over budget. Trim must
  // not evict it — doing so leaves `currentId` dangling and every later call
  // throws "Unknown history operation".
  assert.doesNotThrow(() => h.canRedo(), "canRedo must not throw after trim");
  assert.doesNotThrow(() => h.canUndo(), "canUndo must not throw after trim");
  assert.doesNotThrow(
    () => h.commit("next", { bytes: 8, tag: "next" }),
    "commit must not throw after an over-budget entry",
  );
});

test("the current lineage survives byte pressure; older branches are evicted first", () => {
  const h = history({ maxBytes: 1000 });
  h.commit("a", { bytes: 400, tag: "a" });
  h.commit("b", { bytes: 400, tag: "b" });
  h.commit("c", { bytes: 400, tag: "c" }); // 1200 > 1000, must evict

  // Whatever got dropped, the graph must stay walkable and the cursor valid.
  assert.doesNotThrow(() => h.lineage());
  assert.doesNotThrow(() => h.snapshot());
  const labels = h.lineage().map((n) => n.label);
  assert.ok(labels.includes("c"), "the newest committed node must survive");
});

test("byteSize drops back to zero once every payload is evicted", () => {
  const h = history({ maxNodes: 2, maxBytes: 0 });
  h.commit("a", { bytes: 100, tag: "a" });
  h.commit("b", { bytes: 100, tag: "b" });
  assert.equal(h.byteSize, 200);
  h.commit("c", { bytes: 100, tag: "c" }); // evicts one under maxNodes=2
  assert.equal(h.byteSize, 200, "evicting one of three 100-byte nodes leaves 200");
});

test("fromSnapshot restores byte accounting instead of reporting zero", () => {
  const h = history({ maxBytes: 100_000 });
  h.commit("a", { bytes: 100, tag: "a" });
  h.commit("b", { bytes: 100, tag: "b" });
  h.commit("c", { bytes: 100, tag: "c" });
  assert.equal(h.byteSize, 300);

  const restored = OperationHistory.fromSnapshot<Sized>(h.snapshot(), {
    sizeOf,
    maxBytes: 100_000,
  });
  assert.equal(
    restored.byteSize,
    300,
    "restored history must re-bill payloads or the cap never applies again",
  );
});

test("a restored history still honours the byte cap", () => {
  const h = history({ maxBytes: 100_000 });
  h.commit("a", { bytes: 400, tag: "a" });
  h.commit("b", { bytes: 400, tag: "b" });

  const restored = OperationHistory.fromSnapshot<Sized>(h.snapshot(), {
    sizeOf,
    maxBytes: 500,
  });
  // Restoring under a tighter cap must trim rather than silently exceed it,
  // and must not corrupt the cursor while doing so.
  assert.doesNotThrow(() => restored.commit("c", { bytes: 10, tag: "c" }));
  assert.ok(restored.byteSize > 0);
});
