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
  const response = await invoke<ArrayBuffer | Uint8Array>("open_native_file");
  const bytes = response instanceof Uint8Array ? response : new Uint8Array(response);
  if (bytes.byteLength < 4) throw new Error("Native open response is truncated");
  const nameLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true);
  if (nameLength === 0) return null;
  if (nameLength > bytes.byteLength - 4) throw new Error("Native open file name is truncated");
  const name = new TextDecoder().decode(bytes.subarray(4, 4 + nameLength));
  // Keep a view into the native response; the importer can take the one
  // ArrayBuffer copy it needs instead of duplicating a large PSD twice.
  return { name, data: bytes.subarray(4 + nameLength) };
}

export async function saveNativeFile(data: Blob | Uint8Array, fileName: string, invoke = systemInvoke()) {
  if (!invoke) return false;
  const safeName = fileName.split(/[\\/]/).at(-1)?.trim() || "Untitled.luma";
  const name = new TextEncoder().encode(safeName);
  const file = data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data;
  const payload = new Uint8Array(4 + name.length + file.length);
  new DataView(payload.buffer).setUint32(0, name.length, true);
  payload.set(name, 4);
  payload.set(file, 4 + name.length);
  return invoke<boolean>("save_native_file", payload);
}

export async function openNativeAiSignIn(invoke = systemInvoke()) {
  if (!invoke) return false;
  await invoke<void>("open_ai_sign_in");
  return true;
}
