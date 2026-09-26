# Source-backed Photoshop layer qualification — 2026-09-23

## What changed

The three retained RGB8 Photoshop projects no longer require a flattened import. Their compressed original is shared as an immutable base; rendering and local edits decode individual tiles, while only modified tiles occupy the resident precision store. This is compressed-source-backed editing, **not general disk paging**. The compressed source remains in RAM.

- Automatic import tries the bounded source path when the conventional canvas stack would exceed admission. Unsupported source formats still use the explicitly reported composite fallback; malformed channels fail before document publication.
- Raster raw/PackBits rows are validated before use. Retained row indexes have a 16 MiB aggregate ceiling. The decoder shares a bounded 32 MiB row-band cache and one working tile. Preview canvases have a global 32 MiB budget, rather than multiplying a per-layer allowance across the whole stack.
- Paint, erase, local fill, delete, copy/cut, selection hit testing and color sampling consume the tile master. Existing affine layer transforms remain document metadata.
- Undo/cancel/failed publication restore source identity without retaining a decoded tile. Edits retain bounded tile patches. Immutable bases are shared across history clones.
- Admission includes sources retained only by deleted-layer history, across open tabs and after project restore. Closing the last owning tab releases its admission account; source serialization reserves are counted once per shared buffer.
- `.luma` v10 stores one compressed source, source-layer references, edited tiles and deletion markers. Reopening deduplicates both source buffers and validated providers. Versions 1–9 remain readable; older applications cannot read v10 archives.
- The Photoshop writer borrows unchanged compressed channels. Changed rows are encoded under an aggregate allocation guard, including PSD/PSB row-table conversion. Codec scratch, output growth and repeated blend-pass bytes are admitted before writing. No full raster layer stack is created for this path.
- Derived IndexedDB tile checkpoints deliberately decline these surfaces: an edit-only checkpoint is not a complete source-backed document. Native project/recovery serialization is authoritative.
- Source-backed documents use the portable tile-aware compositor; whole-document native/GL paths decline them rather than accidentally materializing the stack.

## Gates and evidence

The three focused source-backed fixtures passed actual largest-layer pixel edit → native save/reopen → Photoshop export/reopen, with zero measured preview drift. Their trial peaks were 1639.3, 1771.5 and 2277.5 MiB; durations were 13.4, 23.5 and 28.7 seconds. These are measured workflow peaks, not a promised process-memory limit. Evidence: `artifacts/source-backed-pixel-corpus.json`.

The corpus manifest now requires 16, 22 and 9 editable layers respectively, with no flattened-fallback allowance. The first two Photoshop record counts also contain closing group markers, which are not additional editable layers. The original 3072 MiB / 120 second ceilings and 512 MiB project decode-admission ceiling remain unchanged.

Final candidate evidence is recorded in:

- `artifacts/local-hardening-report.json` — types, engine regressions, lint and Rust tests.
- `artifacts/compatibility-corpus-report.json` — the complete eight-case retained corpus.
- `tests/photoshop-tile-source.test.ts` — render, edits, PSD/PSB conversion, persistence, reopened undo/redo, cancellation, publication failure and malformed offscreen channel coverage.

Final local qualification passed on source `69ecc2d99bbcd5ad52ababa94668e09f0dc9318eb639faa17ed20b39b0053a19`: 1006 application tests, 10 native-bridge tests, 9 native-core tests, type checking and lint. The desktop frontend build passed; existing chunk-size/dynamic-import warnings remain. This is a build and automated-engine qualification, not a GUI test of an installed macOS bundle.

**Final full-corpus rerun is not green.** The first three cases passed, the fourth reached the 125-second worker timeout, and the fifth was explicitly aborted when this validation run was stopped. Three cases were not executed. At that time the eight-core host reported load averages between 195 and 271, over 100 runnable processes, and roughly 14.4 GiB of used swap; competing builds were running outside this task. Only this task's corpus supervisor was stopped. Earlier full runs passed 8/8, but those do not substitute for a clean run of the final allocation guards. The current source-matched corpus report intentionally retains `completed: false` and `interrupted: true`. Rerun the same eight-case command on a quiet host before treating the final candidate as corpus-qualified; do not increase its time or memory limits.

## Explicit boundaries

This does not certify arbitrary large-document operation or Photoshop fidelity. Automatic source-backed admission is restricted to validated RGB8 files, at most 4096 source records, a compressed source plus 192 MiB reserve within 512 MiB, supported raw/RLE raster channels, and existing safe document dimensions. Source raster masks, extra channels and ZIP/high-depth sources are outside this specialized import path.

Local fill/delete and paint history have 128 MiB operation bounds. Dense generated fills, destructive filters and content-aware warps on source-backed layers reject explicitly; use separate paint layers or editable smart filters where appropriate. Native `.luma` retains masks and affine transforms, but source-backed Photoshop export currently rejects new masks, non-unit scale/rotation/skew and fractional translation instead of silently flattening. Transformed/masked export, arbitrary disk-resident pixel surfaces and general asynchronous disk paging remain separate work.

The retained corpus is eight projects, not the required 50–100 real-world professional qualification corpus. Its comparisons are structural and self-roundtrip checks, not independently rendered Photoshop golden images. No newly built macOS application was installed or signed as part of this storage campaign.
