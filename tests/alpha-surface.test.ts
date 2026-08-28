import assert from "node:assert/strict";
import test from "node:test";
import "./canvas-harness.ts";
import {
  AlphaMemoryLimitError,
  SparseAlphaSurface,
} from "../app/engine/alpha-surface.ts";
import { createDocument } from "../app/engine/document.ts";
import { selectByColorTiled, selectionSurface } from "../app/engine/selection.ts";

test("50K selections store uniform interiors without document-sized buffers", () => {
  const surface = new SparseAlphaSurface(50_000, 50_000);
  surface.fillRect({ x: 1000, y: 2000, width: 40_000, height: 30_000 }, 255);
  const stats = surface.stats();
  assert.equal(surface.sample(999, 2000), 0);
  assert.equal(surface.sample(1000, 2000), 255);
  assert.equal(surface.sample(40_999, 31_999), 255);
  assert.equal(surface.sample(41_000, 32_000), 0);
  assert.ok(stats.residentBytes < 32 * 1024 * 1024, `resident alpha was ${stats.residentBytes} bytes`);
  assert.deepEqual(surface.bounds(), { x: 1000, y: 2000, w: 40_000, h: 30_000 });
});

test("select-all and reveal-all masks occupy no tiles and invert in constant memory", () => {
  const all = new SparseAlphaSurface(300_000, 300_000, { defaultAlpha: 255 });
  assert.equal(all.stats().residentTiles, 0);
  assert.deepEqual(all.bounds(), { x: 0, y: 0, w: 300_000, h: 300_000 });
  const none = all.inverted();
  assert.equal(none.defaultAlpha, 0);
  assert.equal(none.stats().residentTiles, 0);
  assert.deepEqual(none.bounds(), { x: 0, y: 0, w: 0, h: 0 });
});

test("alpha combinations preserve fractional coverage tilewise", () => {
  const current = new SparseAlphaSurface(1024, 1024);
  current.fillRect({ x: 0, y: 0, width: 700, height: 700 }, 128);
  const incoming = new SparseAlphaSurface(1024, 1024);
  incoming.fillRect({ x: 500, y: 500, width: 500, height: 500 }, 128);
  const added = current.combined(incoming, "add");
  const intersected = current.combined(incoming, "intersect");
  const subtracted = current.combined(incoming, "subtract");
  const replaced = current.combined(incoming, "replace");
  assert.equal(added.sample(600, 600), 192);
  assert.equal(intersected.sample(600, 600), 64);
  assert.equal(intersected.sample(200, 200), 0);
  // Subtract and replace were the two modes nothing exercised. Subtract erodes
  // the overlap by the incoming coverage and leaves the rest alone; replace
  // discards the current surface entirely, including where it had coverage and
  // the incoming one does not.
  assert.equal(subtracted.sample(600, 600), 64, "half coverage removed from half coverage");
  assert.equal(subtracted.sample(200, 200), 128, "outside the incoming shape nothing is removed");
  assert.equal(subtracted.sample(900, 900), 0, "outside the current shape there was nothing to remove");
  assert.equal(replaced.sample(600, 600), 128);
  assert.equal(replaced.sample(200, 200), 0, "replace does not keep the current coverage");
  assert.equal(replaced.sample(900, 900), 128);
});

