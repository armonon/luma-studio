# Advanced workflows: implementation and Photoshop gap audit

Date: 2026-09-21. Scope: source inspection, targeted regression tests and Adobe's
official documentation. This is not a completed Photoshop parity certification.
No installed Photoshop build was benchmarked or used for round-trip validation.

## Implemented in this pass

- Document tabs retain independent zoom/pan during the session. New tabs fit;
  closed tabs release their view records. Delayed pan/animation callbacks from a
  previous tab cannot move the current tab. Framing does not create undo entries.
  This does **not** yet persist framing across application restarts.
- Save-and-close obtains the target document's name after switching, instead of
  reusing the previous tab's React closure value.
- Transform context changes clear incompatible distortion drafts. Rotate-handle
  positioning uses the viewport model rather than reading layout during render.
  Removed unused remembered Tone adjustment state; the selected layer is authoritative.
- An image imported as a layer captures the destination document before decoding
  and refuses to apply if a different document is active when decoding finishes.
- Batch runs reject overlapping starts and missing selected actions. Controls
  cannot change the input queue/action during execution. Failed rows no longer
  display success merely because the progress counter moved past them.
- Batch supports cooperative cancellation at async boundaries, disposes workers,
  preserves already-completed PNGs, and includes a JSON report with success,
  failures, skipped count, cancellation and resource-limit reason.
- Batch accepts at most 200 files and retains at most 128 MiB of encoded PNG data.
  Oversized output stops further processing with a report. ZIP filenames cannot
  create paths. PNGs use ZIP STORE rather than redundant recompression.

The retained-output bound is **not a total process-memory guarantee**: decoding,
engine surfaces, action intermediates, encoding and ZIP finalization have their
own allocations. Cancellation cannot preempt a synchronous filter already
executing, nor interrupt ZIP finalization. Full streaming output/worker execution
remains a separate campaign. Batch remains PNG/JPEG/WebP input → PNG ZIP output.

## Additional competitive gaps

| Workflow | Evidence in Luma | Remaining work / completion test |
| --- | --- | --- |
| Editable, linked Smart Objects | Luma-created raster Smart Objects now support undoable Replace Raster Contents, containing the new image inside existing source bounds and retaining transforms, masks and styling. Restricted to 8-bit non-RAW content, 4 MP / 32 MiB inputs. Imported Photoshop payloads are preserved and explicitly excluded from replacement. | Nested-document editing, shared-instance identity, Photoshop embedded-payload rewriting, relink/missing-link UI, external-change detection and safe reload. Save/reopen nested linked PSD fixtures and verify both pixels and editable structure. |
| Channel-based production | `ChannelsPanel` displays RGB/R/G/B/A previews. Its own tooltip states RGB export is unchanged. ICC CPU transformations and proofing exist, including explicit intent fallback reasons. | Editable named alpha/spot channels, channel calculations, genuine CMYK/Lab document workflows and separations. A CMYK proof preview is not a CMYK editing pipeline. Validate against reference profiles and print separations. |
| Advanced automation | Actions validate bounded payloads, check each current target, distinguish applied/unchanged/disabled/skipped/failed, and expose per-step results. Conditional steps and an on-demand visual step editor now support enable/reorder/duplicate/delete, conditions, and validated JSON parameters. Action-library edits have separate bounded undo/redo. Batch does not export failed actions as successes; replay is not re-recorded. | Parameter substitution, CSV/TSV data sets and export presets. Earlier successful steps remain undoable; the whole action is not an atomic rollback transaction. The library remains workspace-global, with dirty-save guards against replacement. Test 100 personalized designs and native long-session behavior. |
| Multi-image photography | No implemented auto-registration/focus-stack/panorama workflow was located in the inspected engine/UI. Luma layer blending is not automatic image registration. | Auto-align, seam/exposure-aware panoramas, focus stacking and HDR merge with nondestructive source retention, cancellation and memory budgets. Use parallax, moving-subject and exposure-mismatch fixtures. |
| Multi-document comparison | Independent per-tab framing is now implemented. The shell still displays one active document canvas. | Split document views, multiple views of the same document, matched zoom/location and synchronized navigation. Verify independent history/selection and Retina actual-size semantics. |
| Nondestructive warp | Affine/skew transforms are editable and tested. Current Distort is a bounded raster-apply path, not arbitrary editable smart-object perspective. See `docs/transform-interactions.md`. | Editable homography/warp nodes for text/vector/masked/high-depth content, live composite previews, stable handles, tiled rendering and export fidelity. Verify reopen and repeated edits without resampling the original. |
| Typography | Rich text runs, character/paragraph controls, variable-axis controls and spatial text contracts exist. | Font capability discovery and missing-font replacement, shaping/line-break accuracy across scripts and fonts, glyph-level feature validation and editable PSD text fidelity need a reference corpus. UI controls alone are not proof that every font honors every axis. |
| Ecosystem / true 3D | Form bridges and lightweight spatial/text presentation exist. The spatial roadmap explicitly distinguishes these from full live 3D workflows. | Revisioned linked assets, missing-resource handling, editable scene return, material/UV work and multipass compositing. Do not market the current bridge as a finished shared 3D engine. |

