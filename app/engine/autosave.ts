const AUTOSAVE_FILE = "luma-recovery.luma";
const WORKSPACE_KEY = "luma-recovery-workspace/v3";
const LEGACY_WORKSPACE_KEY = "luma-recovery-workspace/v2";
const PAYLOAD_PREFIX = "luma-recovery-payload/";
const LEGACY_PAYLOAD_PREFIX = "legacy-v2/";
const DISCARD_KEY = "luma-recovery-disposition/v1";
const DB_NAME = "luma-studio";
const STORE_NAME = "recovery";
// Synchronous tombstones also cover a write already waiting for IndexedDB.
// Document IDs are never reused within a running workspace.
const closedDocuments = new Set<string>();
let recoveryExitPending = false;
let recoveryExitError: Error | null = null;

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
  try { await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Recovery transaction failed or was aborted"));
    tx.onabort = () => reject(tx.error ?? new Error("Recovery transaction was aborted"));
  }); } finally { db.close(); }
}

async function idbUpdateValue<T>(key: IDBValidKey, update: (current: T | null, store: IDBObjectStore) => T | null) {
  const db = await openDb();
  try { await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(key);
    request.onsuccess = () => {
      try {
        const current = (request.result as T | undefined) ?? null;
        const next = update(current, store);
        if (next === current) return;
        if (next === null) store.delete(key);
        else store.put(next, key);
      } catch (error) {
        try { tx.abort(); } catch { /* The failing request may already have aborted it. */ }
        reject(new Error(`Recovery transaction failed or was aborted: ${error instanceof Error ? error.message : String(error)}`, { cause: error }));
      }
    };
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Recovery transaction failed or was aborted"));
    tx.onabort = () => reject(tx.error ?? new Error("Recovery transaction was aborted"));
  }); } finally { db.close(); }
}

async function idbGet(): Promise<Blob | null> {
  return idbGetValue<Blob>(AUTOSAVE_FILE);
}

async function idbGetValue<T>(key: IDBValidKey): Promise<T | null> {
  const db = await openDb();
  try { return await new Promise<T | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(key);
    // A successful request does not mean its transaction committed.
    tx.oncomplete = () => resolve((request.result as T | undefined) ?? null);
    request.onerror = () => reject(request.error);
    tx.onerror = () => reject(tx.error ?? new Error("Recovery read failed or was aborted"));
    tx.onabort = () => reject(tx.error ?? new Error("Recovery read was aborted"));
  }); } finally { db.close(); }
}

export type RecoveryWorkspaceDocument = {
  id: string;
  name: string;
  active: boolean;
  /** Stored only in the local recovery index, never inside the portable project archive. */
  nativePath?: string;
  /** Restored so crash-recovered edits still participate in close/quit protection. */
  dirty: boolean;
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
      nativePath: typeof candidate.nativePath === "string" && candidate.nativePath.length <= 4096
        ? candidate.nativePath
        : undefined,
      dirty: candidate.dirty === true,
      blob: candidate.blob,
      updatedAt: typeof candidate.updatedAt === "number" && Number.isFinite(candidate.updatedAt) ? candidate.updatedAt : 0,
    }];
  });
  // A corrupt manifest must not create multiple active tabs.
  const activeIndex = result.findIndex((document) => document.active);
  return result.map((document, index) => ({ ...document, active: index === (activeIndex < 0 ? 0 : activeIndex) }));
}

function checkedRecoveryWorkspace(stored: unknown): RecoveryWorkspaceDocument[] {
  if (stored === null) return [];
  const workspace = normalizeRecoveryWorkspace(stored);
  const documents = typeof stored === "object" && stored ? (stored as { documents?: unknown }).documents : undefined;
  if (!Array.isArray(documents) || documents.length !== workspace.length ||
      new Set(workspace.map(document => document.id)).size !== workspace.length) {
    throw new Error("The recovery workspace is damaged. Its stored checkpoints have not been changed.");
  }
  return workspace;
}

type StoredDocument = Omit<RecoveryWorkspaceDocument, "blob"> & { blobKey: string; previousBlobKey?: string };

function checkedStoredWorkspace(stored: unknown): StoredDocument[] {
  if (stored === null) return [];
  const documents = typeof stored === "object" && stored ? (stored as { documents?: unknown }).documents : undefined;
  if (!Array.isArray(documents) || documents.some(entry => !entry || typeof entry !== "object" ||
      typeof entry.id !== "string" || !entry.id || typeof entry.name !== "string" ||
      typeof entry.blobKey !== "string" || !(entry.blobKey.startsWith(PAYLOAD_PREFIX) || entry.blobKey.startsWith(LEGACY_PAYLOAD_PREFIX)) ||
      (entry.previousBlobKey !== undefined && (typeof entry.previousBlobKey !== "string" || !entry.previousBlobKey.startsWith(PAYLOAD_PREFIX)))) ||
      new Set(documents.map(entry => entry.id)).size !== documents.length) {
    throw new Error("The recovery workspace is damaged. Its stored checkpoints have not been changed.");
  }
  const active = Math.max(0, documents.findIndex(entry => entry.active === true));
  return documents.map((entry, index) => ({
    id: entry.id, name: entry.name, blobKey: entry.blobKey, previousBlobKey: entry.previousBlobKey,
    active: index === active, dirty: entry.dirty === true,
    nativePath: typeof entry.nativePath === "string" && entry.nativePath.length <= 4096 ? entry.nativePath : undefined,
    updatedAt: typeof entry.updatedAt === "number" && Number.isFinite(entry.updatedAt) ? entry.updatedAt : 0,
  }));
}

