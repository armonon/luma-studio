const AUTOSAVE_FILE = "luma-recovery.luma";
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

async function idbPut(blob: Blob) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(blob, AUTOSAVE_FILE);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
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

export async function writeRecovery(blob: Blob) {
  const root = await opfsRoot();
  if (!root) return idbPut(blob);
  const handle = await root.getFileHandle(AUTOSAVE_FILE, { create: true });
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
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
