import assert from "node:assert/strict";
import test from "node:test";
import { SparseAlphaSurface } from "../app/engine/alpha-surface.ts";
import { ResidentMemoryBudget, ResidentMemoryLimitError } from "../app/engine/resident-memory.ts";
import { SparseTileStore, TileGrid } from "../app/engine/tile-store.ts";

test("independent pixel surfaces share one resident-memory ceiling", () => {
  const budget = new ResidentMemoryBudget(400_000);
  const first = new SparseTileStore(new TileGrid(256, 256), "rgba8");
  const second = new SparseTileStore(new TileGrid(256, 256), "rgba8");
  first.bindMemoryBudget(budget, "first");
  second.bindMemoryBudget(budget, "second");
  const pixels = new Uint8Array(256 * 256 * 4);
  first.write("0:0", pixels);
  assert.throws(() => second.write("0:0", pixels), ResidentMemoryLimitError);
  assert.equal(budget.stats().rejectedAdmissions, 1);
  first.delete("0:0");
  assert.doesNotThrow(() => second.write("0:0", pixels));
});

test("selection and mask alpha compete with pixel tiles under the same ceiling", () => {
  const budget = new ResidentMemoryBudget(300_000);
  const pixels = new SparseTileStore(new TileGrid(256, 256), "rgba8");
  const alpha = new SparseAlphaSurface(256, 256);
  pixels.bindMemoryBudget(budget, "pixels");
  alpha.bindMemoryBudget(budget, "selection");
  pixels.write("0:0", new Uint8Array(256 * 256 * 4));
  const nonUniform = Uint8Array.from({ length: 256 * 256 }, (_, index) => index % 251);
  assert.throws(() => alpha.writeRegion({ x: 0, y: 0, width: 256, height: 256 }, nonUniform), ResidentMemoryLimitError);
  assert.equal(alpha.stats().residentBytes, 0);
});
