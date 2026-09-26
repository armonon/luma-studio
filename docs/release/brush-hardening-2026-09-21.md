# Brush engine: responsiveness and robustness

This is an implemented brush-engine improvement, not certification that Luma
matches Procreate. No real tablet or installed Procreate was benchmarked.

## Implemented

- Precision painting retains one spacing planner for the gesture, processes
  only new dabs, and indexes them into the tiles they touch. It no longer
  replans the growing point list or repaints the entire accumulated rectangle.
- Each touched tile retains original float pixels, reusable output and cumulative
  coverage. Repainting a loop accumulates coverage rather than replaying old dabs.
  Per-stroke opacity remains a final cap; flow/build-up, seeded scatter/texture,
  image-tip colors and supported blending modes remain deterministic.
- Sparse mask painting uses the same accumulator instead of allocating a canvas
  spanning a pointer segment. Mask removal respects the whole-stroke opacity cap.
- Brush blend modes account for destination alpha. Multiply/Overlay on transparent
  pixels now deposit source color instead of multiplying against invisible black.
- Pointer identity, originating document, target layer and brush parameters are
  captured at stroke start. Coalesced events use one canvas geometry read per
  packet. Tool/selection changes cannot redirect an active captured gesture.
- Pen pressure zero stays zero; half pressure stays half pressure. Mouse/touch
  input uses full force rather than a synthetic half-pressure brush.
- Stabilization uses elapsed pointer time; spatial smoothing no longer smooths
  away pressure dynamics. Pointer-up completes the final path to the actual
  release position without double-stamping a stationary release.
- Completed strokes have one tile-diff undo entry. Pointer cancellation, lost
  capture, document switch, disposal and invalid/over-budget input roll back the
  active gesture. Cancellation also restores an initially absent mask.

## Explicit bounds

- Live brush size: positive, at most 4096 document pixels (current UI limits are
  smaller). Non-finite coordinates/pressure are rejected.
- At most 16,384 emitted dabs per planner sample and 131,072 tile/dab references
  per packet. Excessive inputs are refused rather than allocating indefinitely.
- 128 MiB estimated active-stroke working-set ceiling, including original/output
  float pixels, coverage, and conservative before/after history payload allowance.
  Admission happens before painting that packet; refusal rolls back the stroke.
- Existing resident surface admission still applies. These bounds are not a total
  process RSS guarantee: browser canvas backing stores, the rest of the workspace,
  runtime heaps and GPU allocations remain separate.

## Validation

- 98 focused tests passed across brush/replay, image tips, sparse masks, alpha
  surfaces, extreme dimensions, resident budgets, retouch, dirty-region rendering,
  native save/recovery and transforms.
- The new replay matrix checks exact float equality for incremental versus full
  strokes across paint/erase, build-up on/off, image tips on/off and four blend
  modes, with pressure, scatter and texture. HDR background values are included.
- Engine tests confirm original tiles are captured once; continuing at the far
  end of a long stroke does not rewrite tiles left behind. Cancellation and
  invalid-input rollback leave the document paintable. 50K mask painting remains
  sparse, and the release endpoint survives stabilization.
- Live production-frontend check: created `Brush Streaming Test`, painted a
  48px orange stroke, Cmd+Z cleared the entire stroke, and Cmd+Shift+Z restored it.
  This was mouse input in a 1280×720 browser, not real pen/tilt testing.
- One early preview loaded while its build assets were being replaced, producing
  a missing dynamic-module error. Reloading after the build completed restored
  the preview. This was not counted as a brush or native-app pass.
- TypeScript, targeted ESLint and desktop frontend build passed. Native debug
  review packaging and ad-hoc signature verification passed. The installed
  `/Applications/Luma Studio.app` was not overwritten. The final transparent-blend
  correction has test/build coverage; the live normal-brush smoke preceded it.

## Benchmark

Run `./node_modules/.bin/tsx build/benchmark-brush-streaming.ts`.
It compares growing-stroke full replay against incremental coverage using the
same renderer and verifies exact final pixel equality. Fixture: 400 pressure
samples, looping 18px brush, one 128×128 float tile; Apple M3, Node v22.23.2.
It measures CPU brush work only, not input-to-display latency or total application
FPS. The final-code run measured median 629.851 ms versus 70.201 ms (~9.0×).
Three baseline samples: 637.951, 629.851, 620.805 ms; incremental samples:
70.201, 71.329, 70.006 ms. An earlier run measured ~9.5×; wall-clock timings
vary with machine load. See the command output for a current hardware run.

## Still required for a credible Procreate-class claim

Procreate documents extensive stabilization, taper, shape/grain and Pencil
controls in its [Brush Studio handbook](https://help.procreate.com/procreate/handbook/brushes/brush-studio-settings).
Luma's existing controls and this pass do not establish equivalent artistry or
hardware latency.

1. Real pen/tablet pressure ramps, tilt, rapid lift/recontact, lost focus, palm
   rejection and long drawing sessions; record p50/p95/p99 input-to-display latency.
2. Artist-reviewed inking, pencil, charcoal, watercolor and oil presets with
   golden stroke images. A generic mixer tool is not a validated wet-media model.
3. Richer taper controls, grain behavior, dual-tip brushes and expressive color/
   speed dynamics implemented within the same memory/performance envelope.
4. Worker/GPU deposition for expensive large tips; very large single packets
   still execute synchronously despite their explicit work limits.
5. Legacy bitmap-only and retouch paths do not share this new accumulation engine.
   Validate their feel independently; do not infer improvement from this benchmark.
6. Release-build/native hardware testing, full save/reopen artwork corpus and
   sustained peak-RAM measurement before any parity or superiority claim.
