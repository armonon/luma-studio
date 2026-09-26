# Luma Studio — current-source critical review

Date: September 23, 2026, after the multi-layer/context-menu update.

## Verdict

Luma is a capable professional-editor alpha, not yet a qualified professional replacement. The most urgent problems are failure atomicity and consistency between UI entry points—not a shortage of tools. The new layer work succeeds on its happy paths, but this review found missing failure-path coverage in that same implementation.

This was a review, not a fix pass. No application implementation was changed. Diagnostics used tiny in-memory documents; no user project was edited. This is not a manual certification of every tool, camera, file format, installed binary, or operating-system version.

## Evidence

- The current source fingerprint matches the latest local qualification report: `5942b067225db2894835564e94341890b2cdc086a68f85e8a346057c47c00cbc`.
- That current-source campaign records 957 TypeScript tests, 10 native bridge tests, 9 native core tests, type checking and lint passing. These results were verified, not represented as a newly rerun full campaign.
- A fresh focused run of layer, transaction, project, clipboard and native-workflow regressions passed 32 tests. Output: `/tmp/luma-current-review-tests.log`.
- Additional bounded diagnostics reproduced the failures below. Publication failures were injected deliberately; they are not evidence that ordinary use always fails or that real machine memory was exhausted.
- Fresh `npm run release:status`: 4/10 evidence gates pass. This measures release qualification, not the percentage of working product features.

## Confirmed findings

### P1 — Bulk structural edits do not roll back failed publication

`commitStructural` clones metadata, mutates the live layer array, and only then publishes history. It has no rollback if publication throws. A controlled exception at the commit boundary reproduced all of the following on 16×16 documents:

| Operation | State after the reported failure |
| --- | --- |
| Group | New group and changed parent IDs remain |
| Delete | Both original layers are absent |
| Duplicate | New copies remain |
| Hide | Both layers remain hidden |
| Merge | Original layers are replaced by a 1×1 raster |

In every case the history cursor was unchanged and the document still reported `dirty: false`. Merge is especially dangerous: its `finally` cleanup shrinks the output canvas even though the earlier mutation already installed that canvas into the live document.

Locations: [structural commit](/Users/lillypad/luma-studio/app/engine/studio.ts:3618), [merge publication and cleanup](/Users/lillypad/luma-studio/app/engine/studio.ts:2844).

Required fix: stage structural changes and publish document/history atomically; restore topology, object ownership, resources and dirty state on failure. Fault-inject allocation, budget binding and history publication for every structural operation. Do not weaken the dirty-state or memory checks.

### P1 — Merge underestimates its own full-document working buffers

Merge reserves `width × height × 16` bytes. The CPU renderer creates seven full-frame scratch canvases, in addition to the merge destination. A fresh 19×19 merge created eight full-document canvases: 11,552 nominal RGBA backing bytes against a 5,776-byte operation reservation. Groups and additional rendering work can require more.

This is a verified allocation-accounting mismatch, not a measured process-RSS peak. At 4800×6000 the same eight backing surfaces represent approximately 879 MiB, before existing document layers, history, codecs and runtime overhead. The 1 GiB known-allocation admission ceiling therefore cannot be treated as a process-memory cap—or as a complete reservation for this operation.

Locations: [merge admission](/Users/lillypad/luma-studio/app/engine/studio.ts:2847), [renderer scratch](/Users/lillypad/luma-studio/app/engine/renderer.ts:100).

Required fix: use one renderer-derived allocation estimate or a tilewise merge, admit all simultaneous buffers, and measure packaged-process peak RSS under a controlled large-document campaign.

### P2 — Group transform controls can be successful no-ops visually

A group containing a 4×4 raster accepted `tx: 8`, committed a transform operation and retained that value, but a fresh 16×16 render was byte-for-byte unchanged. Group rendering recursively composites children without applying the group's transform. The Properties transform panel exposes these values for a selected group.

Locations: [transform mutation](/Users/lillypad/luma-studio/app/engine/studio.ts:3920), [group rendering](/Users/lillypad/luma-studio/app/engine/renderer.ts:623), [transform panel](/Users/lillypad/luma-studio/app/studio/page.tsx:5275).

Required fix: implement hierarchical group transforms consistently across viewport, masks, hit testing and export, or explicitly disable unsupported group transform controls. Grouping is currently organization/compositing functionality, not a complete transformable-object workflow.

### P2 — Row deletion bypasses the context menu's lock protection

The bulk deletion guard refuses a child inside a locked group. The row X button calls the older `removeLayer` directly; that method only checks the target's own lock. A bounded diagnostic locked the parent, confirmed the bulk refusal, then successfully deleted the child through the single-layer engine path used by the row.

Locations: [row action](/Users/lillypad/luma-studio/app/studio/panels/layers-panel.tsx:128), [single-layer deletion](/Users/lillypad/luma-studio/app/engine/studio.ts:3573).

Required fix: centralize ancestor/descendant lock policy and route every delete surface through it. Audit reorder, transform and other direct engine calls against the same policy.

### P2 — The new Group command is not recorded by Actions

