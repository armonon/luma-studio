# Luma Studio — critical product and engineering review

Date: 2026-09-22. Scope: current Luma working tree, release evidence, targeted native UI inspection, and deterministic engine experiments. No application source was changed in this review.

## Verdict

Luma is a capable, unusually broad image-editor alpha, not a dependable general-purpose professional replacement yet. The next milestone should be correctness and release qualification, not another feature expansion or visual rewrite. In particular, the earlier P0 checkpoint does not establish that today's substantially changed working tree is safe.

This review found six reproducible implementation defects, an additional native visual failure whose cause is not yet isolated, and a stale mask-control guard. All 854 existing TypeScript tests still pass. That demonstrates missing regression coverage, not that those defects are harmless.

## Scope and fresh validation

- Baseline HEAD: `be6190b` (`Harden native events and recovery safety`), with 58 modified tracked files and 134 untracked paths before this report. Findings apply to the working tree, not just HEAD.
- `npx tsx --test tests/*.test.ts`: 854 passed, no failures/skips.
- `npx tsc --noEmit`: passed.
- CI-style `npx eslint app tests --max-warnings 0`: passed.
- Package-wide `npm run lint`: failed, 4 errors and 162 warnings in vendored PDF.js JavaScript. This is lint-scope/configuration drift, not four independently established runtime bugs.
- `cargo test --manifest-path src-tauri/Cargo.toml --quiet`: 7 passed.
- `cargo test --manifest-path crates/luma-core/Cargo.toml --quiet`: 9 passed.
- `npm run release:status`: 4/10 gates pass. Its PASS labels include file-existence checks and should not be interpreted as fresh behavioral certification.
- Inspected the existing `Luma Studio Exchange Review.app` through native accessibility and screenshots. Did not replace `/Applications/Luma Studio.app`, modify existing artwork, run paid AI requests, or deploy anything.
- Did not repeat all builds, every tool interaction, the entire visual matrix, camera corpus, tablet hardware campaign, or clean-machine installation. The last complete desktop matrix predates recent typography/vector/3D work.

## Release-blocking findings

### R1 — P1: Switching documents invalidates live pixel-memory accounts

**Reproduced.** `Studio.bindDocumentMemory` collects only the active document's surfaces, then calls a process-level budget's `retainOnly`. Inactive documents are still alive, but their accounts are removed. `SparseTileStore.bindMemoryBudget` subsequently returns early when it sees the same budget, leaving an unusable account.

Small reproduction: create/fill A; create/fill B; switch back to A; fill A. The second fill throws `Resident-memory account is no longer registered`. In a 256×256 experiment, two live surfaces held 524,288 bytes while the budget reported 262,144 bytes.

Worse, Fill changes the bitmap before synchronizing the precision surface. In a 16×16 reproduction, the failed fill left the bitmap blue, precision pixels red, and the history cursor unchanged. This is a consistency/undo defect, not merely an inaccurate diagnostic counter.

Sources: `app/engine/studio.ts:2239`, `app/engine/resident-memory.ts:103`, `app/engine/tile-store.ts:170`, `app/engine/studio.ts:4619`.

**Required fix:** reconcile the complete live session set, make account lifetime/rebinding explicit, and make mutation plus surface/history update transactional. Regress two-document paint/fill/mask/undo/close sequences, not only one-document budget tests.

### R2 — P1: Recovery can serialize a mixture of editing revisions

**Reproduced with controlled async interleaving.** Explicit project Save captures a revision ticket and checks it. `exportRecoveryDocument` directly encodes a mutable document without the equivalent protection. Layer serialization awaits PNG encoding before serializing precision tiles and later document metadata.

The experiment delayed a PNG callback and made a normal Fill while recovery was in progress. Decoding the accepted recovery archive produced a red bitmap and blue precision surface for the same layer. This is a valid archive with inconsistent content, so corrupt-ZIP tests do not catch it.

The coalesced queue's revision advances on requests, not every underlying edit; the debounce leaves an interval in which a stale/inconsistent result can still commit. Closing a document while an older checkpoint is in flight also deserves a tombstone/generation test: removing a recovery entry alone does not invalidate a later writer.

