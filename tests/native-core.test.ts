import assert from "node:assert/strict";
import test from "node:test";
import {
  compositeNativeTile,
  encodeNativeTileRequest,
  nativeCoreInfo,
} from "../app/engine/native-core.ts";

test("native tile packets use the stable binary protocol", () => {
  const packet = encodeNativeTileRequest({
    width: 1,
    height: 1,
    layers: [{ pixels: new Float32Array([1, 0, 0, 1]), mode: "multiply", opacity: 0.5 }],
  });
  assert.equal(new TextDecoder().decode(packet.slice(0, 4)), "LUM1");
  const view = new DataView(packet.buffer);
  assert.equal(view.getUint32(4, true), 1);
  assert.equal(view.getUint32(8, true), 1);
  assert.equal(view.getUint32(12, true), 1);
  assert.equal(view.getUint32(16, true), 3); // multiply's catalogue index
  assert.equal(view.getFloat32(20, true), 0.5);
});

test("native tile invocation sends binary and decodes an f32 response", async () => {
  let command = "";
  let raw: unknown;
  const result = await compositeNativeTile({
    width: 1,
    height: 1,
    layers: [{ pixels: new Float32Array([1, 0, 0, 1]), mode: "source-over", opacity: 1 }],
  }, async <T>(name: string, payload?: unknown) => {
    command = name;
    raw = payload;
    return new Uint8Array(new Float32Array([0.25, 0.5, 0.75, 1]).buffer) as T;
  });
  assert.equal(command, "composite_native_tile");
  assert.ok(raw instanceof Uint8Array);
  assert.deepEqual(Array.from(result ?? []), [0.25, 0.5, 0.75, 1]);
});

test("native core calls are inert in a browser without the Tauri bridge", async () => {
  assert.equal(await nativeCoreInfo(null), null);
  assert.equal(await compositeNativeTile({ width: 1, height: 1, layers: [] }, null), null);
});
