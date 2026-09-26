import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import { IDBObjectStore } from "fake-indexeddb";
import { IndexedDbTileBacking } from "../app/engine/tile-backing.ts";
import { PrecisionTileSurface } from "../app/engine/tile-store.ts";

const surface = () => new PrecisionTileSurface(48, 16, "rgba8", "srgb", 16);
const tile = (value: number) => new Uint8Array(16 * 16 * 4).fill(value);

test("disk snapshot remains immutable and acknowledges only committed revisions", () => {
  const s = surface(); s.store.write("0:0", tile(1));
  const snapshot = s.store.checkpointSnapshot();
  s.store.write("0:0", tile(2));
  assert.equal([...snapshot.tiles()][0].data![0], 1);
  snapshot.acknowledge();
  assert.equal(s.store.stats().dirtyTiles, 1);
  const latest = s.store.checkpointSnapshot();
  latest.acknowledge();
  assert.equal(s.store.stats().dirtyTiles, 0);
});

test("checkpoint, bounded tile read, region hydration and tombstones round trip", async () => {
  const backing = new IndexedDbTileBacking(), s = surface();
  s.store.write("0:0", tile(1)); s.store.write("2:0", tile(3));
  await backing.checkpoint("roundtrip", s, true);
  const manifest = (await backing.openSurface("roundtrip"))!;
  assert.deepEqual(manifest.tileKeys, ["0:0", "2:0"]);
  assert.equal((await backing.readTile(manifest, "2:0"))![0], 3);
  assert.equal(await backing.readTile(manifest, "1:0"), null);
  await assert.rejects(backing.readTile(manifest, "2:0", 1023), /allowance/);
  const restored = (await backing.restoreRegion("roundtrip", { x: 32, y: 0, width: 16, height: 16 }, 3072))!;
  assert.deepEqual([...restored.surface.store.keys()], ["2:0"]);
  assert.equal(restored.surface.store.stats().residentBytes, 1024);
  s.store.delete("2:0"); await backing.checkpoint("roundtrip", s);
  await assert.rejects(backing.readTile(manifest, "0:0"), /changed/);
  const current = (await backing.openSurface("roundtrip"))!;
  assert.equal(await backing.readTile(current, "2:0"), null);
  await backing.deleteSurface("roundtrip");
  assert.equal(await backing.openSurface("roundtrip"), null);
});

test("failed disk transaction preserves prior commit and dirty edits for retry", async () => {
  const backing = new IndexedDbTileBacking(), s = surface();
  s.store.write("0:0", tile(1)); await backing.checkpoint("failure", s, true);
  const before = (await backing.openSurface("failure"))!;
  s.store.write("0:0", tile(2)); s.store.write("1:0", tile(3));
  const put = IDBObjectStore.prototype.put;
  let writes = 0;
  IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) {
    if (this.name === "tiles" && ++writes === 2) throw new DOMException("Quota exhausted", "QuotaExceededError");
    return put.apply(this, args);
  };
  try { await assert.rejects(backing.checkpoint("failure", s), /Quota/); }
  finally { IDBObjectStore.prototype.put = put; }
  assert.equal(s.store.stats().dirtyTiles, 2);
  assert.equal((await backing.openSurface("failure"))!.commitId, before.commitId);
  assert.equal((await backing.readTile(before, "0:0"))![0], 1);
  await backing.checkpoint("failure", s);
  assert.equal(s.store.stats().dirtyTiles, 0);
  const after = (await backing.openSurface("failure"))!;
  assert.equal((await backing.readTile(after, "0:0"))![0], 2);
  assert.equal((await backing.readTile(after, "1:0"))![0], 3);
});

test("50K sparse surface hydrates a bounded region, not its entire logical extent", async () => {
  const backing = new IndexedDbTileBacking();
  const s = new PrecisionTileSurface(50_000, 50_000, "rgba8", "srgb", 256);
  s.store.write("0:0", new Uint8Array(256 * 256 * 4).fill(5));
  await backing.checkpoint("extreme", s, true);
  await assert.rejects(backing.restore("extreme"), /hydration memory ceiling/);
  const region = (await backing.restoreRegion("extreme", { x: 0, y: 0, width: 256, height: 256 }, 1024 * 1024))!;
  assert.equal(region.surface.store.stats().residentBytes, 256 * 256 * 4);
  assert.equal(region.surface.store.read("0:0")![0], 5);
});

test("edits arriving during checkpoint stay dirty and subsequent commits keep them", async () => {
  const backing = new IndexedDbTileBacking(), s = surface();
  s.store.write("0:0", tile(1));
  const put = IDBObjectStore.prototype.put;
  let changed = false;
  IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) {
    if (this.name === "tiles" && !changed) { changed = true; s.store.write("0:0", tile(9)); }
    return put.apply(this, args);
  };
  try { await backing.checkpoint("concurrent", s, true); }
  finally { IDBObjectStore.prototype.put = put; }
  const first = (await backing.openSurface("concurrent"))!;
  assert.equal((await backing.readTile(first, "0:0"))![0], 1);
  assert.equal(s.store.stats().dirtyTiles, 1);
  await backing.checkpoint("concurrent", s);
  assert.equal((await backing.readTile((await backing.openSurface("concurrent"))!, "0:0"))![0], 9);
  assert.equal(s.store.stats().dirtyTiles, 0);
});

test("missing committed tiles are errors, not silently transparent pixels", async () => {
  const backing = new IndexedDbTileBacking(), s = surface();
  s.store.write("0:0", tile(4)); await backing.checkpoint("missing", s, true);
  const manifest = (await backing.openSurface("missing"))!;
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("luma-tile-cache", 1);
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("tiles", "readwrite");
    tx.objectStore("tiles").delete("missing|0:0");
    tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
  });
  db.close();
  await assert.rejects(backing.readTile(manifest, "0:0"), /Missing committed/);
});

test("rapid replacement surfaces coalesce to the latest disk checkpoint", async () => {
  const backing = new IndexedDbTileBacking(), first = surface();
  first.store.write("0:0", tile(1));
  const put = IDBObjectStore.prototype.put;
  let queued = false;
  const promises: Promise<void>[] = [];
  IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) {
    if (this.name === "tiles" && !queued) {
      queued = true;
      for (let i = 2; i <= 100; i++) {
        const next = surface(); next.store.write("1:0", tile(i));
        promises.push(backing.checkpoint("coalesced", next));
      }
    }
    return put.apply(this, args);
  };
  try { await backing.checkpoint("coalesced", first, true); await Promise.all(promises); }
  finally { IDBObjectStore.prototype.put = put; }
  const manifest = (await backing.openSurface("coalesced"))!;
  assert.equal(backing.stats().writes, 2, "one in-flight write plus latest replacement, not 100 surfaces");
  assert.equal(await backing.readTile(manifest, "0:0"), null);
  assert.equal((await backing.readTile(manifest, "1:0"))![0], 100);
});

test("delete is a barrier before a subsequent checkpoint of the same id", async () => {
  const backing = new IndexedDbTileBacking(), first = surface(), next = surface();
  first.store.write("0:0", tile(1)); next.store.write("2:0", tile(7));
  const a = backing.checkpoint("barrier", first, true);
  const b = backing.deleteSurface("barrier");
  const c = backing.checkpoint("barrier", next, true);
  await Promise.all([a, b, c]);
  const manifest = (await backing.openSurface("barrier"))!;
  assert.deepEqual(manifest.tileKeys, ["2:0"]);
  assert.equal((await backing.readTile(manifest, "2:0"))![0], 7);
});
