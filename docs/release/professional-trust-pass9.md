# Professional trust pass 9 — multi-document quit and write failures

## Actual installed-app observations

On 2026-09-25, the isolated `Luma Save Trust Review.app` was tested at
source `baa94a99429199f8e6ac867407cd4f1ffb73f5b1690cefd1fd9c4ae7e9ead2cd`
(the pass-8 binary). Production installation and existing project files were
not changed. Two new small, blank QA documents were created.

- Cmd+Q correctly reported two simultaneously dirty documents.
- Canceling the first native Save As retained both dirty documents and did
  not exit.
- Saving the first, then canceling the second, retained the app and correctly
  reduced the dirty count to one. Retrying targeted only the remaining dirty tab.
- Native Save was intermittently disabled, including when invoked separately
  after canceling quit. Cancel/retry eventually enabled it and saved the second
  file. The cause is **not established**; this is not a clean native-dialog pass.
- After both documents had paths, an added paint layer in each made both dirty.
  Save All wrote both remembered paths and exited successfully.
- Relaunch recovered all four open QA tabs. Both new documents were clean and
  contained two layers. Both archives were separately inspected on disk.

Files in `artifacts/native-trust-pass8-gkRzYs/`:

| File | SHA-256 | Observed dimensions |
| --- | --- | --- |
| Exit-QA-A.luma | 0a2059a9b830f81a7e2f95fc7382424b39092ee615448582162b65ca18e23d60 | 256 × 256 |
| Exit-QA-B.luma | 2f53105de4a065282b1abc48df25a2c6a81aa5fb1ccb814d8e8dea3c2c066b1f | 20 × 40 |

The second document's observed dimensions differ from the intended 320 × 240
UI input. Automation focus/input timing was unreliable; no dimension-validation
defect is established by that observation. This was a lifecycle test, not a
large-document test.

## Narrow safety corrections

Code inspection identified that whole-app Don't Save previously exited without
disposing of dirty recovery checkpoints, allowing explicitly discarded edits
to return. It now records only the targeted dirty tabs in a durable IndexedDB
exclusion transaction before requesting exit. Synchronous tombstones reject
in-flight stale checkpoints. Failure aborts exit and re-enables recovery; native
exit rejection reverses the exclusion. Startup later removes excluded recovery
payloads after loading retained tabs. Saved files are not deleted.

A synchronous operation guard now spans the entire Save All/discard sequence.
Cancel, Escape, duplicate clicks and repeated native quit requests cannot race
the asynchronous operation. Canceling the actual native save dialog still
returns to the quit dialog with remaining dirty documents intact.

The native atomic save implementation was extracted without exposing test
switches in production IPC. It now reports directory durability failures instead
of silently acknowledging success, and never removes an unowned temporary file
when exclusive creation fails.

## Failure-test scope

New native tests cover partial-write ENOSPC, sync failure, pre-rename failure,
new-file write failure, rename failure, and post-rename durability failure.
Separate child processes exit abruptly without unwinding during partial write,
after file sync, and after rename. Assertions require a complete old or new
destination and a successful retry. Test-created temporary files are cleaned;
the user's disk is never intentionally filled. These are **fault-injection and
process-interruption tests**, not hardware power-loss or real full-volume tests.

New IndexedDB regressions cover multi-tab discard, stale queued checkpoints,
aborted discard and resumed autosave, native-exit compensation, and authoritative
empty-workspace behavior.

At source `d7ab80767f07f69cc8e879a8d15439b69fb54df64118a22607ac67eb2a32877c`,
`artifacts/local-hardening-report.json` passed with unchanged source:
1,233 engine tests, 28 native-bridge tests, nine native-core tests, types and lint
(the existing unused-variable warning remains). `git diff --check` passed.

`check-quit-safety.mjs` exercises the actual React quit dialog with a deterministic
native IPC fault double and real persistent WebKit IndexedDB. It is explicitly
not evidence for Cocoa dialogs or Dock Quit. Its report records its own harness
hash and the application source hash.

## Still separate qualification requirements

- Direct installed-app Don't Save/relaunch testing awaits authorization to
  discard only the newly created disposable QA edits.
