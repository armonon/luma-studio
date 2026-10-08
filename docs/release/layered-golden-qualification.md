# Layered workflow qualification

This is a bounded local-browser qualification, not a native or production release
certificate. The scripted checks never edit the engine through scripting APIs:
actual files, pointer/keyboard controls, downloads, confirmation, close/reopen and
exports exercise the user interface. State inspection is read-only.

## Reproduce

Use Node 22 and existing Playwright/Chrome installations. Start the desktop-web
shell locally (`npm run desktop:dev -- --port 4190 --host 127.0.0.1`), then run:

```sh
LUMA_PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs \
LUMA_CHROMIUM_EXECUTABLE=/path/to/chrome \
LUMA_GOLDEN_OUTPUT=/path/to/evidence \
node_modules/.bin/tsx build/qualify-layered-golden.mjs
```

The harness refuses non-local hosts, blocks external requests, uses only generated
fixtures, and writes its exact source/dirty status, harness hash, platform/browser,
input/output hashes, screenshots and per-check evidence. A failed run retains its
error and partial results. `qualification_complete` remains false because the full
product specification includes platforms and cases this browser run cannot prove.

## Checked workflow

2048×1536 sRGB alpha/gradient source, 1024×768 transparent checker overlay → rename,
63% opacity → group/ungroup → approximately 64×32px move → diagonal hard mask →
mask/visibility/order Undo/Redo → exposure adjustment → Save/download/verify →
Close/Reopen → exact semantic layer/history comparison → PNG export → corrupt
archive rejection → cancelled export chooser → continued Undo/Redo.

An independent Canvas2D composition decodes the original PNG fixtures, places the
overlay at the UI-verified transform, applies the separately inspected mask and
63% source-over opacity, then applies the declared brightness factor 1.035. It does
not call Luma's renderer. The saved mask is an input to this compositor; actual
pointer stroke semantics are checked separately at interior/exterior control
points. RGB tolerance is 2 channel levels; alpha must match exactly. Pre-close and
reopened exports, and mask Undo/Redo exports, must match exactly. The current raw
source layer thumbnail is not falsely described as a masked-composite preview.

## Repairs exposed by the workflow

- Live layer opacity/fill-opacity now notifies subscribers for each preview,
  retaining one final committed Undo step.
- Serial precision surface restoration uses a bounded single-allocation entry
  reader. Admission counts each retained tile reference plus three shared scratch
  buffers instead of charging four full retained copies for every history tile.
  Only recognized serial document/history surface slots receive this accounting;
  opaque references, LUTs and parallel patch decoding retain their conservative
  costs. The 512 MiB ceiling is unchanged. Mutable history stores remain independent.
  This is admission accounting, not a measurement or guarantee of process RSS.
- A full-strength normal, unmasked, unstyled adjustment replaces its backdrop
  instead of source-over painting that backdrop a second time. Tone and curves
  regressions cover partially transparent input. Partial opacity, masks, effects,
  non-normal blends and non-neutral BlendIf deliberately retain their existing
  behavior; their compositing semantics need separate qualification, not a claim
  of comprehensive alpha correctness.

## Remaining qualification and release gates

Native packaging/real OS pickers, filesystem write failure, missing-file handling,
GPU/physical platforms, mask enable/disable UI, thumbnail convention, partial or
masked adjustment variants, large documents and Photoshop interoperability remain
unverified. Resident history byte estimates may increase after decoding because
independent backing stores replace shared in-memory references; history topology,
parameters and output must still match. Hosted CI, source/live provenance and
normal release gates remain required. Do not merge or deploy while mandatory
checks are unresolved.
