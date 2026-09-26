import { PixelFormat, PrecisionTileSurface, TileGrid, type PixelRect, type SparseTileStore } from "./tile-store";
import type { WorkingColorSpace } from "./color";

const DATABASE_NAME = "luma-tile-cache";
const DATABASE_VERSION = 1;

export type StoredSurface = {
  id: string;
  width: number;
  height: number;
  tileSize: number;
  format: PixelFormat;
  colorSpace: WorkingColorSpace;
  revision: number;
  commitId: string;
  tileKeys: string[];
  updatedAt: number;
};

type StoredTile = {
  id: string;
  surfaceId: string;
  key: string;
  revision: number;
  data: ArrayBuffer;
};

function requestValue<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
  });
}

/** Device-local performance cache. `.luma` remains the authoritative project format. */
export class IndexedDbTileBacking {
  private databasePromise: Promise<IDBDatabase> | null = null;
  private writes = 0;
  private bytesWritten = 0;
  private failures = 0;
  private queues = new Map<string, Promise<void>>();
  private checkpoints = new Map<string, {
    surface: PrecisionTileSurface | undefined;
    latestSurface: PrecisionTileSurface;
    replace: boolean;
    task: Promise<void>;
  }>();

  static supported() {
    return typeof indexedDB !== "undefined";
  }

