# Pass 11 — bounded soft masks, clipping and grouped reimport

## Implemented

- SVG/PDF export of sparse and legacy layer/group alpha masks. Missing sparse tiles retain default alpha; uniform tiles stay rectangles. Existing variable mask samples become bounded grayscale image tiles, not flattened artwork.
- Aggregate admission: at most 4,096 mask records, 16 MiB raw mask storage, 256 px tile edge; SVG encoding capped at 64 MiB. Legacy masks exceeding those limits refuse before reading pixels. No per-layer allowance multiplication and no document-sized sparse-mask expansion.
- Multi-member vector-base clipping, including stroke/paint alpha, base Fill/master opacity, grouped/separate composition, hidden intermediate members and combined masks. Raw base alpha and the base's own mask remain distinct, matching the compositor. Raster, adjustment and group clipping bases still refuse.
- Fixed clipping-base lookup: upper members no longer clip against an adjacent clipped member's silhouette.
- SVG uses a bounded identity filter when needed to make WebKit isolate overlapping masked paints/children. Single-paint paths avoid this offscreen filter. The filter preserves vector source in the file; receiving applications still control their own rendering memory.
- PDF uses grayscale luminosity soft masks and vector alpha soft masks, applied to complete Form XObjects. Fill opacity remains a separate stage from master opacity.
- Editable SVG import now retains groups, nested isolation/opacity, sibling order, transforms and object titles. Group IDs are regenerated, so duplicate input IDs cannot alias parents. Group nodes count toward existing 512-layer/32-depth admission. Malformed worker hierarchies reject before installation.
- Invert, feather, automatic luma and neural mask commands now refuse locked targets before pixel/history/dirty-state changes. Unlocked mask undo/redo remains covered.
- Export preflight explicitly discloses that masked output cannot yet be reimported editably in Luma. No automatic flattening, outlined text or lossy fallback was added.

## Verification and interpretation

The new regression cases cover exact mask encoding, 50K sparse-mask allocation behavior, aggregate admission, clipping semantics, independent Poppler PDF rendering, grouped SVG rendering, save/reopen/edit/undo, rejection safety, names and locked masks.

`docs/release/check-vector-mask-rendering.mjs` generates current-source fixtures under the qualification lock. Each fixture includes a `.luma` master, SVG, Node-rendered reference and PDFs where applicable. Chromium and WebKit reopen the master with Luma's compositor and independently decode its SVG. Reports contain full-resolution RGBA/alpha means, worst delta, changed-pixel fraction, fixture/project/harness hashes and unchanged-source checks. This is synthetic delivery validation, not a real professional job or installed-app certification.

Tolerance remains RGBA mean ≤1.5, alpha mean ≤1, and ≤2.5% of pixels with any channel delta >8. Worst edge deltas are reported even when means pass. PDF comparisons use a white backdrop and therefore do not independently qualify transparent PDF rendering.

### Preserved failures

- Skia's SVG loader omitted embedded PNG mask images. It is not used as a purported full masked-SVG consumer. Unit tests instead decode and verify every mask sample; actual Chromium/WebKit SVG rendering verifies the whole composition.
- WebKit initially applied a group mask independently to overlapping children. A real identity filter fixes the isolation behavior; CSS isolation alone did not.
- Node canvas and macOS WebKit quantize alpha differently (e.g. Canvas globalAlpha 0.45 becomes 114 versus 115). A separate-clipping fixture exceeded the unchanged cross-backend alpha threshold (mean 1.0400065). This discrepancy remains explicit in `nodeReferencePass: false`; it is not relabeled a pass. The browser delivery check compares independent SVG decoding against the actual browser Luma compositor, with the same tolerances and saved project, not a regenerated SVG reference. Preliminary browser comparisons passed all 16 cases; worst mean RGBA was 0.0046875 and worst mean alpha 0.00100912 on those cases. Cross-backend bit identity is not claimed.
- First full qualification compiled the native bridge but timed out before test output. Failed receipt/logs are preserved at `artifacts/vector-pass11-first-qualification-anUQZS/`. A rerun passed all 28 native bridge tests. Do not turn the timed-out run into release evidence.

## Remaining boundaries

This does not complete the roadmap. Masked/clip SVG reimport, general PDF structure reconstruction, text delivery fidelity/conversion, localized effect rasterization, raster/group clipping bases and richer paints remain. No Photoshop/Affinity fidelity claim, printer certification, process-memory ceiling, signing/notarization, clean-machine qualification or numerical score increase is inferred from these tests.

Native packaging/installation is separate: a desktop frontend build does not replace the already-installed application. Current changes must not be described as installed until an artifact is actually built, installed and verified.

## Final source and receipts

Source: `50773024c54e3d0f0ccef9567cb9b388d72efa9475b60481695ad29dd9681ecc`.

- `artifacts/local-hardening-report.json`: **1,272 engine tests, 28 native bridge tests, 9 native-core tests**, types and lint pass; unchanged source. One existing unused `activePreset` warning remains. A newly added test initially used the action recorder's nonexistent `.length`; type checking caught it. The corrected test records an action and verifies the actual returned step list is empty, followed by a full rerun.
- `artifacts/vector-mask-browsers-LvVtD5/report.json`: **16/16 browser delivery comparisons pass**, same source. `nodeCanvasConsistencyPass` remains **false** for the documented Node/WebKit alpha case. Both results are visible; no tolerances changed.
- `artifacts/vector-delivery-ui-n22Q0T/report.json`: real preflight and SVG/PDF downloads, soft-mask `.luma` reopen/export, focus/Escape, stale-revision refusal and blocked-object routing; zero page errors. Preflight reviewed visually. Browser shell only, not native save dialogs.
- `artifacts/shell-matrix-0nrHkZ/report.json`: **21/21 existing visual references pass**, largest compared mean delta **0**; real tool/docking/transform and recovery/reload checks. No reference replacement.
- `artifacts/vector-delivery-pass11-build.json`: desktop frontend production build passes at unchanged source. Existing large-chunk/mixed static-dynamic import warnings remain. No install, signing or distribution claim.
- `git diff --check`: passed.

PDF previews and browser mask output were visually inspected using the PDF skill's render/verify workflow. Full-resolution comparison receipts supplement inspection; neither substitutes for real project qualification.

## Current independent Photoshop repeat

`artifacts/photoshop-external-E1mjAl/report.json` reruns the three retained real projects at the final source above. Source code, manifest and private original files remained unchanged. All three completed the full open → edit → native save/reopen → Photoshop export/reopen sequence. Native save/reopen pixel deltas were zero; compared external structures had no differences. **0/3 full workflows pass** because import/edit rendering still fails the unchanged visual gates.

Import deltas remain: `private-ndw` alpha MAE **1.703701**; `private-sattari-music-psb` RGB MAE **3.512390**; `private-flme-psb` RGB MAE **12.058873**. The corresponding Photoshop-to-Photoshop delivery comparisons are substantially closer, but this does not make the Luma editing previews correct. The third project's Node render visibly substitutes the script lettering. Earlier exact-font WebKit diagnostics also retain failures, so missing Node fonts cannot explain away the entire gap.

This is still a 512px-long-edge pilot with headless Luma canvas, not full-resolution, installed-app or font-layout qualification. The next engineering campaign must address exact-font layout/coverage and complete external editability before any overall score increase. Printer/PDF-X/ICC requirements were requested separately; no print certification is claimed without them.
