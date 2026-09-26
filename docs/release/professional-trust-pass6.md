# Professional trust — current-source qualification and native save review

## Completed validation

The source-stable local campaign completed on 2026-09-25 at source
`beb727ac0991d1655cf6424e5252d6bed2d1204664c0452698b85eb6b5fdfd78`:

- Type checking and lint passed.
- 1,182 engine tests passed, with no failures.
- 14 native-bridge and nine native-core tests passed.
- `artifacts/local-hardening-report.json` records `unchanged: true`.

This supersedes the interrupted/stale local campaign described in pass 5.
It does not establish independent Photoshop fidelity or distribution readiness.

## Root cause under qualification

The pass-5 native save failure was caused by whole-layer warp history exceeding
the unchanged 512 MiB project restore admission ceiling. Regional history and
exact high-depth undo were repaired. The next check is an actual separately
signed native app, using a private real PSB, not just the engine diagnostic.
The production installation is not being replaced.

## External fidelity and release gates

At this source, `node build/check-release-evidence.mjs status` reports **4/10**
release evidence gates passing. This is not a product score. The existing
independent Photoshop pilot remains **0/3 complete workflows qualified**;
the internal corpus is stale and includes one flattened workflow. No comparison
tolerance or release gate has been relaxed.

The overall professional replacement assessment remains approximately **6.5/10**.
The roadmap is not complete. Outstanding prerequisites include a licensed
missing font, notarization profile, production updater/crash infrastructure,
independent clean-machine testing and print qualification requirements.

## Next highest-leverage work

1. Complete the native warp → Save As → close/reopen → undo/redo → export check.
2. Remove full-layer history from selected destructive filters; retain rollback
   and explicit memory admission, then rerun qualification.
3. Resume independent typography/interchange fidelity and external release gates.

## Native workflow result and new failure

The separately built Save Trust Review candidate at the above source passed
`codesign --verify --deep --strict`; it was Developer ID signed, not notarized.
Executable SHA-256:
`c0fe1fc4dc922a1e74a1a41d54bbc5f932fe54e24bf40616871067f3b56e3e82`.

Using native dialogs and the actual canvas, the private PSB was opened and
warped. Save As initially refused at the **1 GiB known-memory admission**
ceiling while the generated Dunes document was also open. No file was written
and the document stayed dirty. After closing only that generated demo, retry
succeeded. The native file reopened with ten layers; Undo became available,
Undo enabled Redo and marked the tab dirty, and Redo returned it to clean.
PNG export then completed through the native Save dialog.

Artifacts: `artifacts/native-save-review-pNlGbq/warped-native.luma`
(2,651,622 bytes, SHA-256
`73f4a9c512ee6a22d1768839a643bbc32ddf4bc99bbde524f258cbb6bfeb28ec`)
and `warped-native.png` (599,548 bytes). The archive manifest records PSD import
and radial-warp history. Native UI state is workflow evidence, not proof of
pixel-exact undo; the separate WebKit raster comparison supplies that narrower
check (`artifacts/native-save-trust-oJHhwS/report.json`).

This is a **conditional native pass**, not a multi-document save qualification.
The initial memory failure remains important. Inspection found manual save and
recovery can independently reserve and encode whole archives simultaneously.
That overlap is now reproduced with a held encoder in a regression; its exact
contribution to the observed native failure was not instrumented in that binary.

## Follow-up repairs

- Manual saves and recovery share a bounded, FIFO project-encoding queue. Memory
  reservations happen only after admission and ownership revalidation. Queued
  requests time out safely; failure releases the slot, not the running encoder.
- Memory refusal identifies accounted and requested MiB without raising limits.
- Selected blur, sharpen, invert, desaturate and hue use regional undo patches.
  Halo sampling is admitted separately and does not overwrite high-depth master
  pixels outside the selected bounds. Source-backed filter limitations remain.
- Invalid/no-op filter parameters no longer create history/action noise.
- Selected filter tests compare existing output, save/reopen/undo/redo, float
  restoration, transformed-selection memory rejection and failure rollback.