async function updateWorkspace(update: (documents: StoredDocument[], store: IDBObjectStore) => StoredDocument[] | null) {
  // Keep the old Blob-bearing index immutable during migration. New metadata
  // references its payloads until those documents receive fresh checkpoints.
  const legacy = checkedRecoveryWorkspace(await idbGetValue(LEGACY_WORKSPACE_KEY));
  await idbUpdateValue(WORKSPACE_KEY, (current, store) => {
    const previous: StoredDocument[] = current === null ? legacy.map(entry => ({ ...storedMetadata(entry), blobKey: `${LEGACY_PAYLOAD_PREFIX}${entry.id}` })) : checkedStoredWorkspace(current);
    const next = update(previous, store);
    if (next === null) return current;
    const retained = new Set(next.flatMap(entry => [entry.blobKey, entry.previousBlobKey]));
    for (const entry of previous) for (const key of [entry.blobKey, entry.previousBlobKey]) {
      if (key?.startsWith(PAYLOAD_PREFIX) && !retained.has(key)) store.delete(key);
    }
    if (!next.some(entry => entry.blobKey.startsWith(LEGACY_PAYLOAD_PREFIX))) store.delete(LEGACY_WORKSPACE_KEY);
    return { version: 3, documents: next };
  });
}

function storedMetadata(document: Omit<RecoveryWorkspaceDocument, "blob">) {
  return { id: document.id, name: document.name, active: document.active, dirty: document.dirty,
    nativePath: document.nativePath, updatedAt: document.updatedAt };
}

function storeCheckpoint(store: IDBObjectStore, document: RecoveryWorkspaceDocument, previous?: StoredDocument): StoredDocument {
  const blobKey = `${PAYLOAD_PREFIX}${crypto.randomUUID()}`;
  // Only newly encoded payloads are written. Existing Blobs never participate
  // in index mutations/aborts. Keep one prior payload, bounded per open tab.
  store.put(document.blob, blobKey);
  return { ...storedMetadata(document), blobKey,
    previousBlobKey: previous?.blobKey.startsWith(PAYLOAD_PREFIX) ? previous.blobKey : undefined };
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
  if (recoveryExitError) throw recoveryExitError;
  if (recoveryExitPending) return;
  const now = Date.now();
  const normalized = normalizeRecoveryWorkspace({
    documents: documents.map((document) => ({ ...document, updatedAt: document.updatedAt ?? now })),
  });
  if (!normalized.length) return;
  await updateWorkspace((previous, store) => {
    if (recoveryExitPending) return null;
    const next = normalized.filter(document => !closedDocuments.has(document.id)).map(document => {
      const old = previous.find(entry => entry.id === document.id);
      return old && old.updatedAt > document.updatedAt ? old : storeCheckpoint(store, document, old);
    });
    return next;
  });
}

/**
 * Transactionally replaces one document checkpoint while retaining the other
 * tabs. Routine autosave uses this path so a brush stroke in one tab never
 * recompresses every open project at once.
 */
export async function writeRecoveryDocument(document: Omit<RecoveryWorkspaceDocument, "updatedAt"> & { updatedAt?: number }, isCurrent: () => boolean = () => true) {
  if (recoveryExitError) throw recoveryExitError;
  if (recoveryExitPending) return;
  const updatedAt = document.updatedAt ?? Date.now();
  const normalized = normalizeRecoveryWorkspace({ documents: [{ ...document, updatedAt }] })[0];
  if (!normalized) throw new Error("Invalid recovery document checkpoint");
  await updateWorkspace((workspace, store) => {
    if (recoveryExitPending || closedDocuments.has(document.id) || !isCurrent()) return null;
    const previous = workspace.find(entry => entry.id === normalized.id);
    if (previous && previous.updatedAt > normalized.updatedAt) return null;
    const retained = workspace.filter((entry) => entry.id !== normalized.id);
    if (normalized.active) {
      for (const entry of retained) entry.active = false;
    }
    return [...retained, storeCheckpoint(store, normalized, previous)];
  });
}