Sources: `app/engine/studio.ts:5364`, `app/engine/project.ts:503`, `app/engine/project.ts:565`, `app/studio/page.tsx:2384`, `app/engine/save-queue.ts`.

**Required fix:** immutable or copy-on-write checkpoint snapshots, or revision-checked encode/retry with document lifecycle generations; serialize commits per document. Test edits, tab changes, close/discard, and overlapping explicit Save during delayed checkpoints.

### R3 — P1: Raster export can switch to a different document mid-operation

**Reproduced with an injected async native-flatten boundary.** `exportImage` allocates output using the current document, awaits native flattening, then uses `this.doc` again for the portable fallback. That may now be another tab. The UI does not lock document switching for this export path.

Started PNG export for a red document A; switched to blue document B while a controlled native flatten returned null. The exported pixel was blue. With unequal sizes the output allocation can also belong to a different document than the rendered content.

Source: `app/engine/studio.ts:5434`.

**Required fix:** pin source document identity/revision across every async boundary; use a stable snapshot throughout rendering or cancel if it changes. Apply the same policy to PSD, artboard, tiled PNG and clipboard/export helpers, not just this one method.

### R4 — P1: Async AI results can be committed into the wrong document

**Reproduced locally, without a network request or uploaded artwork.** A mocked image-edit response switched from A to B while generation was pending. `generativeEditVariations` inserted `AI · fill` into B; A remained unchanged. The completion uses `this.doc.layers` rather than the initiating document identity.

Related source inspection found similar missing target-identity checks in `neuralSubject`, `samClickSelect`, and subject-mask caching. Those related paths were not independently exercised with model downloads in this review.

Sources: `app/engine/studio.ts:4774`, `app/engine/studio.ts:4925`, `app/engine/studio.ts:4746`, `app/engine/studio.ts:4942`.

**Required fix:** a shared async operation token containing document/session ID, layer identity, source revision, cancellation and disposed/closed state. Decide explicitly whether completion targets the original tab or is cancelled; never silently target the currently active tab.

### R5 — P1: Archive limits do not bound actual decoded project memory

**Reproduced at safe scale.** Archive validation counts unique ZIP entries and compressed/expanded file bytes. `deserializeDocument` concurrently decodes every layer; each reference to the same bitmap asset decodes another canvas. There is no aggregate decoded-pixel admission check before this fan-out.

A generated 1,063-byte archive with one 256×256 PNG referenced by 32 layers was accepted and produced 32 distinct canvases: 8 MiB of pixel backing before other overhead. This small test was intentionally not scaled to exhaustion. The allowed layer count is 100,000, and each individual bitmap can be much larger. Precision/history references require an equivalent reference-aware audit.

Sources: `app/engine/project.ts:49`, `app/engine/project.ts:301`, `app/engine/project.ts:595`.

**Required fix:** preflight the entire decoded object/reference graph, bound decode concurrency, reserve aggregate memory before allocation, and deduplicate immutable assets or use copy-on-write. An 8 GiB ZIP expansion ceiling is not a process RAM ceiling.

### R6 — P1 for affected typography: Rich styling breaks complex-script shaping

**Reproduced by instrumenting the real drawing path.** Plain Arabic `سلام` draws as one string. Adding underline switches to four independent `fillText` calls: `س`, `ل`, `ا`, `م`. Structured lines advance left-to-right through graphemes. Independent draws lose cross-character joining, kerning/ligatures and whole-run bidi layout.

This affects mixed style ranges, appearance stacks, decoration and baseline-shift paths. The new HarfBuzz outline/3D path does not replace this renderer. Therefore “complex-script typography complete” is too broad, even though the outline tests genuinely pass.

Sources: `app/engine/document.ts:405`, `app/engine/document.ts:426`, `app/engine/document.ts:468`, `app/engine/document.ts:2061`.

**Required fix:** share a shaped-run layout between visible text, decorations, bounds, outlines and export. Style effects should paint already-shaped runs rather than splitting text into isolated graphemes. Add Arabic/Hebrew/Indic mixed-run image goldens and export comparisons.

### R7 — P1 observed native failure: Active tab and visible canvas disagree

