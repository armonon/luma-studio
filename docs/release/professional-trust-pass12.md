# Pass 12 — text geometry and render-dependent font admission

## Changes

- Character width now scales glyph geometry rather than placing a percentage in the Canvas font shorthand. The selected face and point size remain unchanged. Mixed runs advance by scaled metrics; paragraph wrapping uses the same advances; baseline, frame width and line height stay fixed. Text paint spans and path placement use scaled widths too.
- Structured text excludes its final synthetic tracking gap from alignment/wrapping measurements while retaining spacing between runs. A new regression reproduced a 255 maximum channel difference at 50% width before the fix; corrected center/right tracking matches the geometric reference exactly.
- Photoshop horizontal scaling no longer also populates a variable-font `wdth` axis. Geometric scaling and variation-axis selection are distinct operations; applying both could stretch outlined text twice.
- The existing type-panel width control now edits character geometry only. Its label/readout describe that behavior, and width/weight sliders have explicit accessible names. Existing explicit variation metadata is preserved, not silently migrated or removed; older documents containing both settings still need variation-fidelity review.
- Flattened image, artboard and print exports load fonts required by the rendered layer tree, not every hidden editing alternative. The traversal is iterative and linear in layer count. It includes hidden/zero-opacity text used as a raw clipping base, matches orphan-parent handling, and does not incorrectly cull by Fill, masks or off-canvas bounds.
- Layered PSD export retains all-layer font requirements. This does not permit silent font substitution. Native project save and untouched-source preservation retain their existing behavior. Existing document/revision guards still reject stale asynchronous delivery.
- Regression coverage includes width/anchor pixel geometry, mixed widths, wrapping, PSD descriptors, native save/reopen, persisted undo/redo, missing-font rejection, clipping dependencies, hidden groups and 10,000-deep dependency traversal.

## Scope of evidence

`docs/release/check-text-width.mjs` compares saved/reopened width/alignment/tracking cases in Chromium and WebKit against explicit geometric Canvas drawing using the same bundled face. This tests the width implementation, not an independent shaping engine or Photoshop parity. Initial run `artifacts/text-width-browsers-uEIUaW/report.json` passed 24 untracked cases with zero pixel delta; the WebKit contact sheet was inspected. Final-source run `artifacts/text-width-browsers-NwTHbY/report.json` expands to **48 cases, all passing with zero pixel delta**, and verifies unchanged source. No reference or threshold was relaxed.

The baseline before this patch is `artifacts/native-font-preview-e0pj1O/report.json`: one of three exact-CoreText/WebKit preview cases passes. After the engine changes, `artifacts/native-font-preview-pzUvZ4/report.json` repeats that **1/3** result at source `a25954c8…` (before the subsequent type-panel-only changes). The other two retain visual failures, and a hidden missing Canela face is separately recorded. This diagnostic intentionally still examines every editable text layer; it is not the new flattened-export font policy. These are 512px previews with simulated binary IPC, not installed-app or complete-project qualification. Impact alpha MAE remains 2.720535; the music project's RGB MAE is 1.791857; the flame project's RGB MAE remains 5.947584.

The retained full-resolution paragraph comparison has matching line breaks but visible glyph-edge differences and an alpha-threshold failure. No metric, tolerance or reference was changed to make it pass. The new geometric-width fix does not resolve all shaping, variable-axis, vertical-scale or rasterization differences.

Two new unit assertions initially assumed exact JavaScript/Canvas floating-point matrix equality (0.8 versus 0.8000000119, and 38.4 versus 38.400000000000006). Those arithmetic assertions now use small numerical epsilons. The geometric pixel comparison remains exact, and external fidelity thresholds are unchanged.

## Qualification

Final candidate source: `6202973686251dd59b7df9e5fb012c01ab707aa457ea5fda88a08579d9140f8c`.

Previous pass11 local receipts/logs were preserved at `artifacts/pass11-local-evidence-ZdZs04/` before the standard report paths were reused.

The first full candidate run (`db3af451…`, before the tracking correction) is retained at `artifacts/pass12-timeout-YlFqhD/`: types, lint, 28 native bridge and 9 native-core tests passed, but the engine command timed out at 600 seconds. Its log contains 629 passing cases and no completed suite result. macOS load averaged over 700 on 8 logical CPUs during investigation. Cancellation was considered, but the remaining stages finished before the ownership-checked cancellation command ran; no processes were terminated. **This is a failed full-suite gate, not a pass and not timing evidence.**

Final-source receipts:

- `artifacts/text-delivery-checks-UuOu1X/report.json`: **87 focused tests**, type checking and changed-file lint pass; unchanged source. Coverage includes typography, persisted history, exact-font failure/budget behavior, Photoshop text descriptors, raster/print delivery and campaign/Smart Object font-admission dependencies. This is deliberately a subset, not a replacement for the full RC gate.
- `artifacts/text-width-browsers-NwTHbY/report.json`: **48/48** saved/reopened geometry comparisons, zero pixel delta, unchanged source, no page errors.
- `artifacts/text-width-ui-B6DnaO/report.json`: actual desktop-shell character-width slider; independent variation metadata preserved; one keyboard gesture creates one history entry; Cmd-Z/Shift-Cmd-Z update the readout; project serialization/reopen retains both settings; reopened text paints onto the actual display canvas. Unchanged source, zero page errors. Final screenshot inspected. Isolated WebKit, not the installed application or native save dialogs.
- `git diff --check`: pass.

UI test failures are retained. `text-width-ui-ov0FBG` exposed unnamed range inputs because implicit labels associated with the preceding output elements; explicit names fixed this. `text-width-ui-MGTJDI` read React's undo display before its next frame; the harness now exercises actual shortcuts and waits for the displayed value. `text-width-ui-H0MWfk` verified the model but captured the new canvas before its first paint; the stronger final run additionally waits for visible text pixels. No forced render or manual cache invalidation is used to manufacture a pass.

The final candidate has not completed a full-suite rerun, a new production desktop build, native installation, full shell screenshot matrix or complete external Photoshop edit/export cycle. The interrupted full-suite gate remains open. No performance claim is made from runs on the overloaded host.

## Remaining release gaps

No score increase, completed roadmap, Photoshop equivalence or installed-app update is claimed. Real-project visual fidelity, independent delivery jobs, print requirements/certification, large-document/process-memory qualification and distribution evidence remain separate gates. No commit, push, tag or application replacement was performed in this pass.
