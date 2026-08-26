const AUTOSAVE_FILE = "luma-recovery.luma";
const WORKSPACE_KEY = "luma-recovery-workspace/v2";
const DB_NAME = "luma-studio";
const STORE_NAME = "recovery";

type StorageWithDirectory = StorageManager & {
  getDirectory?: () => Promise<FileSystemDirectoryHandle>;
};

async function opfsRoot() {
  return (navigator.storage as StorageWithDirectory).getDirectory?.() ?? null;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbPutValue(value: unknown, key: IDBValidKey) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function idbUpdateValue<T>(key: IDBValidKey, update: (current: T | null) => T | null) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(key);
    request.onsuccess = () => {
      try {
        const next = update((request.result as T | undefined) ?? null);
        if (next === null) store.delete(key);
        else store.put(next, key);
      } catch (error) {
        tx.abort();
        reject(error);
      }
    };
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("Recovery transaction was aborted"));
  });
  db.close();
}

async function idbGet(): Promise<Blob | null> {
  const db = await openDb();
  const value = await new Promise<Blob | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(AUTOSAVE_FILE);
    request.onsuccess = () => resolve(request.result as Blob | undefined);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return value ?? null;
}

async function idbGetValue<T>(key: IDBValidKey): Promise<T | null> {
  const db = await openDb();
  const value = await new Promise<T | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return value ?? null;
}

export type RecoveryWorkspaceDocument = {
  id: string;
  name: string;
  active: boolean;
  blob: Blob;
  updatedAt: number;
};

export function normalizeRecoveryWorkspace(value: unknown): RecoveryWorkspaceDocument[] {
  if (!value || typeof value !== "object") return [];
  const documents = (value as { documents?: unknown }).documents;
  if (!Array.isArray(documents)) return [];
  const result = documents.flatMap((entry): RecoveryWorkspaceDocument[] => {
    if (!entry || typeof entry !== "object") return [];
    const candidate = entry as Partial<RecoveryWorkspaceDocument>;
    if (typeof candidate.id !== "string" || !candidate.id || typeof candidate.name !== "string" ||
        !(candidate.blob instanceof Blob)) return [];
    return [{
      id: candidate.id,
      name: candidate.name || "Untitled",
      active: candidate.active === true,
      blob: candidate.blob,
      updatedAt: typeof candidate.updatedAt === "number" && Number.isFinite(candidate.updatedAt) ? candidate.updatedAt : 0,
    }];
  });
  // A corrupt manifest must not create multiple active tabs.
  const activeIndex = result.findIndex((document) => document.active);
  return result.map((document, index) => ({ ...document, active: index === (activeIndex < 0 ? 0 : activeIndex) }));
}

export async function writeRecovery(blob: Blob) {
  const root = await opfsRoot();
  if (!root) return idbPutValue(blob, AUTOSAVE_FILE);
  const handle = await root.getFileHandle(AUTOSAVE_FILE, { create: true });
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
}

/** Atomically records every open tab so recovery restores the whole workspace. */
export async function writeRecoveryWorkspace(documents: Array<Omit<RecoveryWorkspaceDocument, "updatedAt"> & { updatedAt?: number }>) {
  const now = Date.now();
  const normalized = normalizeRecoveryWorkspace({
    documents: documents.map((document) => ({ ...document, updatedAt: document.updatedAt ?? now })),
  });
  if (!normalized.length) return;
  await idbPutValue({ version: 2, documents: normalized }, WORKSPACE_KEY);
}

/**
 * Transactionally replaces one document checkpoint while retaining the other
 * tabs. Routine autosave uses this path so a brush stroke in one tab never
 * recompresses every open project at once.
 */
export async function writeRecoveryDocument(document: Omit<RecoveryWorkspaceDocument, "updatedAt"> & { updatedAt?: number }) {
  const updatedAt = document.updatedAt ?? Date.now();
  const normalized = normalizeRecoveryWorkspace({ documents: [{ ...document, updatedAt }] })[0];
  if (!normalized) throw new Error("Invalid recovery document checkpoint");
  await idbUpdateValue<{ version?: number; documents?: unknown }>(WORKSPACE_KEY, (current) => {
    const retained = normalizeRecoveryWorkspace(current).filter((entry) => entry.id !== normalized.id);
    if (normalized.active) {
      for (const entry of retained) entry.active = false;
    }
    return {
      version: 2,
      documents: normalizeRecoveryWorkspace({ documents: [...retained, normalized] }),
    };
  });
}

/** Removes a closed tab from crash recovery without rewriting its project blob. */
export async function removeRecoveryDocument(id: string) {
  if (!id) return;
  await idbUpdateValue<{ version?: number; documents?: unknown }>(WORKSPACE_KEY, (current) => {
    const retained = normalizeRecoveryWorkspace(current).filter((entry) => entry.id !== id);
    if (!retained.length) return null;
    return { version: 2, documents: retained };
  });
}

export async function readRecoveryWorkspace(): Promise<RecoveryWorkspaceDocument[]> {
  try {
    const workspace = normalizeRecoveryWorkspace(await idbGetValue<unknown>(WORKSPACE_KEY));
    if (workspace.length) return workspace;
  } catch {
    // Fall through to the legacy single-document recovery file.
  }
  const legacy = await readRecovery();
  return legacy ? [{ id: "legacy", name: "Recovered project", active: true, blob: legacy, updatedAt: 0 }] : [];
}

export async function readRecovery(): Promise<Blob | null> {
  const root = await opfsRoot();
  if (!root) return idbGet();
  try {
    const handle = await root.getFileHandle(AUTOSAVE_FILE);
    return await handle.getFile();
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError") return null;
    throw error;
  }
}