- Dock access through the available native automation timed out; no actual
  Dock Quit result is claimed.
- Resolve intermittent disabled native Save before declaring dialogs qualified.
- New-source native and visual qualification receipts must be recorded separately
  from the old-binary observations above.
- Release corpus, notarization, production updater/crash evidence and clean-machine
  testing remain open. No release gate or product score was increased here.

The application-shell skill guided lifecycle consistency and separate native,
command, persistence and failure-path checks; existing editing panels were not
redesigned.

## WebKit failures discovered during qualification

The initial boundary campaign failed twice during compensation after an injected
native-exit rejection: the app stayed open and warned that recovery restoration
had failed. Fake IndexedDB unit tests had passed. Receipts
`artifacts/quit-safety-OyRZfo/report.json` and
`artifacts/quit-safety-QCoEmv/report.json` remain failed; a subsequent pass does
not erase the intermittent failure.

An intermediate correction replaced JavaScript-only rollback with a durable
rollback record retaining discarded payloads in the same transaction as index
removal. Compensation restored the workspace and removed that record atomically;
startup cleared a previous exit's record. This approach avoided eagerly copying
complete project blobs into RAM, but further WebKit failures subsequently caused
it to be replaced by the immutable-payload design described below. The transaction
wrapper's safe handling of an already-aborted request remains.

The first corrected WebKit boundary run passed all seven scenarios at intermediate
source `84b98994efce37a935d1e6c39b1a39ba66142f079dd5da4159c975f4f9c11fa0`
(`artifacts/quit-safety-OgumxH/report.json`). Final-source repeated runs are still
required after the additional aborted-transaction regression correction.

The intermediate signed candidate at source `d7ab80767f07f69cc8e879a8d15439b69fb54df64118a22607ac67eb2a32877c`
passed strict code-signature verification (binary SHA-256
`1db0cb1a52aaea4bb9e1961ee3b499a7f77e109a0623c7d2502869dfd391bd11`).
Direct native launch restored all four clean QA documents. Adding a third layer
to Exit-QA-A, then Cmd+Q → Save All, wrote the remembered path and exited.
This proves native directory-sync acknowledgement on this host for that save;
it does not qualify full-disk or hardware-power-loss behavior. The candidate
was quit cleanly before subsequent source changes.

## Final recovery design and repeated boundary evidence

Further repeated tests rejected the intermediate rollback-buffer approach.
WebKit reported `Error preparing Blob/File data to be stored in object store`
and later a checkpoint read raised `NotFoundError`. The failed receipts remain
under `quit-safety-xclBpa`, `quit-safety-LfhpQj` and `quit-safety-fvOps6`.

The final implementation separates a v3 metadata index from immutable, individually
keyed project payloads. Updating one tab never reserializes the other tabs' Blob
values. Current and previous payload retention is bounded to two per open tab;
older payloads are pruned transactionally. Existing v2 workspaces migrate through
references to the unchanged old index until fresh checkpoints replace them.
The old index is removed after no document references it.

Don't Save now commits a small persistent exclusion record, without deleting or
copying project payloads during the quit decision. Exit rejection reverses that
record; failure to reverse it visibly pauses recovery rather than silently
pretending to autosave. Startup excludes discarded IDs, consumes retained project
Blobs, then garbage-collects discarded payloads and the exclusion record. Cleanup
failure leaves the exclusion record intact. No new imaging feature was added.

At recovery-candidate source `4ca2495c604826d9932678a9604634f5175b01c2768993319f16aed5b2f89bc9`:

- Type checking and all 14 focused recovery tests passed, including v2 migration,
  unchanged payloads in unrelated tabs, bounded retention, aborted transactions,
  compensation failure and connection cleanup.
- `quit-safety-MZgySF`, `quit-safety-w7iUcx` and `quit-safety-V25tNZ` each passed
  **all eight** end-to-end boundary scenarios. The additional scenario aborts
  the metadata commit after a new payload write, then reads every surviving
  checkpoint to verify valid project bytes. These are still a mocked native
  IPC boundary, not Cocoa/Dock qualification.
