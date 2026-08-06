import assert from "node:assert/strict";
import test from "node:test";
import {
  PrecisionTileSurface,
  SparseTileStore,
  TileGrid,
  float16ToFloat32,
  float32ToFloat16,
} from "../app/engine/tile-store.ts";

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
  assert.ok(store.revisionFor("0:0") > 0);
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

test("half-float encoding preserves HDR, negative, and fractional values", () => {
  for (const value of [-4, -0.125, 0, 0.1, 1, 1.5, 128, 65504]) {
    const restored = float16ToFloat32(float32ToFloat16(value));
    assert.ok(Math.abs(restored - value) <= Math.max(0.001, Math.abs(value) * 0.001));
  }
});

test("precision surfaces retain values outside the canvas gamut and convert formats", () => {
  const surface = new PrecisionTileSurface(4, 4, "rgba32f", "display-p3", 16);
  surface.writePixel(2, 1, [1.75, -0.2, 0.4, 0.8]);
  assert.deepEqual(surface.readPixel(0, 0), [0, 0, 0, 0]);
  assert.deepEqual(surface.readPixel(2, 1), [1.75, -0.20000000298023224, 0.4000000059604645, 0.800000011920929]);

  const half = surface.convert("rgba16f", "srgb");
  const pixel = half.readPixel(2, 1);
  assert.ok(pixel[0] > 1);
  assert.ok(pixel[1] < 0);
  assert.ok(Math.abs(pixel[3] - 0.8) < 0.002);
  assert.equal(half.stats().residentTiles, 1);
  const gpu = surface.tileToFloat32Display("0:0", true, true);
  const gpuIndex = ((4 - 1 - 1) * 4 + 2) * 4;
  assert.ok(gpu[gpuIndex] > 1);
  assert.ok(gpu[gpuIndex + 1] < 0);
  assert.ok(Math.abs(gpu[gpuIndex + 3] - 0.8) < 0.0001);
});

test("canvas patches update only intersecting precision tiles", () => {
  const surface = new PrecisionTileSurface(32, 16, "rgba16f", "srgb", 16);
  const patch = {
    width: 2,
    height: 2,
    data: new Uint8ClampedArray([
      255, 0, 0, 255, 0, 255, 0, 255,
      0, 0, 255, 255, 255, 255, 255, 128,
    ]),
  };
  surface.updateFromImageData(patch, 15, 2);
  assert.equal(surface.stats().residentTiles, 2);
  assert.ok(surface.readPixel(15, 2)[0] > 0.99);
  assert.ok(surface.readPixel(16, 2)[1] > 0.99);
  assert.equal(surface.readPixel(17, 2)[3], 0);
});

test("native float tile editing round-trips extended working values", () => {
  const surface = new PrecisionTileSurface(16, 16, "rgba32f", "linear-srgb", 16);
  const values = surface.tileToWorkingFloat32("0:0");
  values.set([3.25, -0.5, 0.125, 0.75], 0);
  surface.writeWorkingFloat32Tile("0:0", values);
  assert.deepEqual(surface.readPixel(0, 0), [3.25, -0.5, 0.125, 0.75]);
  values.fill(0);
  surface.writeWorkingFloat32Tile("0:0", values);
  assert.equal(surface.stats().residentTiles, 0);
});