### Adobe references

- Photoshop replaces Smart Object content while retaining transformations:
  [Replace Contents](https://helpx.adobe.com/photoshop/desktop/create-manage-layers/smart-objects/replace-the-contents-of-a-smart-object.html).
  Linked versus embedded reuse: [Linked Smart Objects](https://www.adobe.com/learn/photoshop/web/photoshop-linked-smart-objects).
- Named alpha/spot channel workflows:
  [Channel basics](https://helpx.adobe.com/photoshop/using/channel-basics.html).
- Conditional branches and template variables:
  [Conditional actions](https://helpx.adobe.com/photoshop/using/conditional-actions-creative-cloud.html),
  [Data-driven graphics](https://helpx.adobe.com/photoshop/using/creating-data-driven-graphics.html).
- Multi-image alignment/blending for focus stacks:
  [Extended depth of field](https://helpx.adobe.com/photoshop/desktop/create-masks/blend-images/create-a-composite-with-extended-depth-of-field.html).
- Multiple views and synchronized zoom/location:
  [Viewing multiple images](https://helpx.adobe.com/photoshop/using/viewing-multiple-images.html).
- Transform baseline:
  [Apply transformations](https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/transform-manipulate-reshape/apply-transformations.html).

These comparisons describe documented workflows, not measured performance or
quality superiority. No claim that Photoshop lacks 3D/AI object rotation is made.

## Recommended implementation order

1. Finish live/native verification of this pass and the existing save/recovery work.
2. Prioritize measured responsiveness and memory bounds; complete batch worker/streaming execution. Action-step preconditions/results and conditions are now implemented.
3. Build the nested Smart Object document/asset lifecycle, then editable warp nodes.
4. Complete named alpha/spot channel and prepress workflows using reference files.
5. Add auto-registration before focus stacks/panoramas/HDR merge.
6. Validate typography, RAW, PSD/PSB and distribution with real professional projects.

Do not replace reliability/compatibility campaigns with new tool counts. The
50–100-project corpus, external Photoshop renders, matched hardware benchmarks,
Developer ID/notarization, signed-updater tests and clean-machine validation
remain independent release gates.

## Verification

- 23/23 initial focused tests passed: document-view state, viewport geometry/budgets,
  native save/menu workflows and transform interaction/serialization.
- 7/7 final batch/import tests passed: budgets, cancellation during decode/export, worker
  disposal, malformed/excessive input, filename safety and per-file failures.
- The final import-target regression verifies that neither the original nor the
  newly selected document receives a late image in the wrong place.
- Final view/batch/import rerun: 11/11 passed, including an additional source
  integration guard against resetting the outgoing view from New Document.
  Total distinct focused tests across this campaign: 31.
- Final TypeScript, targeted ESLint and `git diff --check` passed. Desktop Vite
  frontend build passed. Main JS is approximately 650 kB minified / 195 kB gzip;
  the existing >500 kB chunk warnings remain a bundle-optimization gap.
- Live preview DOM was readable. A command-button click timed out before
  dispatch; the accessibility fallback also timed out and reset its connection.
  A later retry could open the menu, but the old 4174 tab did not contain the
  updated New Document command and no local listener was found for that port.
  This is **not** an interactive/visual regression pass for the new build. The three-size screenshot
  matrix, native dialogs and installed-app behavior are still unverified.
- Native packaging subsequently passed, including a rebuild after the final
  New Document fix. `codesign --verify --deep --strict` passed for the ad-hoc
  signature. Notarization was skipped: distribution credentials are not configured.

### Live verification after the initial timeouts

- Isolated native app: File → New and Cmd+N open the same dialog; created
  `RC Workflow A` (800×600) and `RC Workflow B` (400×300).
- Cmd+1 shows 100%. Tab switching restores A at 100% and B at its 232% fit view.
- Cmd+W on dirty A opens its named save/discard/cancel dialog. Cancel keeps A open.
- Live testing found New Document's old `setView(fit)` reset the outgoing tab.
  Removed it; the hook owns new-ID framing. On the final browser build, Dunes
  remained at 100% after creating `View Regression` at a 172% fit and switching back.
- Native File → Batch Process opened the batch panel. A repository JPEG entered
  the queue without adding a layer to A. Running disabled queue/action controls;
  the Stop button was visible. Export reached the native save dialog and finished
  with one succeeded, zero failed, zero skipped. Artifact:
  `/tmp/luma-workflow-rc.2fboRq/batch-smoke.zip`.
- Native test application is `src-tauri/target/debug/bundle/macos/Luma Studio RC Review.app`.
  The app in `/Applications` and pre-existing user documents were not replaced.
- Still unverified: the full three-resolution screenshot matrix, native live
  cancellation under large real actions, disk-full failures and long-session RSS.
  Unit tests cover cancellation boundaries but do not replace those campaigns.

## Follow-up: action execution and raster Smart Object contents

- 78/78 targeted tests pass across actions, playback reports, batch, Smart Object
  content replacement, native menus, command registry, plugins, document views,
  import targets and native save workflows. Content tests include undo/redo,
  project round-trip, aspect-fit transparency, unchanged styling/masks,
  stale-document rejection, malformed/huge headers and memory-admission failure
  before document mutation. This is targeted regression evidence, not a full RC gate.
- Keyboard search now derives its command catalog from the central registry.
  The default six featured commands remain compact; searches include every
  registered command and honor central enabled state. This follows the shell
  skill's shared-command contract, rather than adding a disconnected workflow UI.
- Live browser verification: Cmd+K → Convert to Smart Object → Replace Raster
  Contents accepted `public/film-lake.jpg`; the canvas and layer thumbnail visibly
  changed from dunes to the lake. Cmd+Z restored the dunes without undoing the
  Smart Object conversion. Tested in the isolated 4175 preview, not the stale
  4174 tabs or installed `/Applications` app.
- Live action verification: entered `RC Opacity Check` in the inline field,
  started recording with Enter, changed opacity and stopped; the panel showed
  one recorded step. Removing the test layer then replaying produced
  `setOpacity · failed — No active layer exists for this step`. Undo restored
  the test layer. The old browser prompt had failed to start recording and was
  removed rather than counted as a working desktop interaction.
- Final desktop frontend and native review packaging passed. TypeScript and
  targeted ESLint passed; `git diff --check` is clean. The installed application
  was not overwritten. Live tests of these newest controls used the production
  frontend in the browser; a fresh native launch of the final binary and the
  complete three-resolution visual matrix remain to be verified.
- This replacement is intentionally a bounded raster-content workflow, not
  nested PSD editing, linked-content synchronization, or unlimited-size replacement.
  Inputs are contained inside existing bounds, not stretched or cropped.
- Disabled and conditional action steps are supported in serialized actions and
  the on-demand visual editor. Action playback is synchronous between steps; long
  individual operations cannot yet be interrupted mid-step.
- Native review builds are ad-hoc signed. Developer ID signing, notarization,
  real Photoshop/camera corpus results and clean-machine distribution remain
  release blockers. No claim of complete Photoshop parity is made.

## Priority change: speed and optimization

Feature expansion was paused at the user's request. See
`performance-pass-2026-09-21.md` for the measured history-query optimization,
frame-coalesced UI updates, bounded action UI and targeted regression evidence.
