import assert from "node:assert/strict";
import test from "node:test";

import { createRasterLayer } from "../app/engine/document.ts";
import {
  clampSpaceDeckPosition,
  resolveSpaceDeckContext,
  spaceDeckDimensions,
  spaceDeckCommands,
  togglePinnedSpaceDeck,
} from "../app/studio/space-deck-model.ts";
import { testCanvas } from "./canvas-harness.ts";

const layer = createRasterLayer("Paint", testCanvas(8, 8));

test("space deck chooses the most specific editing context", () => {
  assert.equal(resolveSpaceDeckContext({ layer: null, tool: "move", hasSelection: false }), "canvas");
  assert.equal(resolveSpaceDeckContext({ layer, tool: "brush", hasSelection: false }), "paint");
  layer.mask = testCanvas(8, 8);
  assert.equal(resolveSpaceDeckContext({ layer, tool: "mask-add", hasSelection: false }), "mask");
  assert.equal(resolveSpaceDeckContext({ layer, tool: "mask-add", hasSelection: true }), "mask");
  assert.equal(resolveSpaceDeckContext({ layer, tool: "sel-wand", hasSelection: false }), "selection");
  assert.equal(resolveSpaceDeckContext({ layer, tool: "heal", hasSelection: true }), "retouch");
  assert.equal(resolveSpaceDeckContext({ layer, tool: "tone", hasSelection: true }), "develop");
  assert.equal(resolveSpaceDeckContext({ layer, tool: "radial-warp", hasSelection: true }), "transform");
  assert.equal(resolveSpaceDeckContext({ layer, tool: "eyedropper", hasSelection: true }), "measure");
});

test("each context exposes four stable, keyboard-addressable actions", () => {
  for (const input of [
    { layer: null, tool: "move", hasSelection: false },
    { layer, tool: "brush", hasSelection: false },
    { layer, tool: "move", hasSelection: true },
  ]) {
    const commands = spaceDeckCommands(input);
    assert.equal(commands.length, 4);
    assert.deepEqual(commands.map((item) => item.key), [1, 2, 3, 4]);
    assert.equal(new Set(commands.map((item) => item.id)).size, 4);
  }
});

test("tool feature decks expand in useful steps instead of reserving one fixed size", () => {
  assert.deepEqual(spaceDeckDimensions(3), { width: 390, height: 260 });
  assert.deepEqual(spaceDeckDimensions(4), { width: 520, height: 326 });
  assert.deepEqual(spaceDeckDimensions(7), { width: 660, height: 390 });
  assert.deepEqual(spaceDeckDimensions(10), { width: 740, height: 450 });
});

test("a Space tap pins the palette and the next tap closes it", () => {
  assert.deepEqual(togglePinnedSpaceDeck({ open: false, pinned: false }), { open: true, pinned: true });
  assert.deepEqual(togglePinnedSpaceDeck({ open: true, pinned: false }), { open: true, pinned: true });
  assert.deepEqual(togglePinnedSpaceDeck({ open: true, pinned: true }), { open: false, pinned: false });
});

test("space deck stays entirely inside tiny and large stages", () => {
  assert.deepEqual(
    clampSpaceDeckPosition({ x: 0, y: 0 }, { width: 1200, height: 800 }),
    { x: 14, y: 14 },
  );
  assert.deepEqual(
    clampSpaceDeckPosition({ x: 1200, y: 800 }, { width: 1200, height: 800 }),
    { x: 626, y: 528 },
  );
  assert.deepEqual(
    clampSpaceDeckPosition({ x: 100, y: 100 }, { width: 300, height: 180 }),
    { x: 14, y: 14 },
  );
});
