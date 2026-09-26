/** Exact imported PostScript faces, loaded locally and never serialized into a
 * document/export. CoreText rejects substitution before returning bounded SFNT
 * bytes. Ordinary web/system-family choices retain their existing path. */
import { sfntCapHeightRatio } from "./font-cap-height";
type Invoke = (command: string, args: { postscriptName: string }) => Promise<ArrayBuffer | number[]>;
const MAX_FACES = 64, MAX_BYTES = 64 * 1024 * 1024, MAX_FACE_BYTES = 16 * 1024 * 1024;
const pending = new Map<string, Promise<void>>(), ready = new Set<string>();
const capHeights = new Map<string, number>();
let residentBytes = 0, reservedFaces = 0, revision = 0;
let queue: Promise<void> = Promise.resolve();

function invoke(): Invoke | undefined {
  return (globalThis as unknown as { __TAURI__?: { core?: { invoke?: Invoke } } }).__TAURI__?.core?.invoke;
}
export function nativeFontBridgeAvailable() { return typeof FontFace !== "undefined" && !!invoke(); }
export function nativeFontResourceRevision() { return revision; }
export function nativeImportedFontReady(name: string) { return !nativeFontBridgeAvailable() || ready.has(name); }
export function nativeImportedFontCapHeight(name: string) { return capHeights.get(name); }
export function nativeFontResourceStats() { return { residentBytes, readyFaces: ready.size, pendingFaces: reservedFaces, maxBytes: MAX_BYTES, maxFaces: MAX_FACES }; }

export function loadNativeImportedFont(name: string): Promise<void> {
  if (!nativeFontBridgeAvailable() || ready.has(name)) return Promise.resolve();
  if (!name || new TextEncoder().encode(name).length > 256 || /[\x00-\x1f\x7f-\x9f/\\]/.test(name)) return Promise.reject(new Error("Invalid imported font name"));
  const existing = pending.get(name);
  if (existing) return existing;
  if (ready.size + reservedFaces >= MAX_FACES) return Promise.reject(new Error("Exact-font session limit reached; save and restart before loading more faces"));
  reservedFaces++;
  const task = queue.then(async () => {
    // Admit a whole possible response before crossing the native boundary.
    if (residentBytes + MAX_FACE_BYTES > MAX_BYTES) throw new Error("Exact-font memory budget reached; choose a bundled font or restart");
    const response = await invoke()!("read_installed_font", { postscriptName: name });
    const bytes = response instanceof ArrayBuffer ? response
      : Array.isArray(response) && response.length <= MAX_FACE_BYTES && response.every(n => Number.isInteger(n) && n >= 0 && n <= 255)
        ? new Uint8Array(response).buffer : null;
    if (!bytes || bytes.byteLength < 12 || bytes.byteLength > MAX_FACE_BYTES) throw new Error("Invalid native font response");
    const signature = new DataView(bytes).getUint32(0, false);
    if (signature !== 0x00010000 && signature !== 0x4f54544f) throw new Error("Native font is not an admitted SFNT face");
    const face = new FontFace(name, bytes, { weight: "400", style: "normal" });
    await face.load();
    document.fonts.add(face);
    const cap = sfntCapHeightRatio(bytes);
    if (cap !== undefined) capHeights.set(name, cap);
    residentBytes += bytes.byteLength;
    ready.add(name);
    revision++;
  }).catch(error => { throw new Error(`Cannot render the exact imported font “${name}”: ${String(error)}. Choose an available font before rendering delivery assets.`); })
    .finally(() => { reservedFaces--; pending.delete(name); });
  pending.set(name, task);
  queue = task.catch(() => {}); // A missing face must not starve later fonts.
  return task;
}
