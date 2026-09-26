type RuntimeEnvironment = {
  useWasmCache?: boolean;
  backends?: { onnx?: { wasm?: { wasmPaths?: unknown; numThreads?: number; proxy?: boolean } } };
};

export function configureNeuralRuntime(env: RuntimeEnvironment, baseUrl?: string) {
  if (!baseUrl) return; // Node qualification uses its installed native backend.
  const wasm = env.backends?.onnx?.wasm;
  if (!wasm) return;
  const root = new URL("/onnxruntime/", baseUrl);
  wasm.wasmPaths = {
    mjs: new URL("ort-wasm-simd-threaded.mjs", root).href,
    wasm: new URL("ort-wasm-simd-threaded.wasm", root).href,
  };
  // WKWebView does not provide cross-origin-isolated SharedArrayBuffer.
  wasm.numThreads = 1;
  wasm.proxy = false;
  // The app already bundles these assets; blob factory caching would require
  // unnecessarily weakening script-src to permit executable blob URLs.
  env.useWasmCache = false;
}
