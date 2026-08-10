import assert from "node:assert/strict";
import test from "node:test";
import {
  createDocument,
  createGroupLayer,
  createRasterLayer,
  createShapeLayer,
  type Layer,
} from "../app/engine/document.ts";
import {
  EMPTY_LAYER_FOCUS_STATE,
  enterLayerFocus,
  fitViewToLayer,
  focusBreadcrumbLayers,
  focusItems,
  hitTestEditableLayer,
  leaveLayerFocus,
  normalizeLayerFocusPreferences,
  reconcileLayerFocus,
} from "../app/studio/layer-focus-model.ts";

function nestedDocument() {
  const doc = createDocument(1000, 800);
  const group = createGroupLayer("Hero");
  const person = createShapeLayer("Person", { kind: "rect", x: 200, y: 180, w: 240, h: 320, fill: "#fff", stroke: "#000", strokeWidth: 0, radius: 0 });
  person.parentId = group.id;
  const shadow = createShapeLayer("Shadow", { kind: "ellipse", x: 180, y: 490, w: 320, h: 80, fill: "#000", stroke: "#000", strokeWidth: 0, radius: 0 });
  shadow.parentId = group.id;
  doc.layers = [group, person, shadow];
  return { doc, group, person, shadow };
}

test("selection and Focus remain separate while nested focus preserves the exact project view", () => {
  const { doc, group, person } = nestedDocument();
  const projectView = { zoom: 2.25, panX: -183, panY: 74 };
  const groupFocus = enterLayerFocus(EMPTY_LAYER_FOCUS_STATE, doc, "document-a", group.id, projectView);
  const personFocus = enterLayerFocus(groupFocus, doc, "document-a", person.id, { zoom: 9, panX: 0, panY: 0 });

  assert.equal(groupFocus.scope?.layerId, group.id);
  assert.equal(personFocus.scope?.layerId, person.id);
  assert.deepEqual(personFocus.projectView, projectView);
  assert.deepEqual(focusBreadcrumbLayers(doc, personFocus).map((layer) => layer.name), ["Hero", "Person"]);
  assert.deepEqual(leaveLayerFocus(personFocus).scope, null);
});

test("deleted targets recover to their nearest parent and document switches exit safely", () => {
  const { doc, group, person } = nestedDocument();
  const focused = enterLayerFocus(EMPTY_LAYER_FOCUS_STATE, doc, "document-a", person.id, { zoom: 1, panX: 0, panY: 0 });
  doc.layers = doc.layers.filter((layer) => layer.id !== person.id);
  const recovered = reconcileLayerFocus(focused, doc, "document-a");
  assert.equal(recovered.scope?.layerId, group.id);
  assert.equal(recovered.scope?.target, "pixels");
  assert.equal(reconcileLayerFocus(recovered, doc, "document-b").scope, null);
});

test("a removed focused mask falls back to pixels without losing the scope", () => {
  const { doc, person } = nestedDocument();
  person.mask = {} as HTMLCanvasElement;
  const focused = enterLayerFocus(EMPTY_LAYER_FOCUS_STATE, doc, "document-a", person.id, { zoom: 1, panX: 0, panY: 0 }, "mask");
  person.mask = undefined;
  const recovered = reconcileLayerFocus(focused, doc, "document-a");
  assert.equal(recovered.scope?.layerId, person.id);
  assert.equal(recovered.scope?.target, "pixels");
});

test("Focus shows a bounded contextual working set and always retains selection and pins", () => {
  const doc = createDocument(100, 100);
  doc.layers = Array.from({ length: 240 }, (_, index) => createRasterLayer(`Layer ${index}`));
  const selected = doc.layers[190];
  const pinned = doc.layers[4];
  const items = focusItems(doc, EMPTY_LAYER_FOCUS_STATE, selected.id, [pinned.id], [doc.layers[230].id]);
  assert.ok(items.length <= 80);
  assert.ok(items.some((item) => item.layer.id === selected.id));
  assert.ok(items.some((item) => item.layer.id === pinned.id && item.pinned));
});

test("fit and hit testing use a layer's visual geometry rather than the full project", () => {
  const { doc, group, person, shadow } = nestedDocument();
  const fitted = fitViewToLayer(doc, person.id, 1000, 800);
  assert.ok(fitted.zoom > 1);
  assert.equal(hitTestEditableLayer(doc, 300, 300)?.id, person.id);
  assert.equal(hitTestEditableLayer(doc, 300, 520, group.id)?.id, shadow.id);
  assert.equal(hitTestEditableLayer(doc, 900, 700, group.id), null);
});

test("invalid ancestry is cycle-safe", () => {
  const doc = createDocument(100, 100);
  const a = createGroupLayer("A");
  const b = createGroupLayer("B");
  a.parentId = b.id;
  b.parentId = a.id;
  const child = createRasterLayer("Child");
  child.parentId = a.id;
  doc.layers = [a, b, child] as Layer[];
  const focused = enterLayerFocus(EMPTY_LAYER_FOCUS_STATE, doc, "doc", child.id, { zoom: 1, panX: 0, panY: 0 });
  assert.ok((focused.scope?.path.length ?? 0) <= 3);
});

test("Focus preferences persist a bounded, deduplicated working set", () => {
  const preferences = normalizeLayerFocusPreferences({
    pinnedLayerIds: ["a", "a", "b", 7],
    recentLayerIds: [...Array.from({ length: 30 }, (_, index) => `recent-${index}`), "recent-0"],
  });
  assert.deepEqual(preferences.pinnedLayerIds, ["a", "b"]);
  assert.equal(preferences.recentLayerIds.length, 24);
  assert.equal(preferences.recentLayerIds[0], "recent-0");
});
