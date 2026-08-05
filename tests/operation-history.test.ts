import assert from "node:assert/strict";
import test from "node:test";
import { OperationHistory } from "../app/engine/operation-history.ts";

function history(maxNodes = 20) {
  let id = 0;
  let time = 1_000;
  return new OperationHistory<string>({
    maxNodes,
    idFactory: () => `operation-${++id}`,
    now: () => ++time,
  });
}

test("undo and redo move through operation payloads", () => {
  const graph = history();
  graph.commit("Exposure", "exposure");
  graph.commit("Curves", "curves");

  assert.equal(graph.canUndo(), true);
  assert.equal(graph.canRedo(), false);
  assert.equal(graph.undo()?.value, "curves");
  assert.equal(graph.redo()?.value, "curves");
  assert.deepEqual(graph.lineage().map((node) => node.label), ["Exposure", "Curves"]);
});

test("editing after undo retains the alternate future as a branch", () => {
  const graph = history();
  graph.commit("Base tone", "base");
  const original = graph.commit("Warm grade", "warm");
  graph.undo();
  const alternate = graph.commit("Cool grade", "cool");

  assert.equal(graph.summary().branchPoints, 1);
  assert.deepEqual(
    graph.tree().filter((node) => node.label.includes("grade")).map((node) => node.label),
    ["Warm grade", "Cool grade"],
  );

  const transition = graph.checkout(original.id);
  assert.deepEqual(transition.undo.map((node) => node.value), ["cool"]);
  assert.deepEqual(transition.redo.map((node) => node.value), ["warm"]);
  assert.equal(graph.current, original.id);

  graph.undo();
  assert.equal(graph.redo(alternate.id)?.value, "cool");
});

test("checkout plans multi-step transitions through the common ancestor", () => {
  const graph = history();
  const base = graph.commit("Base", "base");
  graph.commit("A1", "a1");
  const a2 = graph.commit("A2", "a2");
  graph.checkout(base.id);
  graph.commit("B1", "b1");
  const b2 = graph.commit("B2", "b2");

  const transition = graph.checkout(a2.id);
  assert.deepEqual(transition.undo.map((node) => node.value), ["b2", "b1"]);
  assert.deepEqual(transition.redo.map((node) => node.value), ["a1", "a2"]);
  assert.equal(graph.current, a2.id);

  const reverse = graph.checkout(b2.id);
  assert.deepEqual(reverse.undo.map((node) => node.value), ["a2", "a1"]);
  assert.deepEqual(reverse.redo.map((node) => node.value), ["b1", "b2"]);
});

test("bounded history drops the oldest payloads while preserving recent undo", () => {
  const graph = history(3);
  for (const label of ["One", "Two", "Three", "Four", "Five"]) {
    graph.commit(label, label.toLowerCase());
  }

  assert.equal(graph.size, 3);
  assert.deepEqual(graph.lineage().map((node) => node.label), ["Three", "Four", "Five"]);
  assert.equal(graph.undo()?.label, "Five");
  assert.equal(graph.undo()?.label, "Four");
  assert.equal(graph.undo()?.label, "Three");
  assert.equal(graph.undo(), null);
});

test("unknown checkout targets fail without changing the current version", () => {
  const graph = history();
  const current = graph.commit("Known", "known");
  assert.throws(() => graph.checkout("missing"), /Unknown history operation/);
  assert.equal(graph.current, current.id);
});

test("history topology and preferred branches survive snapshot restore", () => {
  const graph = history();
  graph.commit("Base", "base");
  const warm = graph.commit("Warm", "warm");
  graph.undo();
  const cool = graph.commit("Cool", "cool");
  graph.checkout(warm.id);

  const restored = OperationHistory.fromSnapshot(graph.snapshot(), { maxNodes: 20 });
  assert.deepEqual(restored.summary(), graph.summary());
  assert.deepEqual(
    restored.tree().map(({ id, parentId, label, childCount, isCurrent }) => ({ id, parentId, label, childCount, isCurrent })),
    graph.tree().map(({ id, parentId, label, childCount, isCurrent }) => ({ id, parentId, label, childCount, isCurrent })),
  );
  restored.undo();
  assert.equal(restored.redo(cool.id)?.value, "cool");
});

test("snapshot restore rejects disconnected or cyclic topology", () => {
  const graph = history();
  graph.commit("Base", "base");
  const snapshot = graph.snapshot();
  snapshot.nodes.push({
    id: "orphan",
    parentId: "orphan",
    childIds: ["orphan"],
    label: "Orphan",
    createdAt: 0,
    sequence: 99,
    value: "orphan",
  });
  assert.throws(
    () => OperationHistory.fromSnapshot(snapshot),
    /parent is invalid|unreachable|cycle/,
  );
});