Focused campaigns passed 23 queue/ownership/native-workflow tests and 44
filter/transaction regressions. Types passed. A fresh broad campaign is required
for these follow-up edits; the first receipt above applies to the earlier source.

At follow-up source
`e85b93524b47bc4bd4fa92c0b3f6f8f60270ed184fb49071303cd5273b3b4301`,
`artifacts/native-save-trust-HpBuEm/report.json` passed real PSB → selected
invert → concurrent save/recovery requests → reopen → exact raster undo/redo.
History was 98,560 bytes and the native archive 2,522,073 bytes. These are scoped
WebKit measurements, not process RSS or Photoshop parity.

The follow-up broad campaign passed at that unchanged source: **1,195 engine
tests, 14 native-bridge tests, nine native-core tests, types and lint**. The
existing print-dialog ref-cleanup lint warning remains; there are no lint errors.

The actual native-written `warped-native.luma` was also decoded in the engine
test harness and checked against its independent input PSB raster: the saved
cheetah differs from the input, Undo restores the exact original raster, and
Redo restores the exact saved raster. Ten layers survive. This strengthens the
native UI undo check without claiming whole-document Photoshop visual fidelity.

The reusable `docs/release/check-native-artifact-history.mjs` then passed against
**all five raster layers**, not only the edited cheetah. Receipt:
`artifacts/native-artifact-history-6jh9ZD/report.json` (source unchanged).
Its SHA-256 inputs identify the private source and the actual native-written
archive. Both diagnostic scripts passed a separate ESLint check.

## Final native retest — both documents remain open

The rebuilt candidate uses source `e85b93524b47bc4bd4fa92c0b3f6f8f60270ed184fb49071303cd5273b3b4301`,
bundle identifier `app.luma.studio.save-trust-review-v2`, and executable SHA-256
`7d4e1440b831200a88b56115d80402595fc94f4f88d4f679307320cb3b481371`.
Developer ID signing and strict code-signature verification passed again.
Notarization remains unqualified.

The formerly failing native setup now completed with **Dunes and the private
PSB both open**:

1. Open real PSB and perform the same canvas warp.
2. Save As succeeds without first closing Dunes or increasing either ceiling.
3. Close the clean saved tab, then reopen it from disk with Dunes still open.
4. Ten layers and edit history survive. Undo marks the document dirty; Redo
   returns it to the saved state.
5. Ordinary Save writes the remembered path without a new file picker.
6. PNG export succeeds through the native dialog at 3,000 × 2,400.

Final native archive: `artifacts/native-save-review-pNlGbq/two-document-native.luma`.
Its post-Save SHA-256 is
`6a0ad49fc248df50e865a214f146cdd03a21ce938188f06c96f14b08cd418de4`.
`artifacts/native-artifact-history-TSWYXp/report.json` verifies all five raster
layers against the original PSB through Undo/Redo at the unchanged current
source. Export: `two-document-native-luma.png` (599,548 bytes).

The demo-only dirty tab displayed the expected save/discard/cancel dialog when
closed. Only that generated demo was discarded; the saved QA project was kept.
The temporary review app was then quit. The installed production app and user
originals were not modified.

## Bounded edit-session stress

`artifacts/native-save-trust-dc4JxN/report.json` passes 51 selected inversions on
the real PSB, concurrent save/recovery requests, reopen and all 51 Undo/Redo
steps. History retained **5,020,160 bytes** and the archive **2,568,309 bytes**.
This is a targeted engine/WebKit stress case, not a multi-hour professional
session, independent Photoshop fidelity or aggregate process-RAM measurement.
The host had substantial competing load during the second build/native checks;
no latency or performance-parity result is claimed.

## What is still not closed

The roadmap and 10/10 professional-replacement target remain **unfinished**.
Current-source local regressions and these scoped native jobs are green, but
independent corpus fidelity, source-backed destructive filter support, complete
high-depth editing, sustained memory/long-session qualification, native visual
coverage, RAW/print qualification and distribution evidence remain. The release
gate is still 4/10, not permission to ship. Licensed font, notarization profile,
production updater/crash infrastructure, printer requirements and external test
machines are separate user/external prerequisites, not failures to relabel PASS.