**Observed in the packaged review app; root cause not isolated.** The selected saved mesh document exposed its mesh layer, 1600×1200 status and mesh Properties controls, but the canvas still displayed the prior PDF's `LUMA PDF` artwork. Switching to the PDF tab, back to the mesh tab, and using Fit did not repair the mismatch.

Read-only project decoding confirmed that the saved file contains a mesh-backed Smart Object and a 1600×1200 bitmap. The observation does not establish that the project file itself contains the PDF or that a specific cache is responsible.

**Required fix:** isolate the live render/scheduling/target-binding failure and add a native screenshot assertion after every import and tab transition. Prior Open/Save/reopen evidence proves file/dialog/source-data behavior, not reliable visual presentation; downgrade that workflow's visual qualification until this passes.

## Additional confirmed/code-level issues

- **P2 — Sparse-mask Focus switch remains disabled:** the canvas Focus target button checks only `focusedLayer.mask`, while the rest of Focus recognizes `maskSurface` too (`app/studio/page.tsx:4087`). Existing sparse-only masks can have a disabled Mask button through this route. Use the common mask-presence helper and test this actual button.
- **P2 — Lint commands disagree:** CI checks `app tests`; `npm run lint` also checks generated PDF.js glue and fails. Explicitly separate first-party lint from vendor integrity/license checks; do not edit generated dependencies to satisfy application lint rules.
- **P2 — History marketing overstates retention:** the website says “Undo never throws work away,” but history deliberately prunes under node/byte budgets (`app/page.tsx:72`, `app/engine/operation-history.ts:387`). State bounded branching history and distinguish saved checkpoints from retained undo branches.

## Assessment across product areas

| Area | What is genuinely present | What still prevents a professional completeness claim |
| --- | --- | --- |
| Desktop shell / UX | Structural AppShell, panel metadata, docking model, shared command facade, contextual editors, tabs and persisted views | Current native canvas mismatch; stale sparse-mask control; limited screenshot matrix; much panel and pointer behavior still composed centrally in a 5,581-line page |
| Painting / retouch | Streaming stroke work, capture brushes, pressure-related controls, retouch tools and undo coverage | Multi-document memory failure; no matched end-to-end tablet latency/quality campaign; registration and synthetic stroke tests are not professional brush qualification |
| Layers / compositing | 27 blend modes, up to eight passes, masks, adjustments, 17 layer effects and editable filter stacks | Cross-backend/high-depth fidelity and real-project combinations need broader goldens; count is not parity |
| History / recovery / Save | Branching history, revision-checked explicit Save, remembered paths, dirty prompts and native atomic replacement | Mixed-revision recovery; failed mutations can escape history; close/checkpoint races need coverage; each document has its own history allowance rather than one total working-set budget |
| Large documents / speed | Sparse alpha/pixel surfaces, tiled CPU viewport, dirty rendering, bounded raster work and banded PNG composition | Process-wide memory accounting is incorrect across tabs; import allocations bypass aggregate admission; some operations safely refuse or require bitmaps; compressed PNG output still accumulates in memory before creating a Blob |
| PSD / PSB | Real importer/exporter, metadata preservation, compatibility warnings, narrow native 16-bit writer, source passthrough where eligible | Native 32-bit output is unavailable; many high-depth outputs convert to 8-bit RGB; some effects/filters remain preview/metadata-only; eight old real-file tests are not a 50–100 project reference corpus |
| RAW | Embedded source/settings for supported sensor pipelines, local DNG/TIFF-CFA work, OS decoding/preview fallbacks with provenance | Representative Canon/Nikon/Sony/Fuji/Panasonic corpus and color targets missing; proprietary formats are not uniformly nondestructive sensor workflows |
| Color / print | Floating-point masters, supported matrix/TRC and RGB LUT ICC paths, proofing infrastructure | RGB-centered document/export limitations; not a complete CMYK/Lab/spot/overprint/PDF-X workflow; inspection explicitly returns NOT_CERTIFIED |
| Typography | Fourteen bundled families; point/frame/path/vertical controls; structured styles; bounded HarfBuzz outlines and mesh lettering | Rich text shaping defect above; custom OpenType controls are partly metadata-only; outlines limited to 160 characters/four faces and selected layouts; preview and outline engines differ |
| Vector / PDF | Paths, booleans, offsets, appearance and reuse infrastructure; strict SVG/PDF delivery; editable PDF reconstruction | Editable PDF uses explicit replacement fonts, not embedded-font fidelity; clipping/transparency and other operators are restricted; vector PDF is RGB, not certified print delivery; source editability is not universally retained |
| Form / 3D | Tested static geometry/material exchange and source-backed objects saved in .luma; actual editable mesh return rather than only images | 8 MiB/64 parts/60K vertices/180K indices; 1600×1200 committed Luma render; no textured/rigged/animated full-scene interchange; scene cameras/procedural stacks not generally exchanged |
| AI | Selection-guided generation, provenance/prompt metadata, cancellation/error handling and local-model paths | Wrong-document async commits; real authenticated service/quality/cost/offline campaigns incomplete; detail synthesis/context fill must not be sold as document enlargement |
| Plugins / automation | Declarative action packages, recording/playback, batch isolation and conditional action infrastructure | Not an arbitrary native plugin ecosystem; full real-job replay coverage still needed; async operations need the same target ownership rules as interactive tools |
| Distribution / operations | Native file APIs, updater/crash plumbing and release validators | No qualifying signing/notarization, signed-updater failure campaign, remote crash/symbolication or clean-machine reports |

