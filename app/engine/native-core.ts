import { BLEND_MODES, type BlendMode } from "./document";

const MAGIC = [0x4c, 0x55, 0x4d, 0x31] as const; // LUM1
const MAX_TILE_PIXELS = 2048 * 2048;

export type NativeTileLayer = {
  pixels: Float32Array;
  mode: BlendMode;
  opacity: number;
  linear?: boolean;
  maskAlpha?: Float32Array;
};

export type NativeTileRequest = {
  width: number;
  height: number;
  layers: ReadonlyArray<NativeTileLayer>;
};

type NativeInvoke = <T>(command: string, payload?: unknown) => Promise<T>;

type TauriWindow = Window & {
  __TAURI__?: {
    core?: {
      invoke?: NativeInvoke;
    };
  };
};

function systemInvoke(): NativeInvoke | null {
  if (typeof window === "undefined") return null;
  return (window as TauriWindow).__TAURI__?.core?.invoke ?? null;
}

export function isNativeCoreAvailable() {
  return systemInvoke() !== null;
}

function validateRequest(request: NativeTileRequest) {
  const pixels = request.width * request.height;
  if (!Number.isSafeInteger(request.width) || !Number.isSafeInteger(request.height)
      || request.width <= 0 || request.height <= 0 || pixels > MAX_TILE_PIXELS) {
    throw new Error(`Native compositor tiles must contain 1..${MAX_TILE_PIXELS} pixels`);
  }
  if (request.layers.length > 128) throw new Error("Native compositor tiles support at most 128 blend passes");
  for (const layer of request.layers) {
    if (layer.pixels.length !== pixels * 4) throw new Error("Native compositor layer dimensions do not match the tile");
    if (layer.maskAlpha && layer.maskAlpha.length !== pixels) throw new Error("Native compositor mask dimensions do not match the tile");
    if (!Number.isFinite(layer.opacity) || layer.opacity < 0 || layer.opacity > 1) {
      throw new Error("Native compositor opacity must be between zero and one");
    }
  }
  return pixels;
}

export function encodeNativeTileRequest(request: NativeTileRequest) {
  const pixels = validateRequest(request);
  const pixelBytes = pixels * 4 * Float32Array.BYTES_PER_ELEMENT;
  const maskBytes = pixels * Float32Array.BYTES_PER_ELEMENT;
  const total = 16 + request.layers.reduce(
    (length, layer) => length + 16 + pixelBytes + (layer.maskAlpha ? maskBytes : 0),
    0,
  );
  const payload = new Uint8Array(total);
  payload.set(MAGIC, 0);
  const view = new DataView(payload.buffer);
  view.setUint32(4, request.width, true);
  view.setUint32(8, request.height, true);
  view.setUint32(12, request.layers.length, true);
  let offset = 16;
  for (const layer of request.layers) {
    const modeIndex = BLEND_MODES.indexOf(layer.mode);
    if (modeIndex < 0) throw new Error(`Native compositor does not recognize blend mode ${layer.mode}`);
    view.setUint32(offset, modeIndex, true);
    view.setFloat32(offset + 4, layer.opacity, true);
    view.setUint32(offset + 8, (layer.linear ? 1 : 0) | (layer.maskAlpha ? 2 : 0), true);
    view.setUint32(offset + 12, 0, true);
    offset += 16;
    new Float32Array(payload.buffer, offset, layer.pixels.length).set(layer.pixels);
    offset += pixelBytes;
    if (layer.maskAlpha) {
      new Float32Array(payload.buffer, offset, layer.maskAlpha.length).set(layer.maskAlpha);
      offset += maskBytes;
    }
  }
  return payload;
}

export async function compositeNativeTile(request: NativeTileRequest, invoke = systemInvoke()) {
  if (!invoke) return null;
  const payload = encodeNativeTileRequest(request);
  const response = await invoke<ArrayBuffer | Uint8Array>("composite_native_tile", payload);
  const bytes = response instanceof Uint8Array ? response : new Uint8Array(response);
  const expected = request.width * request.height * 4 * Float32Array.BYTES_PER_ELEMENT;
  if (bytes.byteLength !== expected) throw new Error(`Native compositor returned ${bytes.byteLength} bytes; expected ${expected}`);
  // Copy to an aligned, exclusively owned buffer before exposing float values.
  return new Float32Array(bytes.slice().buffer);
}

export async function nativeCoreInfo(invoke = systemInvoke()) {
  if (!invoke) return null;
  return invoke<{ threads: number; precision: string; blendModes: string[] }>("core_info");
}
