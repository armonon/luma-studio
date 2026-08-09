import assert from "node:assert/strict";
import test from "node:test";
import * as engine from "../app/engine/index.ts";

// The entry point is the contract both editions build against. These tests
// exist so an accidental removal or rename is a failing build rather than a
// silent break in the desktop edition.

test("the public surface exports its documented pillars", () => {
  const required = [
    // controller + versioning
    "Studio", "LUMA_API_VERSION", "isCompatibleApiVersion",
    // document model
    "createDocument", "newCanvas", "BLEND_LABELS", "curveToLut",
    // editions
    "currentEdition", "hasCapability", "isAvailable", "proOnlyCapabilities",
    // compositing
    "blendRgb", "renderViewport", "renderGL", "isGLSupported", "compositeNativeTile", "isNativeCoreAvailable",
    // selection
    "selectRect", "selectAll", "deselect", "invertSelection",
    // history
    "OperationHistory",
    // interchange
    "importPsd", "exportPsd", "ingestRaw", "supportsSensorDecode",
    // automation
    "ActionRecorder",
  ];
  for (const name of required) {
    assert.ok(name in engine, `public API is missing "${name}"`);
  }
});

test("the engine is usable headlessly through the entry point alone", () => {
  // A pro/desktop host, a worker, or a CI job must be able to drive the engine
  // without a DOM. Anything that breaks this breaks the desktop edition.
  const studio = new engine.Studio(32, 24, {} as HTMLCanvasElement);
  assert.equal(studio.doc.width, 32);
  assert.equal(studio.canUndo(), false);

  const layer = studio.addLevelsLayer();
  assert.equal(studio.doc.layers.length, 1);
  assert.equal(studio.canUndo(), true, "adding a layer must be undoable");

  studio.undo();
  assert.equal(studio.doc.layers.length, 0);
  studio.redo();
  assert.equal(studio.doc.layers.length, 1);
  assert.equal(studio.doc.layers[0].id, layer.id);

  studio.dispose();
});

test("edition gating is reachable from the entry point", () => {
  assert.equal(engine.currentEdition({}), "web");
  assert.equal(engine.hasCapability("pro", "filesystem-access"), true);
  assert.equal(engine.hasCapability("web", "filesystem-access"), false);
  assert.equal(engine.isAvailable("pro", "filesystem-access"), true);
  assert.equal(engine.isAvailable("web", "filesystem-access"), false);
});

test("blend math is exported and matches the catalogue", () => {
  const modes = Object.keys(engine.BLEND_LABELS);
  assert.ok(modes.length >= 27, `expected the full catalogue, got ${modes.length}`);
  assert.deepEqual(engine.blendRgb("multiply", [0.5, 0.5, 0.5], [0.5, 0.5, 0.5]), [0.25, 0.25, 0.25]);
});