test("region IO never materializes the document and tile patches restore exactly", () => {
  const surface = new SparseAlphaSurface(50_000, 50_000);
  const width = 100;
  const height = 80;
  const origin = { x: 49_900, y: 49_920 };
  // Every pixel distinct along both axes. This used to be a uniform fill of
  // 91, which reads back as 91 no matter how writeRegion addresses it — a row
  // or column offset in either direction was completely invisible.
  const alpha = new Uint8Array(width * height);
  const expected = (x: number, y: number) => ((x - origin.x) * 7 + (y - origin.y) * 31) % 251;
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      alpha[row * width + column] = expected(origin.x + column, origin.y + row);
    }
  }

  const patches = surface.writeRegion({ ...origin, width, height }, alpha);
  assert.deepEqual(
    [...surface.readRegion({ ...origin, width, height })],
    [...alpha],
    "every pixel of the region round trips at its own coordinate",
  );
  // The corners specifically: an off-by-one in either axis moves these first.
  for (const [x, y] of [
    [origin.x, origin.y],
    [origin.x + width - 1, origin.y],
    [origin.x, origin.y + height - 1],
    [origin.x + width - 1, origin.y + height - 1],
  ]) {
    assert.equal(surface.sample(x, y), expected(x, y), `corner ${x},${y}`);
  }
  // And nothing was written outside the region it was given.
  assert.equal(surface.sample(origin.x - 1, origin.y + 5), 0);
  assert.equal(surface.sample(origin.x + 5, origin.y - 1), 0);

  for (const patch of patches) surface.applyPatch(patch, "before");
  assert.deepEqual([...surface.readRegion({ ...origin, width: 2, height: 2 })], [0, 0, 0, 0]);
  assert.equal(surface.stats().residentTiles, 0, "restoring every patch leaves no tiles behind");
});

test("alpha writes fail before crossing their explicit memory ceiling", () => {
  const surface = new SparseAlphaSurface(2048, 2048, { memoryCeiling: 1024 });
  const address = surface.grid.address(0, 0);
  const noisy = new Uint8Array(address.width * address.height);
  for (let index = 0; index < noisy.length; index += 1) noisy[index] = index % 251;
  assert.throws(() => surface.writeTile(address.key, noisy), AlphaMemoryLimitError);
  assert.equal(surface.stats().residentBytes, 0);
});

test("multi-tile alpha refusals are transactional", () => {
  const memoryBound = new SparseAlphaSurface(512, 256, { memoryCeiling: 70 * 1024 });
  const noisy = new Uint8Array(512 * 256);
  for (let index = 0; index < noisy.length; index += 1) noisy[index] = index % 251;
  assert.throws(
    () => memoryBound.writeRegion({ x: 0, y: 0, width: 512, height: 256 }, noisy),
    AlphaMemoryLimitError,
  );
  assert.equal(memoryBound.stats().residentTiles, 0, "no first tile may leak through a rejected write");

  const recordBound = new SparseAlphaSurface(512, 256, { recordCeiling: 1 });
  assert.throws(
    () => recordBound.fillRect({ x: 0, y: 0, width: 512, height: 128 }, 255),
    AlphaMemoryLimitError,
  );
  assert.equal(recordBound.stats().residentTiles, 0, "record-limit refusal must leave alpha unchanged");
});

test("Magic Wand flood fill on a 50K document caches only nearby source tiles", () => {
  const doc = createDocument(50_000, 50_000);
  let reads = 0;
  selectByColorTiled(doc, {
    readRegion: (rect) => {
      reads += 1;
      const image = new ImageData(rect.width, rect.height);
      for (let y = 0; y < rect.height; y += 1) for (let x = 0; x < rect.width; x += 1) {
        const documentX = rect.x + x;
        const documentY = rect.y + y;
        const black = documentX >= 24_990 && documentX < 25_010 && documentY >= 24_990 && documentY < 25_010;
        const offset = (y * rect.width + x) * 4;
        image.data[offset] = black ? 0 : 255;
        image.data[offset + 1] = black ? 0 : 255;
        image.data[offset + 2] = black ? 0 : 255;
        image.data[offset + 3] = 255;
      }
      return image;
    },
  }, 25_000, 25_000, 0);
  const selection = selectionSurface(doc)!;
  assert.deepEqual(doc.selection?.bounds, { x: 24_990, y: 24_990, w: 20, h: 20 });
  assert.equal(selection.sample(25_000, 25_000), 255);
  assert.equal(selection.sample(25_020, 25_020), 0);
  assert.ok(reads <= 4, `Magic Wand read ${reads} tiles for a 20px island`);
  assert.ok(selection.stats().residentBytes < 128 * 1024);
});
