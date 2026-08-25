import assert from "node:assert/strict";
import test from "node:test";
import "./canvas-harness.ts";
import { createDocument } from "../app/engine/document.ts";
import {
  featherSelection,
  refineSelection,
  selectEllipse,
  selectLasso,
  selectRect,
  selectionSurface,
} from "../app/engine/selection.ts";

for (const dimension of [10_000, 25_000, 50_000]) {
  test(`${dimension / 1000}K selection creation, refinement, and feathering obey bounded memory`, () => {
    const doc = createDocument(dimension, dimension);
    const origin = Math.floor(dimension / 2);
    const allocated: HTMLCanvasElement[] = [];
    const documentObject = globalThis.document;
    const originalCreateElement = documentObject.createElement.bind(documentObject);
    documentObject.createElement = ((tagName: string, options?: ElementCreationOptions) => {
      const element = originalCreateElement(tagName, options);
      if (tagName === "canvas") {
        allocated.push(element as HTMLCanvasElement);
      }
      return element;
    }) as typeof documentObject.createElement;
    try {
      selectRect(doc, origin, origin, 180, 120);
      selectEllipse(doc, origin + 140, origin - 40, 120, 160, "add", 3);
      selectLasso(doc, [
        { x: origin - 90, y: origin + 10 },
        { x: origin - 20, y: origin - 80 },
        { x: origin + 30, y: origin + 60 },
      ], "add", 2);
      refineSelection(doc, { smooth: 4, contrast: 20, shiftEdge: 25 });
      featherSelection(doc, 8);
    } finally {
      documentObject.createElement = originalCreateElement as typeof documentObject.createElement;
    }
    const surface = selectionSurface(doc)!;
    const allocations = allocated.map((canvas) => canvas.width * canvas.height);
    assert.ok(surface.stats().residentBytes < 4 * 1024 * 1024);
    assert.ok(allocations.every((pixels) => pixels < 512 * 512), `largest scratch was ${Math.max(...allocations)} pixels`);
  });
}

test("deliberately sparse extreme dimensions preserve bounded transforms", () => {
  const doc = createDocument(300_000, 64);
  selectRect(doc, 299_800, 8, 120, 24);
  const source = selectionSurface(doc)!;
  const translated = source.translated(-100, 5);
  const resized = translated.resized(150_000, 32);
  const cropped = resized.cropped(149_800, 0, 200, 32);
  assert.ok(source.stats().residentBytes < 256 * 1024);
  assert.ok(translated.stats().residentBytes < 256 * 1024);
  assert.ok(resized.stats().residentBytes < 256 * 1024);
  assert.ok(cropped.stats().residentBytes < 256 * 1024);
  assert.equal(cropped.sample(55, 10) > 0, true);
});
