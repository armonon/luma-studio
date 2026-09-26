export const SELECTION_CLIPBOARD_TYPE = "application/x-luma-pixels";

type Invoke = <T>(command: string, payload?: unknown, options?: { headers: Record<string, string> }) => Promise<T>;
function nativeInvoke(): Invoke | undefined {
  return typeof window === "undefined" ? undefined : (window as Window & { __TAURI__?: { core?: { invoke?: Invoke } } }).__TAURI__?.core?.invoke;
}
export function hasNativeImageClipboard() { return Boolean(nativeInvoke()); }
type NativeClipboardInfo = { changeCount: number; marker: string };
let writeGeneration = 0;
let pendingWrite: Promise<boolean> = Promise.resolve(false);

/** Read only on an explicit paste. A foreign clipboard always wins over stale Luma pixels. */
export async function readNativeImageClipboard(ownMarker: string, hasPixels: boolean, beforeDecode?: () => void): Promise<"internal" | File> {
  const invoke = nativeInvoke();
  if (!invoke) throw new Error("Native clipboard unavailable");
  const generation = writeGeneration;
  await pendingWrite.catch(() => false);
  if (generation !== writeGeneration) throw new Error("Luma clipboard changed; paste again");
  const info = await invoke<NativeClipboardInfo>("native_clipboard_info");
  if (hasPixels && ownMarker && info.marker === ownMarker) return "internal";
  beforeDecode?.();
  const bytes = await invoke<ArrayBuffer | number[]>("read_native_clipboard", { changeCount: info.changeCount });
  const data = bytes instanceof ArrayBuffer ? bytes : new Uint8Array(bytes);
  return new File([data], "Pasted Layer.png", { type: "image/png" });
}

export function pixelPasteSource(types: readonly string[], marker: string, ownMarker: string, hasPixels: boolean, hasImage: boolean) {
  if (hasPixels && ownMarker && marker === ownMarker) return "internal";
  if (hasImage) return "image";
  if (hasPixels && types.length === 0) return "internal";
  return "none";
}

/** Start the clipboard write during activation; encoding may finish asynchronously. */
export function writePixelClipboard(canvas: HTMLCanvasElement, marker: string) {
  const generation = ++writeGeneration;
  pendingWrite = writePixels(canvas, marker, generation);
  return pendingWrite;
}

async function writePixels(canvas: HTMLCanvasElement, marker: string, generation: number) {
  const invoke = nativeInvoke();
  if (invoke) {
    try {
      // WKWebView completes its DOM copy event after the handler returns.
      // Read the revision only after that event has settled.
      await new Promise(resolve => setTimeout(resolve, 0));
      const info = await invoke<NativeClipboardInfo>("native_clipboard_info");
      const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Clipboard PNG encoding failed")), "image/png"));
      if (png.size > 32 * 1024 * 1024) throw new Error("Clipboard PNG exceeds 32 MiB");
      const bytes = await png.arrayBuffer();
      if (generation !== writeGeneration) return false;
      await invoke("write_native_clipboard", bytes, { headers: { "x-luma-marker": marker, "x-luma-change-count": String(info.changeCount) } });
      return true;
    } catch (error) { throw new Error(`Pixels retained in Luma; native copy failed: ${String(error)}`); }
  }
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") return false;
  try {
    const png = new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Clipboard PNG encoding failed")), "image/png"));
    void png.catch(() => {}); // A platform may reject ClipboardItem before consuming its promise.
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png, "text/plain": new Blob([marker], { type: "text/plain" }) })]);
    return true;
  } catch { return false; }
}
