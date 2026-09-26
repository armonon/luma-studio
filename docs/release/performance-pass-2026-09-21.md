# Performance pass — 2026-09-21

Speed and optimization are now the top priority. New workflow expansion is
paused. This report separates measured results from architectural improvements
that still require full-app benchmarks.

## Changes

- Cache operation-history summaries between graph mutations. Repeated UI reads
  no longer walk the history graph. Invalidate on commit, undo, redo and checkout;
  return a copy so consumers cannot mutate the cache.
- Coalesce the main React UI subscriber to one update per animation frame.
  Active-target repair remains synchronous; dirty/save/recovery subscribers
  retain their existing behavior. Cancel pending UI frames on cleanup.
- Preserve the Window receiver when scheduling pan, transform and UI frames.
  Live WebKit testing caught an illegal-invocation startup regression in the
  initial implementation; the wrapper and receiver-sensitive test address it.
- Action-library metadata edits emit UI changes without requesting canvas
  recomposition. A separate action revision protects saves against edits during
  encoding. Metadata dirtiness survives canvas Undo.
- Load and clone only the explicitly opened action editor. Closed editors do
  not stringify/deep-clone every action on every render. Parameter JSON mounts
  on demand; the step picker does not instantiate 20,000 options.
- Render at most 20 action rows and 100 report results per page. Bound library
  edit history to 64 edits and 4,000,000 serialized characters total. This is
  an edit-history bound, not a guarantee of total application RAM.
- Reset editor drafts when switching actions, and close stale parameter drafts
  when reordering, duplicating or removing steps.

The action editor and conditional execution were started before reprioritizing.
They were stabilized rather than expanding into further automation features.
The shared Studio command/context architecture is preserved; no second state
or docking system was introduced, following the application-shell skill.

## Reproducible microbenchmark

Run `node build/benchmark-history-summary.mjs`. It compares the Git HEAD
history implementation with the working-tree implementation in the same Node
process. Apple M3, Node v22.23.2; 1,500 history nodes, 100 warm-up queries,
five samples of 10,000 summary queries. Matching consumed checksums: 75,150,000.

| Implementation | Median time for 10,000 summary queries |
| --- | ---: |
| Git HEAD baseline | 361.513 ms |
| Cached summary | 0.432 ms |

This measures history-summary overhead only. It is **not** a whole-app speedup,
brush latency, FPS, startup, export, peak-memory or Photoshop comparison.
The regression also verifies that 10,000 reads traverse the graph once between
mutations instead of 10,000 times.

## Validation

- 101/101 focused tests passed: actions/conditions/playback, history, frame
  coalescing, native save/menu workflows, recovery, performance governor,
  resident-memory admission, dirty-region renderer, batch and Smart Objects.
- TypeScript and targeted application/test ESLint passed. The benchmark sits
  under an ignored build directory; validate its JavaScript syntax separately.
- Production desktop frontend and native debug review bundle build successfully.
  `codesign --verify --deep --strict` passes. The native review app is ad-hoc
  signed, not Developer ID signed/notarized. The Rust binary is a debug build;
  representative native performance measurement must use a release build.
  `/Applications/Luma Studio.app` was not overwritten.
- Live production-frontend test at `127.0.0.1:4175`: startup recovery completed
  after the scheduler fix; recording produced a one-step test action; editing
  added a portrait condition; replay on the landscape test document reported
  `setOpacity · skipped — Condition not met: orientation: portrait` with zero
  changes. Dedicated action-edit Undo became disabled and Redo enabled after
  reverting the edit. These are UI workflow checks, not timing measurements.
- Live checks used a 1280×720 browser viewport, not a fresh launch of the final
  native binary. The full visual matrix and final minor editor-reset fixes have
  build/type validation but not exhaustive interactive coverage.

## Next performance gates

1. Measure packaged-app input-to-paint p50/p95/p99 for brush, move, transform,
   pan and zoom on matched fixtures/hardware. Preserve source pixels and undo.
2. Measure startup and peak resident memory at 10K/25K/50K dimensions and sparse
   extreme dimensions; include selection, masks, feather, transform and export.
3. Profile synchronous filter/action/export work; move the measured blocking
   work into cancellable workers or native jobs with bounded transport buffers.
4. Profile save/recovery serialization and long-session history growth, then
   reduce copies without weakening stale-save or recovery guarantees.
5. Reduce remaining large bundle chunks based on startup traces. Do not trade
   startup speed for a surprising first-use freeze in a core editing tool.

No unmeasured whole-app superiority or unlimited-document claim is made.
