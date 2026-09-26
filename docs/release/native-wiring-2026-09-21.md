# Native workflow wiring — 2026-09-21

This is a targeted native-workflow hardening pass, not certification that every
tool, file format, or professional workflow is complete. Existing open apps and
documents must not be replaced or force-quit for verification.

## Implemented

- File → New / Cmd+N and the document-tab plus button share the command registry.
  The New dialog accepts a name and integer dimensions; engine limits still apply.
- File → Close Document / Cmd+W and tab close use the existing save/discard/cancel
  flow. Closing the last document creates a clean untitled session with no old path.
- New/Open no longer reuse an empty document that is saved, named, or dirty.
- Saves capture the originating document ID, path, history node and revision
  before awaiting encoding. Encoding refuses concurrent document changes. Save
  completion cannot mark another tab, or a newer edited revision, clean.
- Editing is blocked while project saves finish. Save All rechecks dirty documents
  before quit. Recovery failures are reported separately from successful file writes.
- Native menu enabled states are published from the command registry, serialized
  and coalesced. Rebuilding Open Recent preserves those states. Startup commands
  begin disabled until the frontend publishes availability.
- Browser shortcuts derive from the same menu command metadata. Native builds
  leave those accelerators to Tauri, avoiding duplicate execution.
- Native text-field Undo/Redo/Select All route to the focused editor rather than
  modifying the image document. Modal confirmation blocks document commands.
- Window exposes Properties, Selection, Masks, RAW Develop, Brushes, Type & Vector,
  Transform and Measure alongside the previously exposed panels.
- Docked Selection, Brushes, Type & Vector, Transform and Measure no longer depend
  on their original workspace being active. Masks require a selected layer.
- False/null dock content now produces an empty state instead of a blank panel.
- Tone edits target the selected Tone adjustment, never a remembered adjustment
  belonging to another selection. Mask painting buttons also select mask editing mode.

## Regression evidence

`tests/native-workflow-hardening.test.ts` exercises save identity, encoding/write
races, last-tab closure, preservation of empty documents, common accelerator
mapping and coalesced menu publication. The focused campaign additionally covers
menu parity, command registry dispatch, contextual adjustment routing, dock state,
native input framing and recovery. The focused campaign passed **55/55** tests.
TypeScript (`tsc --noEmit`) passed, and the desktop Vite build passed. The build
reported large-chunk warnings; no bundle-size or performance improvement is claimed.

The final modal keyboard/inert guards were added after the first build's source
capture. An incremental recheck, lint and native Rust bundle compilation were
stopped under sustained host load; they are **not** recorded as passing. No new
review app was produced or installed. Both live UI inspection attempts timed out.
Repeat TypeScript/lint/build against the final source before packaging it.

`node build/check-release-evidence.mjs status` still reports **4/10** release
evidence gates passing. Compatibility, updater, signing/notarization, remote crash
reporting and clean-machine distribution remain unproven or unconfigured.

The contextual Selection test was updated intentionally: visibility is now governed
by the dock layout, not a single mutually exclusive sidebar/workspace selection.
Source/contract tests do not prove a successful end-to-end native interaction.

## Still required before calling this release-ready

1. Live native click/keyboard/save/reopen/quit testing, including focused text fields,
   modal dialogs, every dock position, and multiple documents.
2. Visual regression at 1920×1080, 1440×900 and 1280×800. The live inspection attempt
   during this pass timed out; no screenshot acceptance is claimed.
3. Full-suite, production-build and clean-machine verification, in addition to these
   targeted regression tests. The host was heavily loaded during verification.
4. External PSD/PSB/RAW corpus evidence, rendering fidelity, memory-pressure and long
   session checks. Synthetic tests are insufficient for a blanket compatibility claim.
5. Developer ID signing/notarization, a configured signed updater and interrupted
   update testing, remote crash collection and installation evidence. An ad-hoc
   local review bundle is not a distributable production release.

Known follow-up from inspection: Actual Size currently uses the fit-relative zoom
value `1`, so it is not a true pixel-scale view. Zoom UI should be unified around
the viewport's actual scale. External Finder/Open Recent requests can still arrive
during a save; the revision guard fails safely, but deferred/serialized native open
delivery would make that workflow smoother.
