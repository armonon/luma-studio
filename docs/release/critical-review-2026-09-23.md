# Luma Studio — critical review, September 23, 2026

## Verdict

Luma is a substantial, feature-rich image-editor alpha with real editing infrastructure. It is not yet a qualified professional release. The largest remaining risks are consistency at failure boundaries, save/reopen compatibility, packaged-runtime behavior, and incomplete external qualification—not a shortage of tools.

The existing regression suite is green, but targeted negative tests found failures outside its coverage. Do not describe the product as universally crash-safe, Photoshop-equivalent, or fully qualified for large documents. This review does not assign an arbitrary numerical product score.

## Scope and evidence

Reviewed the current dirty working tree, not just committed HEAD (`be6190b`). No application implementation was changed. The review combines source inspection, fresh tests, bounded failure injection, a sampled native workflow in the disposable **Luma Clipboard Final Review.app**, and inspection of existing qualification reports. It is not a manual test of every tool, operating-system version, or file format.

Fresh checks:

| Check | Result |
| --- | --- |
| `npx tsx --test tests/*.test.ts` | 887 passed; zero failed/skipped |
| `npx tsc --noEmit` | Passed |
| `npm run lint` | Passed |
| `cargo test --manifest-path src-tauri/Cargo.toml --quiet` | 10 passed |
| `cargo test --manifest-path crates/luma-core/Cargo.toml --quiet` | 9 passed |
| Four bounded diagnostic scenarios | Save/reopen mismatch, failed-filter mutation, failed-native-Cut paste failure, and split Arabic painting calls reproduced |
| Packaged Smart Select sample | Requested SAM; resulting history operation was Magic Wand |
| `npm run release:status` | 1/10 evidence gates passed |

The release-gate count measures available, current qualification evidence—not the percentage of working features. Three regression gates require a new source-bound `qualify:local` run despite today's manually run tests passing. Several other gates need external evidence, not another unit-test run.

Temporary diagnostic source: `/tmp/luma-critical-review-20260923.ts`. Results: `/tmp/luma-critical-review-reproductions-20260923.log`. Test logs use `/tmp/luma-critical-review-{tests,types,lint,native,core}-20260923.log`.

## Priority findings

### 1. P1 — Save can succeed for a project that the decoder refuses to reopen

**Evidence:** A bounded synthetic document with 65 raster layers referencing a shared 1024×1024 canvas passed `Studio.prepareProjectSave`. Its approximately 23 KB archive was then rejected by `decodeLumaProject`: `Project exceeds the aggregate decoded-memory ceiling`. Sharing one source canvas deliberately keeps the diagnostic small; this is an engine-level constructed case, not a claim that 65 ordinary UI-created layers always fail.

**Cause:** Save admission estimates current serialization work, whereas decode admission counts independently restored mutable references against a separate fixed ceiling. The encoder does not check the resulting manifest against the decoder's admissibility contract before returning success.

**Impact:** A successfully written file can be unusable in the current application. The file bytes are not destroyed, but successful Save is not sufficient assurance that closing is safe. Recovery uses the same archive machinery, so recovery compatibility also needs explicit testing.

**Locations:** `app/engine/studio.ts:5648`, `app/engine/project.ts:232`, `app/engine/project.ts:1065`.

**Required outcome:** Every accepted save must have a supported reopen path. Share admission rules between save, load, and recovery; reject before reporting success when necessary. Add round-trip tests near the reference-count, history, asset, and decoded-memory boundaries. Do not solve this by simply removing the decoder's protective ceiling.

### 2. P1 — A failed destructive filter can leave changed pixels without an undo entry

**Evidence:** On a 16×16 red raster, inject an exception at `syncLayerSurface`, then run Invert. The method throws, but a sampled pixel changes from red to cyan and the history cursor does not move. The injection models a surface synchronization failure; it did not exhaust actual machine memory.

**Cause:** `filter` mutates the bitmap and action state before synchronizing precision surfaces and committing history. No transaction rolls those changes back when synchronization fails.

**Impact:** The reported failed operation has actually changed the document, with no corresponding undo node. Bitmap and precision representation can disagree.

**Location:** `app/engine/studio.ts:5332`.

**Required outcome:** One shared transactional contract for destructive edits: staged state, allocation admission, atomic publication, history commit, and rollback on any exception. Audit radial warp, perspective crop, and selection refinement next; their mutation/commit order was inspected, but equivalent failures were not independently reproduced here.

### 3. P1 — Failed native Cut publication leaves normal Paste unable to retrieve retained pixels

**Evidence:** Simulate a rejected native clipboard write. Cut removes the source pixels and retains the internal clipboard. The notification says the pixels remain in Luma, but native Paste requires a matching system marker or attempts a system image read. With no system image, Paste fails. Undo successfully restores the removed pixels.

