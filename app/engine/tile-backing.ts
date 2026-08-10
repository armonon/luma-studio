import { DirtyTile, PixelFormat, PrecisionTileSurface } from "./tile-store";
import type { WorkingColorSpace } from "./color";

const DATABASE_NAME = "luma-tile-cache";
const DATABASE_VERSION = 1;

type StoredSurface = {
  id: string;
  width: number;
  height: number;
  tileSize: number;
  format: PixelFormat;
  colorSpace: WorkingColorSpace;
  revision: number;
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
    const dirty = replace
      ? surface.store.entries().map(({ key, data }) => ({ key, data, deleted: false, revision: surface.store.revisionFor(key) }))
      : surface.store.drainDirty();
    if (!dirty.length && !replace) return;
    const previous = this.queues.get(surfaceId) ?? Promise.resolve();
    const task = previous.catch(() => undefined).then(() => this.writeCheckpoint(surfaceId, surface, dirty, replace));
    this.queues.set(surfaceId, task);
    try {
      await task;
    } finally {
      if (this.queues.get(surfaceId) === task) this.queues.delete(surfaceId);
    }
  }

  private async writeCheckpoint(
    surfaceId: string,
    surface: PrecisionTileSurface,
    dirty: DirtyTile[],
    replace: boolean,
  ) {
    try {
      const database = await this.database();
      const transaction = database.transaction(["surfaces", "tiles"], "readwrite");
      const stats = surface.stats();
      const manifest: StoredSurface = {
        id: surfaceId,
        width: surface.grid.width,
        height: surface.grid.height,
        tileSize: surface.grid.tileSize,
        format: surface.format,
        colorSpace: surface.colorSpace,
        revision: stats.revision,
        updatedAt: Date.now(),
      };
      transaction.objectStore("surfaces").put(manifest);
      const tiles = transaction.objectStore("tiles");
      if (replace) {
        const existing = await requestValue(tiles.index("surfaceId").getAllKeys(surfaceId));
        for (const key of existing) tiles.delete(key);
      }
      for (const tile of dirty) {
        const id = `${surfaceId}|${tile.key}`;
        if (tile.deleted) tiles.delete(id);
        else if (tile.data) {
          const data = tile.data.buffer.slice(tile.data.byteOffset, tile.data.byteOffset + tile.data.byteLength) as ArrayBuffer;
          const record: StoredTile = { id, surfaceId, key: tile.key, revision: tile.revision, data };
          tiles.put(record);
          this.bytesWritten += data.byteLength;
        }
      }
      await transactionDone(transaction);
      this.writes += dirty.length;
    } catch (error) {
      this.failures += 1;
      throw error;
    }
  }

  async restore(surfaceId: string) {
    const database = await this.database();
    const transaction = database.transaction(["surfaces", "tiles"], "readonly");
    const manifest = await requestValue(transaction.objectStore("surfaces").get(surfaceId)) as StoredSurface | undefined;
    if (!manifest) return null;
    const records = await requestValue(transaction.objectStore("tiles").index("surfaceId").getAll(surfaceId)) as StoredTile[];
    await transactionDone(transaction);
    return PrecisionTileSurface.fromTiles(
      manifest.width,
      manifest.height,
      manifest.format,
      manifest.colorSpace,
      manifest.tileSize,
      records.map((record) => ({ key: record.key, data: new Uint8Array(record.data) })),
    );
  }

  async deleteSurface(surfaceId: string) {
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
