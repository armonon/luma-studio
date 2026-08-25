import assert from "node:assert/strict";
import test from "node:test";
import { developNativeRaw, openNativeAiSignIn, openNativeFile, saveNativeFile } from "../app/engine/native-files.ts";

test("native open packets preserve UTF-8 file names and raw bytes", async () => {
  const name = new TextEncoder().encode("café.psd");
  const packet = new Uint8Array(4 + name.length + 3);
  new DataView(packet.buffer).setUint32(0, name.length, true);
  packet.set(name, 4);
  packet.set([1, 2, 3], 4 + name.length);
  const opened = await openNativeFile(async <T>() => packet as T);
  assert.equal(opened?.name, "café.psd");
  assert.deepEqual(Array.from(opened?.data ?? []), [1, 2, 3]);
});

test("native save strips path traversal and sends a binary payload", async () => {
  let payload: Uint8Array | undefined;
  const saved = await saveNativeFile(new Uint8Array([7, 8]), "../../project.luma", async <T>(_command: string, value?: unknown) => {
    payload = value as Uint8Array;
    return true as T;
  });
  assert.equal(saved, true);
  const length = new DataView(payload!.buffer).getUint32(0, true);
  assert.equal(new TextDecoder().decode(payload!.slice(4, 4 + length)), "project.luma");
  assert.deepEqual(Array.from(payload!.slice(4 + length)), [7, 8]);
});

test("native AI sign-in invokes the dedicated desktop window command", async () => {
  let command = "";
  assert.equal(await openNativeAiSignIn(async <T>(value: string) => {
    command = value;
    return undefined as T;
  }), true);
  assert.equal(command, "open_ai_sign_in");
});

test("native RAW development sends a framed source and returns PNG bytes", async () => {
  let command = "";
  let payload: Uint8Array | undefined;
  const file = new File([new Uint8Array([9, 8, 7])], "camera.nef");
  const result = await developNativeRaw(file, async <T>(nextCommand: string, value?: unknown) => {
    command = nextCommand;
    payload = value as Uint8Array;
    return new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]) as T;
  });
  assert.equal(command, "develop_native_raw");
  const nameLength = new DataView(payload!.buffer).getUint32(0, true);
  assert.equal(new TextDecoder().decode(payload!.subarray(4, 4 + nameLength)), "camera.nef");
  assert.deepEqual([...payload!.subarray(4 + nameLength)], [9, 8, 7]);
  assert.equal(result?.type, "image/png");
});
