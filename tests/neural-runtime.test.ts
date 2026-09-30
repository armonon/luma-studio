import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configureNeuralRuntime } from '../app/engine/neural-runtime';
import { clientPerformance } from '../build/client-performance-vite-plugin';

test('neural loading uses paired same-origin assets with single-threaded WASM', () => {
  const env = { useWasmCache: true, backends: { onnx: { wasm: { wasmPaths: undefined as unknown, numThreads: 8, proxy: true } } } };
  configureNeuralRuntime(env, 'https://luma-studio-preview.armonon.chatgpt.site/studio');
  assert.deepEqual(env.backends.onnx.wasm.wasmPaths, { mjs: 'https://luma-studio-preview.armonon.chatgpt.site/onnxruntime/ort-wasm-simd-threaded.mjs', wasm: 'https://luma-studio-preview.armonon.chatgpt.site/onnxruntime/ort-wasm-simd-threaded.wasm' });
  assert.equal(env.backends.onnx.wasm.numThreads, 1);assert.equal(env.backends.onnx.wasm.proxy, false);assert.equal(env.useWasmCache, false);
});
test('hosted client resolves external ONNX assets and leaves other build environments alone', () => {
  const hook = clientPerformance().configEnvironment as (name: string) => { resolve: { conditions: string[] } } | undefined;
  assert.ok(hook('client')?.resolve.conditions.includes('onnxruntime-web-use-extern-wasm'));
  assert.equal(hook('ssr'), undefined);
});