- `artifacts/shell-matrix-oPWFEC/report.json` passed all 21 visual comparisons
  and interaction/reload checks, with zero pixel delta outside the documented
  asynchronous status-text exclusion. The 1440 × 900 text state was also
  inspected directly. No visual reference was changed.

An earlier full-suite failure is preserved in
`artifacts/save-quit-failed-doJHpR/`. Its updater loopback fixture responded after
a single TCP read, which need not contain a complete HTTP request. The fixture
now requires complete, bounded request headers and asserts that its response was
served; it no longer ignores server I/O failures. Production updater policy was
not weakened. Subsequent native tests passed. Intermediate type/test failures
during the storage refactor were corrected before the final-source campaign.

## Qualification before the final upgrade-edge correction

The more explicit loopback fixture exposed a second failure: on macOS, an
accepted socket inherited nonblocking mode from its listener, so its bounded
header read could return `WouldBlock`. The fixture now explicitly switches the
accepted socket to blocking mode before setting its read deadline. Five
consecutive focused transport-fault runs passed. This is a test-server fix;
production transport timeouts, validation and updater policy are unchanged.
The failed receipt remains in `artifacts/loopback-fixture-failed-E9A0Vp/`.

Source `23027b62b5c2f4d1044beb0204e0f7ab18a5f425d61ffb4644a7787873fa675b`
then passed the complete unchanged-source campaign:

- **1,236 engine tests**, **28 native-bridge tests**, **nine native-core tests**,
  TypeScript and lint (`artifacts/local-hardening-report.json`). The preexisting
  unused-variable lint warning remains.
- **Eight quit/recovery scenarios in each of three consecutive runs**:
  `artifacts/quit-safety-MD7jLr/report.json`,
  `artifacts/quit-safety-72PYt0/report.json`, and
  `artifacts/quit-safety-b9VBps/report.json`.
- **21 visual comparisons** and the documented interaction/reload checks:
  `artifacts/shell-matrix-JN3BTI/report.json`. All comparisons had zero pixel
  delta outside the documented asynchronous status-text exclusion; no reference
  was replaced. This does not expand coverage beyond those seven states at
  three viewports.

These receipts do not replace direct Cocoa dialog, Dock Quit, actual full-volume,
power-loss, or clean-machine qualification.

## Upgrade-edge correction

A subsequent targeted reproduction found that a pending discard disposition
with a v2 workspace and no v3 index returned an empty workspace, hiding retained
clean tabs too. This can occur when quitting before the first migrated
checkpoint. The reproduction returned `[]` where `old-clean` was expected.

Legacy v2 reads now filter only the explicitly excluded document IDs and
normalize the remaining active tab, just like v3. Suppression of an obsolete
single-file legacy fallback remains in place. A new regression preserves the
clean tab, its saved path and payload, then verifies startup cleanup and the next
migrated checkpoint. All **15** focused recovery tests and type checking passed.

The real WebKit campaign now has a ninth scenario: old-format pending discard,
readable retained payloads, actual page reload, startup migration and two restored
clean tabs. Its first run passed at source
`27471eb48f12f5f0b726debcebaad63a77f40691b1cca63a1481f78974fc29b8`
(`artifacts/quit-safety-gbbzXR/report.json`). The prior full-suite/build receipts
are preserved in `artifacts/pre-migration-fix-Q79g8K/`, not reused as final-source
evidence.

The corrected source completed the full unchanged-source campaign:

- **1,237 engine tests**, **28 native-bridge tests**, **nine native-core tests**,
  types and lint passed (`artifacts/local-hardening-report.json`).
- All **nine** quit/recovery scenarios passed three consecutive runs:
  `quit-safety-gbbzXR`, `quit-safety-zUyaKF`, and `quit-safety-XBdh3K`.
- All **21** visual comparisons and interaction/reload checks passed
  (`artifacts/shell-matrix-zEyHRG/report.json`).

The release-evidence status check remains separate from these checks. It reported
4/10 gates: checkpoint tag, sparse selections, sparse masks, and recovery local
regressions passed. Compatibility evidence was stale; production updater
configuration/fault evidence, signing-plus-notarization receipt, remote crash
reporting, and clean-machine evidence remained missing. A locally signed review
app is not equivalent to notarized distribution qualification.