/** Removes a closed tab from crash recovery without rewriting its project blob. */
export async function removeRecoveryDocument(id: string) {
  if (!id) return;
  closedDocuments.add(id);
  await updateWorkspace((workspace) => {
    if (recoveryExitPending) return null;
    const retained = workspace.filter((entry) => entry.id !== id);
    // An authoritative empty workspace is different from "never migrated".
    // Deleting the index can resurrect an obsolete legacy recovery file.
    return retained;
  });
}

/**
 * Whole-app Don't Save: remove only the explicitly discarded tabs in one
 * durable transaction. Synchronous tombstones suppress in-flight checkpoints.
 * The returned compensation is used if native termination itself fails.
 */
export async function discardRecoveryDocuments(ids: readonly string[]) {
  if (recoveryExitPending) throw new Error("A recovery disposition is already pending");
  recoveryExitPending = true;
  const targets = new Set(ids.filter(Boolean));
  const added = [...targets].filter(id => !closedDocuments.has(id));
  const unblock = () => { for (const id of added) closedDocuments.delete(id); recoveryExitPending = false; recoveryExitError = null; };
  for (const id of added) closedDocuments.add(id);
  let previous: unknown = null;
  try {
    await idbUpdateValue(DISCARD_KEY, current => {
      previous = current;
      return { version: 1, ids: [...new Set([...checkedDisposition(current), ...targets])] };
    });
  } catch (error) {
    unblock(); // A failed discard must not disable future crash recovery.
    throw error;
  }
  return async () => {
    try {
      // Compensation changes only metadata: no Blob deletion/re-cloning.
      await idbUpdateValue(DISCARD_KEY, () => previous);
      unblock();
    } catch (error) {
      // Keep checkpoints paused if disposition could not be reversed. A new
      // explicit Save remains available; do not silently rewrite excluded work.
      recoveryExitError = new Error("Recovery is paused after a failed quit rollback. Save your project files and restart Luma before continuing.");
      throw error;
    }
  };
}

function checkedDisposition(value: unknown): string[] {
  if (value === null) return [];
  const ids = typeof value === "object" && value ? (value as { ids?: unknown }).ids : undefined;
  if (!Array.isArray(ids) || ids.some(id => typeof id !== "string" || !id)) {
    throw new Error("Recovery discard information is damaged. Stored checkpoints have not been changed.");
  }
  return ids;
}

/** Startup-only garbage collection. A failure retains the exclusion record. */
export async function finalizePreviousDiscard() {
  const disposition = await idbGetValue(DISCARD_KEY);
  if (disposition !== null) {
    const ids = new Set(checkedDisposition(disposition));
    await updateWorkspace((workspace, store) => {
      const retained = workspace.filter(entry => !ids.has(entry.id));
      store.delete(DISCARD_KEY);
      // Also clean the rollback buffer used by an intermediate review build.
      store.delete("luma-recovery-discard-rollback/v1");
      return retained;
    });
  }
  recoveryExitPending = false;
  recoveryExitError = null;
}

export async function readRecoveryWorkspace(): Promise<RecoveryWorkspaceDocument[]> {
  const disposition = await idbGetValue(DISCARD_KEY);
  const excluded = new Set(checkedDisposition(disposition));
  const stored = await idbGetValue<unknown>(WORKSPACE_KEY);
  if (stored !== null) {
    const workspace = checkedStoredWorkspace(stored).filter(entry => !excluded.has(entry.id));
    let legacy: RecoveryWorkspaceDocument[] | undefined;
    const result: RecoveryWorkspaceDocument[] = [];
    for (const entry of workspace) {
      let blob: unknown;
      if (entry.blobKey.startsWith(LEGACY_PAYLOAD_PREFIX)) {
        legacy ??= checkedRecoveryWorkspace(await idbGetValue(LEGACY_WORKSPACE_KEY));
        blob = legacy.find(doc => doc.id === entry.blobKey.slice(LEGACY_PAYLOAD_PREFIX.length))?.blob;
      } else blob = await idbGetValue(entry.blobKey);
      if (!(blob instanceof Blob)) throw new Error(`Recovery payload is missing for “${entry.name}”. Stored checkpoints have not been changed.`);
      result.push({ ...storedMetadata(entry), blob });
    }
    return normalizeRecoveryWorkspace({ documents: result });
  }
  const legacyWorkspace = await idbGetValue(LEGACY_WORKSPACE_KEY);
  if (legacyWorkspace !== null) {
    // Quit may happen before an older workspace receives its first v3
    // checkpoint. Apply the same per-document disposition to v2 rather than
    // hiding clean tabs along with the explicitly discarded ones.
    return normalizeRecoveryWorkspace({ documents: checkedRecoveryWorkspace(legacyWorkspace)
      .filter(entry => !excluded.has(entry.id)) });
  }
  if (disposition !== null) return [];
  // Only an absent workspace can fall back to the legacy file. A failed read
  // must not silently recover an older document and hide newer open tabs.
  const legacy = await readRecovery();
  return legacy ? [{ id: "legacy", name: "Recovered project", active: true, dirty: true, blob: legacy, updatedAt: 0 }] : [];
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
