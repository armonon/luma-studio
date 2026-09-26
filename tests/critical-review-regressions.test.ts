import test from "node:test";
import assert from "node:assert/strict";
import { Studio } from "../app/engine/studio.ts";
import { createRasterLayer } from "../app/engine/document.ts";
import { encodeLumaProject, decodeLumaProject } from "../app/engine/project.ts";
import { pixelAt, testCanvas } from "./canvas-harness.ts";
import { readBoundedFormData, UploadLimitError } from "../app/engine/bounded-upload.ts";
import { readFileSync } from "node:fs";
import { configureNeuralRuntime } from "../app/engine/neural-runtime.ts";

test("native inference loads bundled modules without CDN scripts or blob execution", () => {
  const env = { useWasmCache: true, backends: { onnx: { wasm: { wasmPaths: "https://cdn.invalid/", numThreads: 4, proxy: true } } } };
  configureNeuralRuntime(env, "tauri://localhost/index.html");
  assert.equal(env.useWasmCache, false);
  assert.deepEqual(env.backends.onnx.wasm.wasmPaths, { mjs: "tauri://localhost/onnxruntime/ort-wasm-simd-threaded.mjs", wasm: "tauri://localhost/onnxruntime/ort-wasm-simd-threaded.wasm" });
  assert.equal(env.backends.onnx.wasm.numThreads, 1);
  assert.equal(env.backends.onnx.wasm.proxy, false);
});

test("save and recovery refuse archives their decoder cannot admit", async () => {
  const studio = new Studio(1024, 1024, testCanvas(1, 1));
  const bitmap = testCanvas(1024, 1024);
  // Serial PNG restore holds one decoder scratch image, not one per layer.
  // 129 independent 4 MiB backing stores alone exceed the unchanged 512 MiB cap.
  studio.doc.layers = Array.from({ length: 129 }, (_, i) => createRasterLayer(`Layer ${i}`, bitmap));
  const original = studio.doc;
  await assert.rejects(studio.prepareProjectSave(), /memory (?:admission )?ceiling/);
  await assert.rejects(encodeLumaProject(studio.doc, [], "Recovery", undefined, { mode: "recovery" }), /decoded-memory ceiling/);
  assert.equal(studio.doc, original);
  studio.doc.layers = studio.doc.layers.slice(0, 2);
  const saved = await studio.prepareProjectSave();
  assert.equal((await decodeLumaProject(saved.blob)).doc.layers.length, 2);
  studio.dispose();
});

for (const operation of ["filter", "warp"] as const) test(`${operation} synchronization failure keeps original pixels, surfaces, history and actions`, () => {
  const studio = new Studio(16, 16, testCanvas(1, 1));
  const layer = studio.addBlankRaster("Original"); studio.fillLayer(layer.id, "red");
  const original = layer.bitmap, surface = layer.surface, node = studio.historyState().currentId;
  studio.startRecording("Failures");
  const internal = studio as unknown as { syncLayerSurface: () => void };
  const sync = internal.syncLayerSurface;
  internal.syncLayerSurface = () => { throw new Error("Injected sync failure"); };
  assert.throws(() => operation === "filter" ? studio.filter(layer.id, "invert") : studio.radialWarpLayer(layer.id, { x: 3, y: 3 }, { x: 6, y: 6 }, 5), /Injected sync/);
  assert.equal(layer.bitmap, original); assert.equal(layer.surface, surface);
  assert.deepEqual(pixelAt(layer.bitmap!, 0, 0), { r: 255, g: 0, b: 0, a: 255 });
  assert.equal(studio.historyState().currentId, node);
  assert.equal(studio.stopRecording()?.steps.length, 0);
  internal.syncLayerSurface = sync;
  studio.filter(layer.id, "invert");
  assert.equal(pixelAt(layer.bitmap!, 0, 0).r, 0);
  studio.undo(); assert.equal(pixelAt(layer.bitmap!, 0, 0).r, 255);
  studio.redo(); assert.equal(pixelAt(layer.bitmap!, 0, 0).r, 0);
  studio.dispose();
});

test("native Cut stages pixels until publication and refuses stale completion", () => {
  const studio = new Studio(8, 8, testCanvas(1, 1));
  const layer = studio.addBlankRaster("Cut"); studio.fillLayer(layer.id, "red");
  const node = studio.historyState().currentId;
  const failed = studio.preparePixelCut(layer.id);
  assert.equal(pixelAt(layer.bitmap!, 0, 0).a, 255);
  assert.equal(studio.historyState().currentId, node);
  studio.fillLayer(layer.id, "blue");
  assert.throws(failed.complete, /document changed/i);
  assert.equal(pixelAt(layer.bitmap!, 0, 0).b, 255);
  const ready = studio.preparePixelCut(layer.id); ready.complete();
  assert.equal(pixelAt(layer.bitmap!, 0, 0).a, 0);
  assert.throws(ready.complete, /already/);
  studio.undo(); assert.equal(pixelAt(layer.bitmap!, 0, 0).a, 255);
  studio.dispose();
});

test("desktop model policy allows the verified HF CDN without unrestricted origins", () => {
  const config = JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
  assert.match(config.app.security.csp, /connect-src[^;]*https:\/\/us\.aws\.cdn\.hf\.co/);
  assert.doesNotMatch(config.app.security.csp, /connect-src[^;]*https:\/\/\*(?:[ ;])/);
});

test("multipart admission caps actual chunked bytes and cancels oversized streams", async () => {
  let cancelled = false;
  let started = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!started) {
        started = true;
        controller.enqueue(new TextEncoder().encode('--abc\r\nContent-Disposition: form-data; name="image"; filename="x.png"\r\nContent-Type: image/png\r\n\r\n'));
      } else controller.enqueue(new Uint8Array(32));
    },
    cancel() { cancelled = true; },
  });
  const request = new Request("https://example.test", { method: "POST", headers: { "content-type": "multipart/form-data; boundary=abc" }, body, duplex: "half" } as RequestInit);
  await assert.rejects(readBoundedFormData(request, 256), UploadLimitError);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(cancelled, true);
  const large = new Request("https://example.test", { method: "POST", headers: { "content-length": "999" }, body: "x" });
  await assert.rejects(readBoundedFormData(large, 64), UploadLimitError);
  const form = new FormData(); form.set("prompt", "small");
  assert.equal((await readBoundedFormData(new Request("https://example.test", { method: "POST", body: form }), 4096)).get("prompt"), "small");
});