## Final review build and native boundary

The corrected source built successfully as the isolated
`src-tauri/target/release/bundle/macos/Luma Save Trust Review.app` on
2026-09-26 at 02:19 UTC. Its executable SHA-256 is
`70f2986dd5ad87852ff78c2aa753cc0ff2ae1abdbf17e47236dbf94959460522`.
`codesign --verify --deep --strict` passed. The source and executable are recorded
in `artifacts/native-build-report.json`. The production installation was not
replaced. Notarization was skipped because credentials were unavailable; no
notarization claim is made.

The attempt to launch this final candidate through native UI automation was
blocked by the locked Mac. Manual unlock was requested. Consequently the older
candidate's native Save All/relaunch observations above are **not** a direct
native pass for this final binary. Final-source native Save All/relaunch, actual
Dock Quit, and the previously requested disposable-edit Don't Save approval
remain open. No native discard was performed in this pass.

Before that launch attempt, saved QA archive inspection confirmed Exit-QA-A still
had three layers and Exit-QA-B two. The original paragraph and quit-safety
evidence files retained their recorded hashes. Build warnings about oversized
JavaScript chunks and ineffective dynamic imports remain; they were not hidden
or treated as performance qualification.

## Final-binary native retest after unlock

After the user continued and the Mac became accessible, the exact final candidate
above was exercised directly through native UI automation. Application source
remained `27471eb48f12f5f0b726debcebaad63a77f40691b1cca63a1481f78974fc29b8`;
no implementation change was needed during this retest. These observations
supersede the locked-Mac limitation **only for the paths actually exercised**:

- Launch restored all four clean QA tabs. Exit-QA-A contained three layers and
  Exit-QA-B two before the new edits.
- Adding a blank paint layer to each produced two dirty tabs. Native Cmd+Q
  reported both. Cancel kept both tabs and edits open.
- A second Cmd+Q followed by Save All saved both remembered native paths and
  exited. Process inspection found no remaining review-app process. Independent
  archive inspection found four layers in A and three in B.
- Relaunch restored all four tabs clean with those saved layer counts.
- Shift+Cmd+S opened a native Save As sheet with an enabled Save button. Cancel
  returned to the clean document. Reopening Save As and saving a new file,
  `Exit-QA-B-final-saveas.luma`, worked without a disabled-button failure.
- Adding one more layer and using ordinary Cmd+S wrote that new path. The
  original Exit-QA-B file remained at three layers with an unchanged hash.
- Clean Cmd+Q exited. Relaunch restored the new filename, four layers and clean
  state. Closing that clean tab and using native Open to load the actual saved
  file restored four editable layers and one history version. Undo returned to
  three layers and dirty state; redo returned to four layers and clean state.

Final QA files in `artifacts/native-trust-pass8-gkRzYs/`:

| File | Layers | SHA-256 |
| --- | ---: | --- |
| Exit-QA-A.luma | 4 | 65e56d13a452c8992528c27563d8d76489b64d9bd90a268e44f2140ae7e7ed5e |
| Exit-QA-B.luma | 3 | e6568a2ab683894cfb208f99ef2f0a169611244f6fd6e25e423101491bd8841e |
| Exit-QA-B-final-saveas.luma | 4 | 3bef17ff3ccdf10e9f9e8173c8b66ed6b5042c54588af7d630630b87b0d959bd |

The original `native-paragraph.luma` and `quit-safety-check.luma` evidence files
retained their previous hashes. Only isolated QA documents were edited. The
review app was left open on the clean, reopened QA document.

Native Dock access again timed out; no Dock Quit pass is claimed. No native
Don't Save action was performed because the specific discard confirmation has
not been received. The older intermittent disabled Save observation did not
recur in this run, but its root cause is not established and one successful run
does not close an intermittent-dialog investigation. Actual full-volume,
hardware-power-loss, notarization and clean-machine qualification remain open.

The application-shell validation checklist guided the native shortcut, dirty
state, remembered-path, relaunch and restored-history checks. No visual redesign
or unrelated feature work was performed.