### Performance-specific judgment

The viewport is explicitly CPU Canvas2D; GPU compositing is an export/flatten option, and the native flatten path declines groups, adjustment layers and several advanced blend/color cases. This is not a universally native/GPU editing engine.

Sparse storage is valuable, but does not guarantee small process memory. Canvas mirrors, undo clones, per-document viewport caches, model heaps, import expansion and final compressed output are separate costs. Existing compatibility evidence recorded roughly 1.2–2.4 GiB peak RSS on its eight workflow cases. Those are historical harness measurements, not new packaged-app benchmarks.

The history-summary microbenchmark is useful but does not establish brush latency, frame time, startup speed or a Photoshop/Affinity advantage. Require release-build input-to-present p50/p95/p99 and peak process RAM on matched dense and sparse jobs before making those claims.

### Validation and release-specific judgment

The screenshot manifest has three references and still lists seven required future states, including multiple documents, floating/collapsed panels, Brush, Type and active transform. CI has Linux engine/bridge checks but no automated macOS interaction campaign. Existing corpus output is dated August 29, contains eight PSD/PSB cases and self-roundtrip references, not Photoshop-generated goldens or representative RAW cameras.

The release-status script also accepts `composite-only` within a variable named `corpusIsEditable` and does not bind all evidence to this source revision. Tighten the evidence definitions; a composite-only open is not a layered editable round trip.

### Security, privacy and operational boundaries

There are useful protections: local project paths are kept out of portable archives, native saves use temporary-file replacement, scripting access is development/opt-in rather than always exposed, plugin packages are declarative, and crash ingestion has body limits and sanitization. These are implementation observations, not a penetration-test pass. The decoded-memory amplification finding is a concrete availability risk. Authentication depends on the deployed trusted-header/proxy boundary; this review did not verify that boundary on every hosting target, exercise production credentials, upload user imagery, or establish a dependency-vulnerability clearance. Crash consent, retention, symbols and update trust still need end-to-end production evidence.

## Recommended order

1. Fix R1 first and prove bitmap/precision/history consistency under failure and document switching.
2. Introduce shared document-scoped async operation ownership; fix recovery, raster export, AI and model completions with it.
3. Add aggregate import/output-memory admission and bounded concurrency. Measure real peak RSS, not just tile counters.
4. Isolate the native stale-canvas failure. Require visual correctness on tab switch/import/save/reopen; fix the sparse-mask Focus route.
5. Unify rich-text shaping and add cross-renderer script/font goldens.
6. Freeze a reproducible candidate commit and update feature statuses and claims to that exact build.
7. Complete real PSD/PSB/RAW/PDF and long-session failure campaigns, then production signing/updater/crashes/clean-machine qualification.

Printer/output specifications and an installed, licensed Affinity build are external prerequisites for certification and matched competitor benchmarking. They are not prerequisites for fixing the reproduced engineering defects above.

Do not label this build 10/10, fully safe, or ready for a broad professional beta. Its differentiating features are worth preserving; the immediate priority is making ordinary work predictable.