**Cause:** The command executes `cutPixels` before the asynchronous native write succeeds. The internal fallback is not reachable through the normal native Paste path when that write failed.

**Impact:** Recoverable workflow failure, not immediate irreversible loss. A user is told the content was retained but cannot paste it normally. This is a gap in the newly added cross-app clipboard work.

**Locations:** `app/studio/page.tsx:2794`, `app/studio/page.tsx:2811`, `app/studio/selection-clipboard-events.ts:13`.

**Required outcome:** Finalize a cut only after successful publication with document/revision ownership checks, or provide an explicit and reliable internal-paste recovery path. Do not blindly substitute stale internal content for a genuinely foreign clipboard. Test rejection, oversized PNG, revision changes, and simultaneous clipboard writes.

### 4. P1 — Desktop Smart Select has a model-download policy defect and fell back in the sampled native run

**Evidence:** A fresh request to the configured SAM model's encoder URL redirected from `huggingface.co` to `us.aws.cdn.hf.co`. The desktop CSP allows Hugging Face origins but not this CDN origin. In the disposable native app, choosing SAM and clicking the canvas showed model loading; the resulting history entry was **Magic wand**, not SAM click select.

**Certainty boundary:** The missing CSP origin is confirmed, and the native fallback is observed. A WebView network error stack was not captured, so the CSP defect should not be represented as the only possible reason for that observed fallback.

**Locations:** `src-tauri/tauri.conf.json:34`, `app/engine/neural.ts:219`, `app/engine/studio.ts:5135`.

**Impact:** A Node accuracy benchmark does not demonstrate that the shipped desktop tool can load or execute the same model. The previous single-image 97.54% overlap result remains a pilot, not Photoshop-level accuracy qualification.

**Required outcome:** Bundle verified model assets or narrowly allow the required verified download origins; preserve CSP protection. Add cold-cache packaged-app tests and make fallback unmistakable to users. Then measure accuracy on a diverse, labeled selection corpus inside the target runtime.

### 5. P2 — Rich-text styling still breaks shared shaping context

**Evidence:** Drawing Arabic `سلام` with only the first character's color changed produced separate Canvas `fillText` calls for `لام` and `س`. The full resolved style, including paint color, determines shaping-run boundaries.

**Impact:** Color-only changes divide joining text into independent shaping calls. The earlier fix for uniformly styled decorated Arabic is valuable but does not qualify mixed-style complex-script typography. This diagnostic verifies call separation; a full visual/font matrix was not run.

**Locations:** `app/engine/document.ts:418`, `app/engine/document.ts:406`, `app/engine/text-shaping.ts`.

**Required outcome:** Shape with surrounding context before splitting paint operations. Unify glyph layout across the visible canvas, outlines, and PDF delivery. Test Arabic joining across color changes, Indic shaping, bidi punctuation, ligatures, variations, and font fallbacks with visual references. Canvas support for a subset of OpenType settings is not equivalent to the separate HarfBuzz path honoring all requested settings.

### 6. P2 — AI request limits apply after multipart body parsing

**Evidence:** The edit endpoint calls `request.formData()` before validating individual file sizes. Its rate/concurrency permit is acquired after parsing and hashing source data.

**Impact:** The 50 MB per-file checks do not themselves bound the memory consumed while receiving/parsing an oversized or multipart-heavy request. This is source-confirmed ordering, not a live load-test result or demonstrated production exploit.

**Location:** `app/api/ai/edit/route.ts:110`.

**Required outcome:** Enforce total body limits at the trusted ingress and/or a bounded streaming parser; obtain concurrency/rate admission before expensive parsing and hashing. Verify deployment trust for the authenticated-user header. No production header-spoofing vulnerability was established by this review.

## Wider product assessment

