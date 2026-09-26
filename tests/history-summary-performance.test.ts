import assert from "node:assert/strict";
import test from "node:test";
import { OperationHistory } from "../app/engine/operation-history.ts";

test("unchanged history summaries do not walk the graph repeatedly", () => {
  const history = new OperationHistory<number>({ maxNodes: 2000 });
  for (let i = 0; i < 1500; i++) history.commit("Edit", i);
  const internals = history as unknown as { nodes: Map<string, unknown> };
  const values = internals.nodes.values.bind(internals.nodes);
  let walks = 0;
  internals.nodes.values = () => { walks++; return values(); };
  const before = history.summary();
  for (let i = 0; i < 10_000; i++) assert.equal(history.summary().currentDepth, 1500);
  assert.equal(walks, 1);
  before.currentDepth = -1;
  assert.equal(history.summary().currentDepth, 1500);
  history.undo(); assert.equal(history.summary().currentDepth, 1499);
  history.redo(); assert.equal(history.summary().currentDepth, 1500);
  history.checkout(history.rootId); assert.equal(history.summary().currentDepth, 0);
  history.commit("Branch", 2); assert.equal(history.summary().branchPoints, 1);
});

test("summary cache remains correct after pruning and restoration", () => {
  const history = new OperationHistory<number>({ maxNodes: 3, maxBytes: 3, sizeOf: () => 1 });
  for (let i = 0; i < 10; i++) { history.summary(); history.commit("Edit", i); }
  assert.equal(history.summary().operations, 3);
  assert.equal(history.summary().bytes, 3);
  const restored = OperationHistory.fromSnapshot(history.snapshot(), { maxNodes: 2, sizeOf: () => 1 });
  assert.equal(restored.summary().operations, 2);
  assert.equal(restored.summary().currentDepth, 2);
});