  private database() {
    if (!this.databasePromise) {
      this.databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
        request.onupgradeneeded = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains("surfaces")) database.createObjectStore("surfaces", { keyPath: "id" });
          if (!database.objectStoreNames.contains("tiles")) {
            const tiles = database.createObjectStore("tiles", { keyPath: "id" });
            tiles.createIndex("surfaceId", "surfaceId", { unique: false });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("Tile cache could not be opened"));
      });
    }
    return this.databasePromise;
  }

  async checkpoint(surfaceId: string, surface: PrecisionTileSurface, replace = false) {
    const pending = this.checkpoints.get(surfaceId);
    if (pending) {
      pending.replace ||= replace || pending.latestSurface !== surface;
      pending.surface = surface;
      pending.latestSurface = surface;
      return pending.task;
    }
    const previous = this.queues.get(surfaceId) ?? Promise.resolve();
    const job = { surface: surface as PrecisionTileSurface | undefined, latestSurface: surface, replace, task: Promise.resolve() };
    const task = previous.catch(() => undefined).then(async () => {
      // Coalesce queued replacements to one latest surface; even zero-copy
      // snapshots would leak memory if every obsolete surface stayed queued.
      try {
        while (job.surface) {
          const current = job.surface, replaceCurrent = job.replace;
          job.surface = undefined; job.replace = false;
          const snapshot = current.store.checkpointSnapshot(replaceCurrent);
          if (!snapshot.size && !replaceCurrent) continue;
          await this.writeCheckpoint(surfaceId, current, snapshot, replaceCurrent);
          snapshot.acknowledge();
        }
      } finally {
        // Stop accepting work before resolving the task. A checkpoint queued
        // in the intervening microtask must start a new job, not join a loop
        // that has already exited and silently lose its pending surface.
        if (this.checkpoints.get(surfaceId) === job) this.checkpoints.delete(surfaceId);
      }
    });
    job.task = task;
    this.checkpoints.set(surfaceId, job);
    this.queues.set(surfaceId, task);
    try {
      await task;
    } finally {
      if (this.queues.get(surfaceId) === task) this.queues.delete(surfaceId);
      if (this.checkpoints.get(surfaceId) === job) this.checkpoints.delete(surfaceId);
    }
  }

  private async writeCheckpoint(
    surfaceId: string,
    surface: PrecisionTileSurface,
    snapshot: ReturnType<SparseTileStore["checkpointSnapshot"]>,
    replace: boolean,
  ) {
    let transaction: IDBTransaction | undefined;
    let done: Promise<void> | undefined;
    try {
      const database = await this.database();
      transaction = database.transaction(["surfaces", "tiles"], "readwrite");
      done = transactionDone(transaction);
      void done.catch(() => undefined); // handled below even if a request rejects first
      const manifest: StoredSurface = {
        id: surfaceId,
        width: surface.grid.width,
        height: surface.grid.height,
        tileSize: surface.grid.tileSize,
        format: surface.format,
        colorSpace: surface.colorSpace,
        revision: snapshot.revision,
        commitId: crypto.randomUUID(),
        tileKeys: snapshot.keys,
        updatedAt: Date.now(),
      };
      transaction.objectStore("surfaces").put(manifest);
      const tiles = transaction.objectStore("tiles");
      if (replace) {
        const existing = await requestValue(tiles.index("surfaceId").getAllKeys(surfaceId));
        for (const key of existing) tiles.delete(key);
      }
      let written = 0, bytesWritten = 0;
      for (const tile of snapshot.tiles()) {
        const id = `${surfaceId}|${tile.key}`;
        if (tile.deleted) tiles.delete(id);
        else if (tile.data) {
          const data = tile.data.buffer as ArrayBuffer;
          const record: StoredTile = { id, surfaceId, key: tile.key, revision: tile.revision, data };
          // Await each request: only one structured-cloned tile is pending,
          // while all puts still commit atomically in this transaction.
          await requestValue(tiles.put(record));
          bytesWritten += data.byteLength;
        }
        written++;
      }
      await done;
      this.writes += written;
      this.bytesWritten += bytesWritten;
    } catch (error) {
      try { transaction?.abort(); } catch { /* already aborted/completed */ }
      await done?.catch(() => undefined);
      this.failures += 1;
      throw error;
    }
  }

  /** Open metadata only. Pixel IO is explicitly requested and revision-checked. */
  async openSurface(surfaceId: string) {
    const database = await this.database();
    const transaction = database.transaction("surfaces", "readonly");
    const manifest = await requestValue(transaction.objectStore("surfaces").get(surfaceId)) as StoredSurface | undefined;
    if (!manifest) return null;
    const grid = new TileGrid(manifest.width, manifest.height, manifest.tileSize);
    if (!["rgba8", "rgba16f", "rgba32f"].includes(manifest.format) || !Number.isSafeInteger(manifest.revision) || manifest.revision < 0) throw new Error("Invalid stored tile manifest");
    if (typeof manifest.commitId !== "string" || !Array.isArray(manifest.tileKeys) || manifest.tileKeys.length > 1_000_000 || new Set(manifest.tileKeys).size !== manifest.tileKeys.length) throw new Error("Stored tile manifest needs a fresh checkpoint");
    for (const key of manifest.tileKeys) grid.parseKey(key);
    return manifest;
  }

  /** Reject mixed revisions, corrupt payloads and oversize reads before use. */
  async readTile(manifest: StoredSurface, key: string, maximumBytes = 1024 * 1024) {
    const grid = new TileGrid(manifest.width, manifest.height, manifest.tileSize);
    const expected = grid.byteLength(grid.parseKey(key), manifest.format);
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < expected || maximumBytes > 512 * 1024 * 1024) throw new Error("Disk tile read exceeds its memory allowance");
    const database = await this.database();
    const transaction = database.transaction(["surfaces", "tiles"], "readonly");
    const current = await requestValue(transaction.objectStore("surfaces").get(manifest.id)) as StoredSurface | undefined;
    if (!current || current.commitId !== manifest.commitId || current.revision !== manifest.revision || current.width !== manifest.width || current.height !== manifest.height || current.format !== manifest.format || current.tileSize !== manifest.tileSize || current.colorSpace !== manifest.colorSpace) throw new Error("Disk surface changed; reopen before reading pixels");
    if (!manifest.tileKeys.includes(key)) return null;
    const record = await requestValue(transaction.objectStore("tiles").get(`${manifest.id}|${key}`)) as StoredTile | undefined;
    if (!record) throw new Error("Missing committed disk tile");
    if (record.surfaceId !== manifest.id || record.key !== key || record.revision > manifest.revision || !(record.data instanceof ArrayBuffer) || record.data.byteLength !== expected) throw new Error("Corrupt disk tile payload");
    return new Uint8Array(record.data);
  }

  /** Explicit bounded hydration. It never reads all persisted tiles implicitly. */
  async restoreRegion(surfaceId: string, region?: PixelRect, maximumBytes = 64 * 1024 * 1024) {
    const manifest = await this.openSurface(surfaceId);
    if (!manifest) return null;
    const grid = new TileGrid(manifest.width, manifest.height, manifest.tileSize);
    const rect = region ?? { x: 0, y: 0, width: grid.width, height: grid.height };
    if (!Object.values(rect).every(Number.isFinite) || rect.width < 0 || rect.height < 0 || !Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > 512 * 1024 * 1024) throw new Error("Invalid disk hydration bounds");
    const left = Math.max(0, Math.floor(rect.x / grid.tileSize)), top = Math.max(0, Math.floor(rect.y / grid.tileSize));
    const right = Math.min(grid.columns, Math.ceil((rect.x + rect.width) / grid.tileSize));
    const bottom = Math.min(grid.rows, Math.ceil((rect.y + rect.height) / grid.tileSize));
    const tileBytes = grid.tileSize ** 2 * (manifest.format === "rgba8" ? 4 : manifest.format === "rgba16f" ? 8 : 16);
    // Include one owned read and the store's defensive copy, before allocating
    // either the address list or any pixel payload.
    const estimate = (Math.max(0, right - left) * Math.max(0, bottom - top) + 2) * tileBytes;
    if (!Number.isSafeInteger(estimate) || estimate > maximumBytes) throw new Error("Disk surface region exceeds the hydration memory ceiling");
    const surface = new PrecisionTileSurface(grid.width, grid.height, manifest.format, manifest.colorSpace, grid.tileSize, maximumBytes);
    for (const address of grid.tilesIntersecting(rect)) {
      const data = await this.readTile(manifest, address.key, maximumBytes);
      if (data) surface.store.write(address.key, data);
    }
    return { surface, region: rect, revision: manifest.revision };
  }

  async restore(surfaceId: string) {
    return (await this.restoreRegion(surfaceId))?.surface ?? null;
  }

  async deleteSurface(surfaceId: string) {
    // Deletion is an ordering barrier: later checkpoints must not coalesce
    // into the job that is about to be deleted.
    this.checkpoints.delete(surfaceId);
    const previous = this.queues.get(surfaceId) ?? Promise.resolve();
    const task = previous.catch(() => undefined).then(() => this.deleteSurfaceNow(surfaceId));
    this.queues.set(surfaceId, task);
    try {
      await task;
    } finally {
      if (this.queues.get(surfaceId) === task) this.queues.delete(surfaceId);
    }
  }

  private async deleteSurfaceNow(surfaceId: string) {
    const database = await this.database();
    const read = database.transaction("tiles", "readonly");
    const records = await requestValue(read.objectStore("tiles").index("surfaceId").getAllKeys(surfaceId));
    await transactionDone(read);
    const write = database.transaction(["surfaces", "tiles"], "readwrite");
    write.objectStore("surfaces").delete(surfaceId);
    for (const key of records) write.objectStore("tiles").delete(key);
    await transactionDone(write);
  }

  stats() {
    return { supported: IndexedDbTileBacking.supported(), writes: this.writes, bytesWritten: this.bytesWritten, failures: this.failures };
  }
}
