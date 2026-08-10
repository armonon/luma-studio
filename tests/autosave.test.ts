import assert from "node:assert/strict";
import test from "node:test";
import { normalizeRecoveryWorkspace } from "../app/engine/autosave.ts";

test("recovery workspace validates documents and keeps one active tab", () => {
  const first = new Blob(["first"]);
  const second = new Blob(["second"]);
  const documents = normalizeRecoveryWorkspace({ documents: [
    { id: "one", name: "One", active: true, blob: first, updatedAt: 12 },
    { id: "two", name: "Two", active: true, blob: second, updatedAt: Number.NaN },
    { id: "bad", name: "Bad", active: false, blob: "not-a-blob" },
  ] });
  assert.deepEqual(documents.map(({ id, active, updatedAt }) => ({ id, active, updatedAt })), [
    { id: "one", active: true, updatedAt: 12 },
    { id: "two", active: false, updatedAt: 0 },
  ]);
});

test("recovery workspace makes the first valid document active when needed", () => {
  const documents = normalizeRecoveryWorkspace({ documents: [
    { id: "one", name: "", active: false, blob: new Blob(["one"]) },
    { id: "two", name: "Two", active: false, blob: new Blob(["two"]) },
  ] });
  assert.equal(documents[0].name, "Untitled");
  assert.deepEqual(documents.map((document) => document.active), [true, false]);
});