Starting an action recording, grouping a layer with `groupLayers`, and stopping produces an action with zero steps. The older `groupLayer` records `groupActive`, but the UI now uses the bulk implementation. Several other new bulk commands similarly lack a selection-aware action representation.

Location: [bulk layer operations](/Users/lillypad/luma-studio/app/engine/studio.ts:2804).

Required fix: define serializable, replayable selection-aware operations and record only after successful publication. Unsupported recording must be explicit rather than silently omitted.

### P2 — Mixed-color complex-script text still splits shaping context

A fresh paint-call diagnostic for Arabic `سلام`, with only its first character recolored, recorded separate Canvas `fillText` calls for `لام` and `س`. The visible renderer partitions runs by the entire resolved style, including color. The separate HarfBuzz outline machinery does not automatically fix this Canvas path.

This confirms split paint/shaping calls; this review did not run a fresh font-by-font visual matrix. It remains a correctness risk for joining scripts and a canvas/export consistency gap.

Locations: [Canvas run segmentation](/Users/lillypad/luma-studio/app/engine/document.ts:417), [outline shaping](/Users/lillypad/luma-studio/app/engine/text-shaping.ts:106).

Required fix: shape with shared surrounding context before partitioning paint, then use compatible glyph layout for viewport, outlines and PDF output.

## Broader product assessment

| Area | What is established | What remains unqualified or limited |
| --- | --- | --- |
| Save/recovery | Accepted-save reopen admission, document ownership, dirty state and recovery regressions exist | New structural failure path above undermines the overall safety claim; complete installed-app Save As/reopen/quit campaign is still needed |
| Layers/history | Multi-selection, groups, context commands and happy-path undo have tests and prior direct UI checks | Failure rollback, lock consistency, group transforms and action recording above |
| Painting/selection | Sparse alpha surfaces, rich brush infrastructure, native SAM sample and clipboard bridge | No broad difficult-edge/ground-truth selection study or sustained real-tablet latency campaign establishes competitor parity |
| Large documents | Sparse viewport/alpha infrastructure and explicit admission checks | Dense merge and other bounded whole-bitmap operations remain; process-memory and long-session qualification incomplete |
| PSD/PSB | Latest retained corpus records 8/8 workflow passes | Four layered, three flattened fallback, one composite-only; self-round-trip references, no independent Photoshop goldens; report predates the current source |
| RAW/color/print | Development/color infrastructure and strict print-readiness reporting | Representative camera/profile corpus absent from the configured eight-case corpus; complete native RAW and large-document capabilities remain marked planned; print inspection explicitly returns `NOT_CERTIFIED` |
| Typography/vector/PDF | Structured text, bundled fonts, shaping and constrained editable/vector workflows | Mixed-style shaping above; vector delivery remains bounded by supported content/color/complexity, not arbitrary editable PDF/SVG parity |
| 3D/Form | Editable asset data and bounded mesh/text exchange | Static supported assets are not arbitrary scene interchange; mesh admission remains 60,000 vertices / 180,000 indices / 8 MiB |
| AI/security | Total streamed upload limit and pre-parse rate/concurrency admission fix the older ordering gap | Deployment must enforce trust in authenticated-user headers; in-memory per-process limits are not a distributed quota or independent production security audit |
| Shell/UI | Central registries, docking infrastructure and contextual controls are real | Direct command bypasses remain; only three persisted visual references, with seven required states still listed as future work |
| Distribution | Native build and release-checking infrastructure | Production updater endpoint/key, updater failure campaign, notarization report, remote crash report and clean-machine evidence still fail release gates |

The eight-file retained corpus records about 1.16–2.13 GiB peak RSS and 9.5–41.4 seconds per complete workflow. These are historical machine/load-dependent workflow measurements, not isolated open-time or matched Photoshop/Affinity benchmarks. Do not reuse older 4/8 reports as the latest result, and do not call the current 8/8 full editable fidelity.

Sources: [compatibility report](/Users/lillypad/luma-studio/artifacts/compatibility-corpus-report.json), [visual manifest](/Users/lillypad/luma-studio/tests/visual-regression/manifest.json), [capability status](/Users/lillypad/luma-studio/app/engine/edition.ts:65), [print-readiness scope](/Users/lillypad/luma-studio/app/engine/print-readiness.ts:34), [native selection qualification](/Users/lillypad/luma-studio/docs/release/clipboard-selection-qualification-2026-09-23.md).

## Recommended sequence

1. Transactional structural edits and merge resource ownership; add failure regressions before more feature work.
2. Correct merge memory admission or tilewise compositing.
3. One lock/selection/command policy for menu, shortcut, row buttons and action replay.
4. Correct or disable group transforms; complete selection-aware Actions recording.
5. Unify visible and exported text shaping.
6. Complete persisted visual references and real-job compatibility/latency/RSS campaigns.
7. Finish signing/notarization, updater interruption, crash collection and clean-machine qualification.

The standard should be: every supported operation either completes correctly or leaves the user's document intact when it fails. Passing happy-path tests alone does not establish that standard.
