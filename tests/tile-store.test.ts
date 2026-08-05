import assert from "node:assert/strict";
import test from "node:test";
import { SparseTileStore, TileGrid } from "../app/engine/tile-store.ts";

test("tile geometry covers edge tiles without exceeding document bounds", () => {
  const grid = new TileGrid(600, 300, 256);
  assert.equal(grid.columns, 3);
  assert.equal(grid.rows, 2);
  assert.equal(grid.totalTiles, 6);
  assert.deepEqual(grid.address(2, 1), {
    key: "2:1",
    column: 2,
    row: 1,
    x: 512,
    y: 256,
    width: 88,
    height: 44,
  });
  assert.equal(grid.addressForPixel(599, 299)?.key, "2:1");
  assert.equal(grid.addressForPixel(600, 299), null);
});

test("intersection clips rectangles and returns deterministic row-major tiles", () => {
  const grid = new TileGrid(600, 300, 256);
  assert.deepEqual(
    grid.tilesIntersecting({ x: -10, y: 250, width: 300, height: 30 }).map((tile) => tile.key),
    ["0:0", "1:0", "0:1", "1:1"],
  );
  assert.deepEqual(grid.tilesIntersecting({ x: 700, y: 0, width: 40, height: 40 }), []);
  assert.deepEqual(grid.tilesIntersecting({ x: 20, y: 20, width: 0, height: 10 }), []);
});

test("format estimates distinguish 8-bit, half-float, and float tiles", () => {
  const grid = new TileGrid(32, 16, 16);
  assert.equal(grid.estimatedBytes("rgba8"), 2_048);
  assert.equal(grid.estimatedBytes("rgba16f"), 4_096);
  assert.equal(grid.estimatedBytes("rgba32f"), 8_192);
  assert.equal(grid.byteLength(grid.address(0, 0), "rgba16f"), 2_048);
});

test("sparse store copies writes, tracks revisions, and emits tombstones", () => {
  const grid = new TileGrid(32, 16, 16);
  const store = new SparseTileStore(grid, "rgba8");
  const source = new Uint8Array(grid.byteLength(grid.address(0, 0), "rgba8")).fill(7);
  store.write("0:0", source);
  source.fill(9);

  const saved = store.read("0:0")!;
  assert.equal(saved[0], 7);
  saved[0] = 1;
  assert.equal(store.read("0:0")![0], 7);
  assert.equal(store.stats().residentTiles, 1);
  assert.equal(store.drainDirty()[0].deleted, false);
  assert.equal(store.stats().dirtyTiles, 0);

  assert.equal(store.delete("0:0"), true);
  const deletion = store.drainDirty()[0];
  assert.equal(deletion.key, "0:0");
  assert.equal(deletion.deleted, true);
  assert.equal(deletion.data, undefined);
});

test("sparse store rejects malformed keys and incorrect payload sizes", () => {
  const store = new SparseTileStore(new TileGrid(32, 32, 16));
  assert.throws(() => store.read("bad"), /Invalid tile key/);
  assert.throws(() => store.write("0:0", new Uint8Array(3)), /expected 1024 bytes/);
  assert.throws(() => store.write("9:9", new Uint8Array(1024)), /out of bounds/);
});
