type NativeInvoke = <T>(command: string, payload?: unknown) => Promise<T>;

type TauriWindow = Window & {
  __TAURI__?: { core?: { invoke?: NativeInvoke } };
};

function systemInvoke(): NativeInvoke | null {
  if (typeof window === "undefined") return null;
  return (window as TauriWindow).__TAURI__?.core?.invoke ?? null;
}

export function isNativeFilesystemAvailable() {
  return systemInvoke() !== null;
}

export async function openNativeFile(invoke = systemInvoke()) {
  if (!invoke) return null;
  return decodeFramedFile(await invoke<ArrayBuffer | Uint8Array>("open_native_file"));
}

/**
 * Read a document by absolute path, for a file the OS asked us to open.
 *
 * Same frame as the dialog; the difference is only where the path came from.
 */
export async function readNativePath(path: string, invoke = systemInvoke()) {
  if (!invoke) return null;
  return decodeFramedFile(await invoke<ArrayBuffer | Uint8Array>("read_native_path", { path }));
}

function decodeFramedFile(response: ArrayBuffer | Uint8Array) {
  const bytes = response instanceof Uint8Array ? response : new Uint8Array(response);
  if (bytes.byteLength < 4) throw new Error("Native open response is truncated");
  const nameLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true);
  if (nameLength === 0) return null;
  if (nameLength > bytes.byteLength - 4) throw new Error("Native open file name is truncated");
  const framedName = new TextDecoder().decode(bytes.subarray(4, 4 + nameLength));
  const path = framedName.startsWith("/") ? framedName : undefined;
  const name = framedName.split(/[\\/]/).at(-1) || "Untitled";
  // Keep a view into the native response; the importer can take the one
  // ArrayBuffer copy it needs instead of duplicating a large PSD twice.
  const offset = bytes.byteOffset + 4 + nameLength;
  const data = new Uint8Array(bytes.buffer as ArrayBuffer, offset, bytes.byteLength - 4 - nameLength);
  return { name, path, data };
}

function encodeNamedBytes(fileName: string, file: Uint8Array) {
  const safeName = fileName.split(/[\\/]/).at(-1)?.trim() || "Untitled";
  const name = new TextEncoder().encode(safeName);
  const payload = new Uint8Array(4 + name.length + file.length);
  new DataView(payload.buffer).setUint32(0, name.length, true);
  payload.set(name, 4);
  payload.set(file, 4 + name.length);
  return payload;
}

function encodePathBytes(path: string, file: Uint8Array) {
  const name = new TextEncoder().encode(path);
  const payload = new Uint8Array(4 + name.length + file.length);
  new DataView(payload.buffer).setUint32(0, name.length, true);
  payload.set(name, 4);
  payload.set(file, 4 + name.length);
  return payload;
}

/**
 * Ask the macOS desktop shell to develop a camera RAW through ImageIO. This is
 * deliberately a capability probe: the browser returns null and the desktop
 * command rejects formats the installed OS cannot decode, allowing callers to
 * fall back to Luma's embedded-preview path without mislabelling it as RAW.
 */
export async function developNativeRaw(
  file: File,
  sourceBytesOrInvoke?: ArrayBuffer | NativeInvoke,
  fallbackInvoke = systemInvoke(),
) {
  const invoke = typeof sourceBytesOrInvoke === "function" ? sourceBytesOrInvoke : fallbackInvoke;
  if (!invoke) return null;
  const sourceBytes = sourceBytesOrInvoke instanceof ArrayBuffer ? sourceBytesOrInvoke : await file.arrayBuffer();
  const payload = encodeNamedBytes(file.name, new Uint8Array(sourceBytes));
  const response = await invoke<ArrayBuffer | Uint8Array>("develop_native_raw", payload);
  const bytes = response instanceof Uint8Array ? response : new Uint8Array(response);
  if (bytes.byteLength < 8) throw new Error("Native RAW developer returned an empty image");
  return new Blob([bytes.slice()], { type: "image/png" });
}

/** Save a Luma project to its remembered path, or prompt once for Save As. */
export async function saveNativeProject(
  data: Blob | Uint8Array,
  fileName: string,
  currentPath?: string,
  invoke = systemInvoke(),
) {
  if (!invoke) return null;
  const file = data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data;
  if (currentPath) {
    await invoke<boolean>("save_native_path", encodePathBytes(currentPath, file));
    return currentPath;
  }
  return invoke<string | null>("save_native_file_as", encodeNamedBytes(fileName || "Untitled.luma", file));
}

export async function saveNativeFile(data: Blob | Uint8Array, fileName: string, invoke = systemInvoke()) {
  if (!invoke) return false;
  const file = data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data;
  return invoke<boolean>("save_native_file", encodeNamedBytes(fileName || "Untitled.luma", file));
}

export async function openNativeAiSignIn(invoke = systemInvoke()) {
  if (!invoke) return false;
  await invoke<void>("open_ai_sign_in");
  return true;
}
