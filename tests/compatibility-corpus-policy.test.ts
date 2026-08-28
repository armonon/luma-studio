import assert from "node:assert/strict";
import test from "node:test";
import { classifyPhotoshopImport } from "../build/compatibility-corpus-policy";

test("a declared editable layer floor permits Photoshop bookkeeping layers to collapse", () => {
  assert.equal(classifyPhotoshopImport({ sourceLayers: 11, openedLayers: 10, minimumLayers: 10 }), "layered");
});

test("flattened fallback remains explicit and missing editable layers fail clearly", () => {
  assert.equal(classifyPhotoshopImport({ sourceLayers: 24, openedLayers: 1, allowFlattenedFallback: true }), "flattened-fallback");
  assert.throws(
    () => classifyPhotoshopImport({ sourceLayers: 11, openedLayers: 9, minimumLayers: 10 }),
    /collapsed 11 source layers to 9; expected at least 10/,
  );
});

test("Photoshop documents without layer records are composite-only", () => {
  assert.equal(classifyPhotoshopImport({ sourceLayers: 0, openedLayers: 1 }), "composite-only");
});
