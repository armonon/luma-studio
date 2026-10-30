# Local production drawing measurements

See `production-performance.json` for environment, fixtures, event counts, timings and limits. These are bounded browser UI workloads, not physical pen latency, real touch, field INP or 120 Hz qualification.

Form's matched 30-stroke run identified a mounted but hidden WebGL viewport drawing during standalone sketching. The fix retains its context and source geometry, reduces observed long tasks 66 to 2, and eliminates 1,327 hidden draws. The sequence completed in 36.2 seconds before and 13.3 seconds after. Frame p95 remained 50 ms and release p95 51.8 ms: consistent frame-budget drawing remains unqualified. Idle coordinates and command origins stay precise without reconciling the whole workspace.

Luma's heavy photo scene still has expensive synchronous CPU compositing. A cache-reuse experiment passed pixel tests but failed runtime qualification and was reverted. A separate 25-stroke capture also exposed substantial workspace refresh cost; its verified scene had two raster layers, including an empty default layer. These issues remain unfinished. This pass publishes diagnostics, not an unproven compositor optimization.

The profiler is opt-in on 127.0.0.1 with `?drawingDiagnostics=1`. Start/stop controls collect event dispatch, requestAnimationFrame, phase and long-task distributions. It sends no telemetry and bounds retained samples. Production domains cannot enable it with this query parameter.

Chrome describes attribution and its limits in [Long Animation Frames](https://developer.chrome.com/docs/web-platform/long-animation-frames). Worker, isolated-world and system scheduling costs are not fully attributed. Startup completed before manual capture; shader compilation and cold allocation were not independently timed.

## Netlify browser vendor URL qualification — 2026-10-30

The production artifact review found absolute build-machine URLs emitted by
Webpack for `import.meta.url` in HarfBuzz, PDF.js, ONNX Runtime and Transformers
browser bundles. Browser-only loaders now use the running page/worker URL for
runtime fallback bases while retaining static `new URL(asset, import.meta.url)`
expressions for Webpack's hashed WASM/worker emission. Node/server modules retain
their original resolution. No dependency or runtime asset protection was changed.

The font-loader test instantiates the installed HarfBuzz WASM under a browser-like
VM with supplied binary data. Installed vendor checks preserve static asset
references; PDF import/object and neural runtime tests validate explicit resource
paths. Final public bundles must pass the local pathname/credential scan before
deployment. Browser PDF/AI interaction on the hosted release remains a separate
manual qualification gate, along with real pen/touch hardware and physical latency.
