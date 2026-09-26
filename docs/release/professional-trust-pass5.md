# Professional trust — native save failure and regional warp history

## Discovery and scope

The Developer-ID-signed **Luma Font Trust Review** app opened the retained
private `private-sattari-music-psb/source.psb` reference (3,000 × 2,400, ten
Luma layers). Save As refused it after a radial-warp operation. The native
error correctly left the document open with “Save needs attention”; it did not
write a corrupt/unrestorable project or mark the document clean.

The initial native interaction had recorded a radial warp, confirmed by the
Version history panel. This was not an untouched-import save failure. A new
script reproduced the distinction: isolated import/save passed; a real warp
followed by Save exceeded the unchanged 512 MiB restore budget. Whole-layer
before/after snapshots, not font loading, caused this failure.

## Changes

- Radial warp retains a bounded regional pixel patch, not complete layer copies.
- Reverse-sampling scratch includes the complete displacement range and bilinear
  neighbour, clipped to the source. Scratch admission precedes allocation.
- Zero-distance clicks and wholly out-of-canvas gestures do not create history.
- Invalid coordinates fail before mutation.
- Regional transactions retain exact high-depth tile history when necessary;
  undo restores the original float master, not a re-expanded 8-bit preview.
- Project-memory failures now report the estimated requirement, unchanged
  ceiling and offending asset reference count.
- Embedded Smart Object export uses the bounded font wait. Timeout releases
  already-prepared output and decoded-child reservations; retry reuses a font
  load that has since completed.

## Evidence

Unit regressions cover full-image versus regional warp output at edges and
long displacements; no-op history; save/reopen/undo/redo; exact float tile
restoration; and embedded-font timeout cleanup/retry. The existing injected
surface-sync-failure regression still checks rollback and unchanged history.

`docs/release/check-native-save-trust.mjs` is an engine/WebKit diagnostic,
distinct from installed-app qualification. Its UI mode exercises the real
desktop React save command; it instruments the actual loaded module URL
(including Vite revision) and uses an isolated browser context.

The reproduced 3,000 × 2,400 PSB warp formerly retained 29,371,312 history bytes
and failed save admission. The regional operation retained 3,655,864 bytes;
WebKit save/reopen/undo/redo all passed, preserving the edited raster pixels.
Archive size was 2,621,307 bytes. These figures describe this gesture, not a
general memory ceiling or performance parity claim.

Initial diagnostic receipts (before a subsequent type annotation fix and added
high-depth regression):

- `artifacts/native-save-trust-fKsnPe/report.json`: real source → warp → native
  save → reopen → undo → redo, headless WebKit, pass.
- `artifacts/native-save-trust-om06uh/report.json`: real desktop UI import/save
  preparation, headless WebKit, pass. Not a native file-dialog test.

The initial broad run passed 1,182 engine tests and type checking, but lint hit
its ten-minute timeout. Generated `artifacts/` and nested Rust `target/` outputs
are now excluded from lint traversal; maintained source, tests and diagnostic
scripts remain in scope. The failed run is not green evidence. A fresh
source-stable run and updated native build verification are required; do not
treat the older binary as containing this repair.

That run subsequently passed **14 native-bridge and 9 native-core tests**.
Its `unchanged` field is false because the displacement guard and lint scope
were updated afterward; `artifacts/local-hardening-report.json` correctly
does not qualify the current source.

The host later reported load averages **272.95 / 271.13 / 188.85**. The separate
lint retry and new native build were stopped under that competing load. The
build stopped during frontend transformation, before producing a new signed
candidate. Only this task's verified process group and diagnostic Vite server
were terminated; other applications/tasks and the installed app were untouched.
The stopped build's owned stale qualification lock was removed after verifying
its processes had exited. No failed/interrupted receipt was promoted to green.

After the last source changes, the small serial rerun passed all **five**
radial-warp and embedded-font regressions, including non-finite displacement,
exact high-depth history and native-project reopen. `git diff --check` passed.
The focused run is not a replacement for the pending broad qualification.

A later current-source engine diagnostic also passed save/reopen/undo/redo:
`artifacts/native-save-trust-HKkOVh/report.json`. Subsequent changes added a
non-finite-displacement guard and the lint exclusions, so that receipt is not
the final source qualification.

## Native signing evidence (prior candidate)

The separate review app at source
`8e399f604f9068bea9cb670caa16dbf086edc522d29a5f63193674946fbcc4dc`
was successfully Developer ID signed, with hardened runtime and a trusted
timestamp. `codesign --verify --deep --strict` passed. Its linked libraries
were macOS system frameworks/libraries; no Homebrew library path was listed.

Executable SHA-256:
`e9d334c4574f39961fd3a36f4fd29918ec1cd49854ed7212501f922f11b0b2cf`.
Bundle identifier: `app.luma.studio.font-trust-review`.

This is **not** notarization, Gatekeeper/stapling, production identifier,
updater, clean-machine or broad installed-app workflow qualification. Native
screenshots were initially unavailable, then became available. Version History
showed cramped rows/controls in the native window; a later focus-navigation
interaction was very slow while local jobs ran. Neither observation is a
completed visual matrix or an isolated performance measurement. The installed
`/Applications/Luma Studio.app` was not replaced.

## Remaining release blockers

The overall professional-replacement score remains approximately **6.5/10**.
The roadmap is not complete. Other whole-layer destructive operations and
long-session native-project history still need the same trust campaign;
this repair does not claim every edit can now be saved within 512 MiB.
Independent typography/PSD visual failures remain, including the missing
licensed Canela font. Native qualification of the updated warp path, broad
external corpus, print, signing/notarization, updater/crash infrastructure and
clean-machine/long-session evidence remain separate gates.

## Next highest-leverage work

1. On a stable host, run `npm run qualify:local` to obtain a current-source
   report (including lint) and repeat the real-project warp diagnostic.
2. Rebuild the separate Save Trust Review candidate using the retained config
   `/tmp/luma-font-native-review.6QcaBj/tauri.warp-review.conf.json`, then exercise
   actual native Save As, close/reopen, undo/redo and export. Do not overwrite the
   installed application with an unqualified candidate.
3. Extend bounded history/admission qualification to the remaining destructive
   tools and long sessions, then resume independent typography/interchange work.
4. Complete the licensed-font, notarization-profile, production updater/crash
   infrastructure and external-machine/printer prerequisites. No credentials or
   private keys should be pasted into the chat.
