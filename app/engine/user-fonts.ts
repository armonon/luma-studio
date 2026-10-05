/**
 * Fonts the user made in Glyph and installed into Luma.
 *
 * The family index lives in localStorage so text rendering can ask
 * synchronously "is this one of ours?"; the SFNT bytes live in IndexedDB and
 * are registered with `document.fonts` on first use. Fonts are per browser
 * profile: they are not embedded in `.luma` projects or PSD exports, so a
 * project opened elsewhere falls back to the next family in its stack.
 */

const INDEX_KEY = "luma.userFonts.v1";
const DB_NAME = "luma-user-fonts";
const STORE = "fonts";
const MAX_FONTS = 32;
const MAX_BYTES = 4 * 1024 * 1024;

export type UserFontEntry = { family: string; updatedAt: number; bytes: number };
type StoredFont = { family: string; data: ArrayBuffer; project?: string; updatedAt: number };

const ready = new Set<string>();
const pending = new Map<string, Promise<void>>();
const faces = new Map<string, FontFace>();
let revision = 0;

export const userFontResourceRevision = () => revision;

/** First family in a CSS font-family list, unquoted. */
export function primaryFamily(cssFamily: string) {
  return cssFamily.split(",")[0].trim().replace(/^["']|["']$/g, "");
}

// Text rendering asks per run; parse the index only when its raw value changes.
let cachedRaw: string | null | undefined, cachedEntries: UserFontEntry[] = [];
export function listUserFonts(): UserFontEntry[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(INDEX_KEY);
    if (raw === cachedRaw) return cachedEntries.slice();
    const parsed: unknown = JSON.parse(raw ?? "[]");
    cachedRaw = raw;
    cachedEntries = !Array.isArray(parsed) ? [] : parsed.slice(0, MAX_FONTS).filter((e): e is UserFontEntry => !!e && typeof e.family === "string" && /^[A-Za-z][A-Za-z0-9 ]{0,30}$/.test(e.family) && typeof e.updatedAt === "number" && typeof e.bytes === "number");
    return cachedEntries.slice();
  } catch { return []; }
}

function writeIndex(entries: UserFontEntry[]) { localStorage.setItem(INDEX_KEY, JSON.stringify(entries.slice(0, MAX_FONTS))); }

export function isUserFontFamily(cssFamily: string) {
  const name = primaryFamily(cssFamily).toLowerCase();
  return listUserFonts().some(entry => entry.family.toLowerCase() === name);
}

export function userFontReady(cssFamily: string) {
  return !isUserFontFamily(cssFamily) || ready.has(primaryFamily(cssFamily).toLowerCase());
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("This browser cannot store fonts (IndexedDB unavailable)")); return; }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: "family" }); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Font storage unavailable"));
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode), request = run(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error ?? request.error ?? new Error("Font storage failed"));
      transaction.onabort = () => reject(transaction.error ?? new Error("Font storage aborted"));
    });
  } finally { db.close(); }
}

function validSfnt(data: ArrayBuffer) {
  if (data.byteLength < 12 || data.byteLength > MAX_BYTES) return false;
  const tag = new DataView(data).getUint32(0, false);
  return tag === 0x00010000 || tag === 0x4f54544f;
}

async function register(family: string, data: ArrayBuffer) {
  if (typeof FontFace === "undefined" || typeof document === "undefined" || !document.fonts) return;
  const face = new FontFace(family, data.slice(0), { weight: "400", style: "normal" });
  await face.load();
  const previous = faces.get(family.toLowerCase());
  if (previous) document.fonts.delete(previous);
  document.fonts.add(face);
  faces.set(family.toLowerCase(), face);
  ready.add(family.toLowerCase());
  revision++;
}

/** Save (or replace) a user font, register it for this session and index it for later ones. */
export async function installUserFont(family: string, data: ArrayBuffer, project?: string) {
  if (!validSfnt(data)) throw new Error("Font file is not a valid TrueType/OpenType face");
  const entries = listUserFonts().filter(entry => entry.family.toLowerCase() !== family.toLowerCase());
  if (entries.length >= MAX_FONTS) throw new Error(`You can install up to ${MAX_FONTS} Glyph fonts; remove one first`);
  // Register first: a face the browser rejects must never reach the index.
  await register(family, data);
  await tx("readwrite", store => store.put({ family, data, project, updatedAt: Date.now() } satisfies StoredFont));
  writeIndex([{ family, updatedAt: Date.now(), bytes: data.byteLength }, ...entries]);
}

export async function removeUserFont(family: string) {
  await tx("readwrite", store => store.delete(family));
  writeIndex(listUserFonts().filter(entry => entry.family.toLowerCase() !== family.toLowerCase()));
  const face = faces.get(family.toLowerCase());
  if (face && typeof document !== "undefined") document.fonts.delete(face);
  faces.delete(family.toLowerCase()); ready.delete(family.toLowerCase()); revision++;
}

/** Load an installed font into `document.fonts`. Resolves immediately for non-user families. */
export function loadUserFont(cssFamily: string): Promise<void> {
  if (!isUserFontFamily(cssFamily)) return Promise.resolve();
  const key = primaryFamily(cssFamily).toLowerCase();
  if (ready.has(key)) return Promise.resolve();
  const existing = pending.get(key);
  if (existing) return existing;
  const family = listUserFonts().find(entry => entry.family.toLowerCase() === key)!.family;
  const task = tx<StoredFont | undefined>("readonly", store => store.get(family) as IDBRequest<StoredFont | undefined>)
    .then(stored => {
      if (!stored || !(stored.data instanceof ArrayBuffer) || !validSfnt(stored.data)) throw new Error(`Glyph font “${family}” is missing from this browser's storage`);
      return register(family, stored.data);
    })
    .finally(() => pending.delete(key));
  pending.set(key, task);
  return task;
}
