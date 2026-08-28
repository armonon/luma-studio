import assert from "node:assert/strict";
import test from "node:test";
import { Studio } from "../app/engine/studio.ts";
import { newCanvas } from "../app/engine/document.ts";
import "./canvas-harness.ts";
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

test("replacing a surface releases the old one instead of charging for both", () => {
  // unbindMemoryBudget() existed and was called from nowhere, so crop, resize
  // and syncLayerSurface each left the outgoing surface charged to the budget
  // until a finalizer happened to run. The budget then refused work against
  // memory that was not live, surfacing as a spurious ResidentMemoryLimitError
  // on some unrelated later edit. Reconciling against the document's live set
  // keeps the two in step no matter which call site does the replacing.
  const studio = new Studio(512, 512, newCanvas(8, 8));
  const layer = studio.addBlankRaster("art");
  const context = layer.bitmap!.getContext("2d")!;
  context.fillStyle = "#3060c0";
  context.fillRect(0, 0, 512, 512);
  // Surfaces are charged when they are bound, which happens on commit — push
  // the paint through so `before` reflects a real, populated surface.
  (studio as unknown as { syncLayerSurface(target: typeof layer): void }).syncLayerSurface(layer);
  studio.setLayerProp(layer.id, "name", "art", "Rename");

  const budget = (studio as unknown as { residentMemoryBudget: ResidentMemoryBudget }).residentMemoryBudget;
  const before = budget.stats();
  assert.ok(before.residentBytes > 0, "precondition: the populated surface is charged to the budget");
  for (let pass = 0; pass < 20; pass += 1) {
    studio.resizeDocument(400 + (pass % 5) * 10, 400 + (pass % 5) * 10);
  }
  const after = budget.stats();

  assert.equal(after.surfaces, before.surfaces, "each resize replaces the surface, it does not add one");
  assert.ok(
    after.residentBytes <= before.residentBytes * 2,
    `resident bytes must track the live document, got ${before.residentBytes} -> ${after.residentBytes}`,
  );
});