| Area | What is genuinely present | Remaining limitation or qualification gap |
| --- | --- | --- |
| Document safety | Dirty state, native paths, save ownership checks, close/recovery protections | Save/load contract and transactional filter failure above remain blockers |
| Shell and context | Structural AppShell, registries, docking metadata, contextual editors | Large orchestration modules remain; sampled testing is not complete desktop parity proof |
| Selections and masks | Sparse alpha infrastructure, mask editing, bounded selection operations | Native SAM availability and diverse edge-quality evidence are incomplete |
| Clipboard | Native PNG/TIFF bridge, transparency, stale-clipboard protection | Failed-Cut path above; reverse Photoshop-to-Luma qualification remains incomplete |
| Painting | Substantial brush/captured-tip and selection-aware editing machinery | No representative long-session tablet latency/quality campaign proves Procreate parity |
| Large documents | Sparse surfaces, memory accounting, guarded operations | Accounting is not a process-RAM ceiling; whole-bitmap operations and admission gaps remain |
| Rendering and color | Tiled rendering and a native flatten path | Native flatten rejects important document configurations; some effects/transforms rasterize through 8-bit Canvas |
| PSD/PSB | Layered import/export paths and compatibility reporting | Current real-file evidence includes rejected reopen operations and flattened fallbacks; no sufficient external-golden campaign |
| RAW | Development infrastructure and format-dependent paths | No representative Canon/Nikon/Sony/Fuji/Panasonic corpus proves full camera support |
| Typography | Bundled fonts, editable text, bidi and HarfBuzz infrastructure | Visible layout and export are not yet one consistently qualified shaping pipeline |
| Vector/PDF | Editable construction and constrained delivery/import paths | Vector delivery has explicit masks, grouping, blends/effects and style restrictions; PDF font substitution is not original-font fidelity |
| Live 3D/Form | Editable parameters and interchange infrastructure | Supported static geometry/render workflows are not arbitrary scene round-trip parity; fixed render resolution is a delivery constraint |
| Print | Preflight/readiness checks | Readiness explicitly reports `NOT_CERTIFIED`; no PDF/X, ICC, printer/RIP certification established |
| Plugins | Declarative action/package infrastructure | Not a general native plugin ecosystem |
| Distribution | Native application and release checking infrastructure | Production signing/notarization, updater campaign, remote crash collection, and clean-machine qualification lack completed evidence |

### Compatibility evidence needs one authoritative source

The existing `artifacts/compatibility-corpus-hardening-2026-09-22.json` records **4/8 passing** real PSD/PSB workflows. Four fail at the aggregate project decode ceiling. Of the four passing cases, two are layered, one composite-only, and one flattened fallback. References are self-round-trip comparisons rather than Photoshop-produced goldens. This report predates the latest working tree and was inspected, not rerun today.

Recorded peak process RAM for its passing cases is approximately **1.3–2.8 GiB**. That is not a fresh native performance measurement, but it demonstrates why a 1 GiB engine admission budget must not be marketed as a hard process-RAM limit.

The release-status command reads a different, older corpus report and prints an 8/8 summary, while still correctly failing the gate for missing qualifications. Consolidate these reports and show source hash, runtime, preservation mode, and fidelity coverage next to every pass count. A flattened document opening is not proof of editable compatibility.

### UI is improved, but not fully validated

The shell skill's registry/context architecture is substantially represented. The remaining orchestration is still concentrated: approximately 5,724 lines in `app/studio/page.tsx` and 5,994 in `app/engine/studio.ts`. Size is a maintenance risk, not by itself a defect or justification for another visual rewrite.

In the sampled native selection workflow, refinement controls were repeated between contextual options and the inspector, and a bright Focus filmstrip was visually inconsistent with the dark workspace. These are polish findings, not evidence that the controls cannot function.

The visual-regression manifest has three references at 1920×1080, 1440×900, and 1280×800, but still lists seven future states: empty document, multiple documents, floating panel, collapsed panel rail, brush selected, text selected, and transform active. Therefore the requested complete shell-state regression matrix is not finished. No new full screenshot-diff campaign was run today.

### Previous fixes should not be reported as still broken

Today's passing regressions and source inspection support substantial progress on cross-tab memory accounting, Fill/Clear rollback, asynchronous document ownership, recovery revision/close handling, aggregate project decode admission, canvas reattachment/cache identity, uniformly styled Arabic rendering, and sparse-mask handling. The new findings concern remaining paths or mismatched contracts, not a reversal of all that work.

## Recommended order

1. **Stop unsafe success:** make accepted saves reopenable and make failed destructive edits leave document/history/actions unchanged.
2. **Finish clipboard failure semantics:** prove Cut/Copy/Paste under native failure and race conditions.
3. **Qualify the packaged selection runtime:** correct model asset delivery, expose fallback, then measure accuracy across a representative labeled corpus.
4. **Unify typography layout:** ensure on-canvas appearance and delivery use compatible shaping behavior.
5. **Close resource-admission gaps:** bound full request bodies and audit remaining whole-bitmap operations; measure total process RAM, not only accounted surfaces.
6. **Consolidate compatibility evidence:** run open → edit → save → reopen → export against external visual/structural references, preserving failure and flattening distinctions.
7. **Complete desktop/state and release qualification:** fill the visual matrix, exercise long sessions, then signing/notarization, updater failure testing, crash collection and clean-machine installation.

Do not add more tools as the response to these findings. The next milestone should prove that supported operations either complete correctly or leave the user's document untouched when they fail.
