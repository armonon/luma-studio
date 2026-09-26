# Memory and disk-layer campaign

## Scope

Requested: fix the measured PSD round-trip memory failure, then remove the three declared flattened imports using bounded editable-layer storage. Memory ceilings must not be relaxed.

## Production changes

- RGB8 raw/PackBits PSD/PSB raster channels now decode into the retained canvas in strips, with at most 1 MiB of RGBA scratch plus a channel row and row-offset tables. Unsupported compression/depth retains the existing admitted decoder. Malformed rows fail rather than partially publishing a document.
- Editable text, vectors, adjustments and groups decode their masks without allocating previews that are immediately discarded.
- Imported masks convert directly into sparse alpha tiles, without temporary full-size RGBA canvas/coverage copies.
- The PSD ImageData factory no longer allocates a matching-size canvas merely to allocate pixels.
- Integer-translation raster exports borrow existing bitmap canvases read-only; cleanup cannot resize those document-owned bitmaps.
- Corpus instrumentation records per-stage RSS, high-water RSS, external memory, array buffers, and heap use, retaining metrics even when a ceiling fails.

## Disk persistence groundwork (not an enabled cold-layer editor)

The existing IndexedDB cache now checkpoints immutable copy-on-write tile snapshots, copies/queues one tile payload at a time, and acknowledges dirty revisions only after the entire transaction commits. Failures preserve previous disk state and keep edits dirty for retry. Snapshots start when queued work executes, preventing queued full-surface pixel copies.

Rapid replacement surfaces are coalesced to one latest pending surface per ID rather than kept alive by queued closures. A 100-surface replacement test verifies only the in-flight and latest states are written. Deletion is an ordering barrier so a later replacement cannot be accidentally removed with the old checkpoint.

Metadata-only opening, revision/commit-checked individual tile reads, and pre-admitted regional hydration are available. Full-surface `getAll()` restoration has been removed. Missing committed tiles fail explicitly instead of becoming transparent pixels. A 50K sparse test hydrates one 256px tile while refusing an over-budget whole-document hydration.

This cache remains **derived data, not the authoritative document backing store**. The synchronous renderer/tool/history/project pipeline is not yet connected to paged reads, dirty-tile eviction, disk-resident undo and streamed native save/reopen. Therefore the three import fallbacks have **not** been removed and item 2 is **not complete**.

The retained flattened cases have approximately 325, 342 and 878 MiB of bitmap pixels respectively, before original source, masks and decoding scratch. The largest cannot fit the unchanged 512 MiB native restore limit with a retained-canvas representation. Raising that limit or substituting thumbnails as editable masters would not meet the request.

## Diagnostics

Final local qualification passed against unchanged source `de2f3aaf4d26b2a8534cc14c58ab93727fc960c698536551e267af7fde142bbb`: **997 application tests**, **10 native bridge tests**, **9 native core tests**, TypeScript and ESLint. Evidence is in `artifacts/local-hardening-report.json`. The IndexedDB tests use `fake-indexeddb` to exercise transaction semantics and fault injection; they are not macOS WebKit storage-quota qualification.

- Instrumented before: `artifacts/memory-before.json`: 3327.3 MiB, failed the 3072 MiB ceiling; export was a major high-water stage.
- First optimization diagnostic: `artifacts/memory-after.json`: 3659.1 MiB, still failed; retained as negative evidence.
- Row-decoder diagnostic: `artifacts/memory-row-decode.json`: 2630.1 MiB, passed, with zero native and Photoshop self-round-trip preview error. This single run is not sufficient to prove a hard process-memory ceiling.
- Same-source isolated repeats: `artifacts/memory-repeat-1.json` and `artifacts/memory-repeat-2.json`: 1996.0 and 1650.7 MiB, both passed with zero native/Photoshop self-round-trip preview error.
- Full retained campaign before the final queue-coalescing change: 8/8 passed, maximum 2461.9 MiB. The three declared flattened fallbacks remain declared, not converted into editable passes.
- **Final unchanged-source campaign:** `artifacts/compatibility-corpus-report.json`, **8/8 passed**; the original failing editable case peaked at **2555.8 MiB** with zero native/Photoshop self-round-trip preview error. Across all eight, peak RSS ranged from **840.4 to 2727.2 MiB**, below each unchanged 3072 MiB ceiling. Four layered cases, one composite-only case and three declared flattened cases passed. One PSB self-round-trip preview error was 0.002 levels (within its existing tolerance); these are self-round-trip checks, not independent Photoshop reference validation.

The pre-campaign failed full report is retained at `artifacts/memory-baseline-full-corpus.json`. The final corpus and local qualification report identify the same unchanged source. Item 1's measured regression is resolved in these retained workflows; this does not establish a hard process-RSS ceiling for arbitrary user projects. Item 2 remains incomplete pending the editor integration described below.

The original completed failing campaign is documented in `docs/release/candidate-completion-2026-09-23.md`. No forced garbage collection, threshold relaxation, flattened downgrade of the failing editable case, or removal of live comparison documents was used.

## Next storage integration boundary

1. Introduce an explicit disk-resident layer state distinct from absent/transparent pixels.
2. Prefetch viewport tiles and bounded edit regions asynchronously; hold document/layer/revision ownership across IO and cancellation.
3. Commit dirty tiles and undo diffs before eviction; do not evict after a failed write or treat cache presence as durability.
4. Stream project assets from backing storage, with atomic save and reopen admission using the same resident/scratch accounting.
5. Only then change Photoshop admission and require editable round trips for the three retained fallback fixtures.

The desktop frontend production build passed (existing large-chunk/dynamic-import warnings remain). No native `.app` was rebuilt or installed during this pass. No claim of an enabled disk-backed large-layer workflow or release qualification is made.
