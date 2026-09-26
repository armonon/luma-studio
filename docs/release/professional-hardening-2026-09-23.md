# Professional hardening — save memory and transactional editing

This is a verified engineering increment toward professional reliability, not a claim of Photoshop parity or a 10/10 release.

## Implemented

- Project archive admission streams decompressed entries while retaining only a 32-byte header. It verifies actual entry lengths against declared sizes and configured limits instead of building an entire temporary Blob just to inspect a header. Save preparation reuses the inspected prefixes. Existing archive, expansion, bitmap and aggregate decode ceilings remain unchanged.
- Project ZIP generation checks the output byte ceiling as chunks are emitted and stops before publishing an oversized archive. Accepted archives retain the existing project format and round-trip through the existing decoder.
- Captured-brush restoration is serialized to reduce concurrent image-decoder scratch work.
- Gradient/pattern generation reserves known scratch memory before pixel generation and uses the shared staged raster-edit transaction. Perspective warp uses the same transaction and restores the original transform as well as bitmap/surface ownership if publication fails.
- Fill and legacy bitmap Delete use a bounded regional transaction. Pixels and affected precision tiles remain recoverable through history publication. Context state is restored on exceptions. Checkpoints and action recording occur only after successful publication.
- If Photoshop descriptor restoration fails during project reopen, the original PSD/PSB bytes are retained across subsequent saves. A compatibility error blocks misleading Photoshop export. The editable Luma document can remain available; this does not invent missing descriptors or claim a faithful Photoshop round trip.

## New regression coverage

- Fill and legacy Delete history-publication failures reproduced before the regional transaction fix.
- Synchronization and publication fault injection for gradients, patterns, perspective warp, Fill, and legacy Delete; unchanged pixels, tile bytes, transforms and history on failure; successful retry followed by undo/redo.
- Refusal of over-budget generator/warp scratch on a small existing layer in a large document without touching its state.
- Streaming header inspection with whole-entry accumulation deliberately disabled; oversized and incorrect entry-size rejection; bounded ZIP output and reopen.
- Two consecutive save/reopen cycles retaining a deliberately truncated Photoshop source while exposing the compatibility error.

Focused final run: 42 tests passed. The full `qualify:local` campaign passed 936 engine tests, 10 native bridge tests, 9 native core tests, typechecking and repository lint. Desktop frontend build also passed with existing bundling warnings. The source-bound report is `artifacts/local-hardening-report.json`, source `2a07bb3cdeca7d76f8955e2cd806ec4c7671b3d424700b0018c712c4475eb3f1`, with `unchanged: true`. Recheck that hash after subsequent source edits.

Release status remains 4/10 evidence gates. The standard compatibility command refuses the eight-case configured corpus because it requires at least 50. An explicitly smaller diagnostic run is separate from release qualification; the production gate thresholds were not lowered.

The completed current-source diagnostic (`artifacts/compatibility-professional-diagnostic-2026-09-23.json`) passed **3/8 workflows**: two layered and one declared flattened fallback. Four were refused by aggregate decode admission; one composite-only case exceeded its 3,072 MiB RSS threshold at 3,125.2 MiB. This is fewer passes than the older 4/8 report. The runs are not a controlled before/after performance benchmark, so neither a speed improvement nor the cause of the RSS difference is established. The diagnostic does establish that the current product still fails this real-project acceptance set. The older canonical report was not overwritten, and remains visibly stale in release status.

## Still required for a professional replacement

| Area | Acceptance evidence still needed |
| --- | --- |
| Compatibility | 50–100 independent real PSD/PSB/RAW workflows, Photoshop visual/structural references, and explicitly tracked editable vs flattened results |
| Memory/performance | Lazy/streamed document restoration beyond current admission bounds; controlled native peak-RAM, brush latency, pan/zoom and long-session measurements |
| Selection/painting | Matched difficult-edge masks and real tablet/pressure/long-session tests, including packaged cold-start inference |
| Typography/color/print | Unified visible/export shaping, mixed-style complex-script reference images, camera/profile coverage and agreed printer/PDF-X/ICC targets |
| UI/native workflows | Missing persisted visual baselines, complete contextual/tool matrix, and native Save As/reopen/quit tests |
| Distribution | Production notarization, signed updater and interrupted-update evidence, real crash collection and clean-machine installation |

No memory ceilings were raised, original files were not overwritten, and the installed Mac application was not replaced. Engine admission remains an estimate of known allocations—not a hard total process-RAM ceiling. Archive streaming does not remove the retained source archive, decoded document, history, codec or final output memory requirements.
