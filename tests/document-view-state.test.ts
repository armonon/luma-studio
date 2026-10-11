import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { FIT_VIEW, reconcileDocumentViews, updateDocumentView, type DocumentViews } from "../app/studio/document-view-state.ts";

const initial = (): DocumentViews => ({ activeId: null, views: {}, initial: { zoom: 1.2, panX: 0, panY: 0 } });

test("New Document does not reset the outgoing render's document view", () => {
  const page = readFileSync(new URL("../app/studio/studio-client.tsx", import.meta.url), "utf8");
  const creation = page.slice(page.indexOf("{showNewDocument &&"), page.indexOf("{nativeOpening &&"));
  assert.ok(creation.includes("studio.resetDocument(width, height, name)"));
  assert.ok(!creation.includes("setView("));
});

test("document tabs remember independent framing and new documents start fitted", () => {
  let state = reconcileDocumentViews(initial(), "a", ["a"]);
  assert.equal(state.views.a.zoom, 1.2);
  state = updateDocumentView(state, "a", { zoom: 20, panX: 42, panY: -12 });
  state = reconcileDocumentViews(state, "b", ["a", "b"]);
  assert.deepEqual(state.views.b, FIT_VIEW);
  state = updateDocumentView(state, "b", view => ({ ...view, panY: 99 }));
  for (let i = 0; i < 100; i++) {
    state = reconcileDocumentViews(state, "a", ["a", "b"]);
    assert.deepEqual(state.views.a, { zoom: 20, panX: 42, panY: -12 });
    state = reconcileDocumentViews(state, "b", ["a", "b"]);
    assert.equal(state.views.b.panY, 99);
  }
});

test("stale animation callbacks cannot modify either document after a tab switch", () => {
  let state = reconcileDocumentViews(initial(), "a", ["a"]);
  state = reconcileDocumentViews(state, "b", ["a", "b"]);
  assert.equal(updateDocumentView(state, "a", () => { throw Error("stale callback ran"); }), state);
  assert.equal(updateDocumentView(state, null, FIT_VIEW), state);
});

test("closed views are pruned, last-document replacement resets and invalid values are rejected", () => {
  let state = reconcileDocumentViews(initial(), "a", ["a"]);
  state = updateDocumentView(state, "a", { zoom: 5, panX: 1, panY: 2 });
  state = reconcileDocumentViews(state, "new", ["new"]);
  assert.deepEqual(Object.keys(state.views), ["new"]);
  assert.deepEqual(state.views.new, FIT_VIEW);
  for (const invalid of [{ zoom: NaN, panX: 0, panY: 0 }, { zoom: 0, panX: 0, panY: 0 }, { zoom: 1, panX: Infinity, panY: 0 }]) {
    assert.equal(updateDocumentView(state, "new", invalid), state);
  }
});
