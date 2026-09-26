# Professional trust pass 8 — installed-app termination

## Native regression discovered

On 2026-09-25, the Mac became available for direct testing. The isolated signed
`Luma Save Trust Review.app` at source
`8271d8386639ddc5fe296a09e74135e5367ff10ba3d6a52a4b301ea08ca6c190`
successfully performed these operations using its actual native dialogs:

- Open the independently generated paragraph project's `edited.luma`.
- Edit its story and Save As to a new private file.
- Undo changed the dirty indicator; closing the dirty tab displayed
  Save / Don't Save / Cancel. Cancel retained the tab.
- Redo returned to the clean saved state.
- Close the clean tab and reopen the saved native archive: the edited story,
  two layers, 600 × 400 dimensions, and available undo history remained.

The private native-written artifact is
`artifacts/native-trust-pass8-gkRzYs/native-paragraph.luma`. No production
installation or user project was overwritten. The older recovery document in
this isolated app was retained.

**Failure:** Cmd+Q exited after an explicitly observed unsaved text edit.
This is not a passing data-safety campaign, despite the working tab-close flow.
Source inspection found that muda's predefined Quit calls `terminate:`;
the installed Tao 0.35.3 delegate implements `applicationWillTerminate:` but
not `applicationShouldTerminate:`. The runtime ExitRequested prevention was
therefore not sufficient for Cocoa termination.

## Fix under qualification

The native shell now installs `applicationShouldTerminate:` on its existing
delegate during main-thread setup. Unconfirmed Cocoa termination returns
NSTerminateCancel and requests the existing asynchronous save/discard/cancel
flow. Explicit confirmation retains the existing application exit route.
The existing delegate and all other launch/open/reopen methods are preserved.
Installation fails closed if the framework already owns this method or the
hook cannot be installed, rather than silently overwriting a future delegate.

Startup and file-dialog keyboard guards now use synchronous refs. Native quit
during recovery asks the user to wait, and commands remain disabled until
startup restoration is complete.

The initial focused checks passed: 36 menu/open-queue tests and the native
termination-policy test. These checks do not substitute for repeating the
actual installed-app failure after rebuilding.

## Additional observations and boundaries

Opening a project while an asynchronous recovery checkpoint was in progress
produced a document-changed-during-recovery warning. The original checkpoint
was not silently accepted. This warning/retry behavior still needs investigation.
Native automation encountered focus/input failures in the save panel; successful
save and reopen were checked separately rather than counting those failed
attempts as passes.

Independent Photoshop visual fidelity, the larger real-project corpus,
notarization, signed production updates, remote crash collection and clean-
machine qualification remain open. This report does not raise a product score.

## Persisted native artifact checked

`docs/release/check-native-paragraph-history.mjs` passed against the actual
native-written file (SHA-256
`565c73b14709739891f9d778a20cdd7b33b9427679bb58676686265fc3a306d5`).
`artifacts/native-paragraph-history-ajKLKf/report.json` records two layers,
600 × 400 dimensions, a 300 × 250 editable paragraph frame, exact saved story,
and both history steps undoing and redoing to the exact saved text model.
The second history step was Select All; this result is not a two-text-edit test
and not an independent Photoshop visual rendering pass.

## Recovery queue follow-up

Inspection found a separate reentrancy defect in CoalescedSaveQueue: a request
made from the final idle callback saw the old running promise but could remain
unprocessed when that promise cleared. A producing callback could also request
again before serialization ownership was published. The queue now publishes
ownership before callbacks, restarts for late queued revisions, and waits for
the full sequence. Two new behavioral regressions cover these cases, including
peak producer concurrency of one. The focused 46-test campaign passed.

The first full campaign passed 1,225 engine and 30 native tests, but lint caught
a render-time ref assignment in the new startup guard. That assignment was
moved into startup lifecycle transitions; focused lint then passed with the
pre-existing unused activePreset warning. The failed campaign remains a failed
receipt; a new full campaign is required at the corrected source.

The Mac locked again during the rebuild. Manual unlock was requested. The
new Cocoa guard must still be exercised in the installed app before this
critical quit regression can be called fully verified.

## Additional file-trust hardening

- Closing the last recovered document now retains an authoritative empty
  workspace index. Previously deleting that index allowed the legacy-file
  fallback to resurrect an obsolete project. A real IndexedDB fixture seeds
  both representations, closes the last tab, attempts a delayed stale write,
  and confirms that only a subsequently created fresh tab can reappear.
- Native Save requires the exact boolean success acknowledgement; Save As
  requires a valid nonempty path receipt, with cancellation distinguished from
  malformed responses. Export also rejects non-boolean acknowledgements. A
  failed or malformed response cannot be interpreted as a successful write.
- The corrected intermediate full campaign passed 1,227 engine tests, 21
  native-bridge tests, nine native-core tests, types and lint. The following
  file-trust changes require their own final-source run.
- `artifacts/shell-matrix-I8TaPX/report.json` passed all 21 screenshot comparisons
  at intermediate source `465b5646ed91b47c062d5330acf0aaac8309ae221c184e3117e5c33751960b8b`,
  with zero differences outside the documented save-status exclusion. The
  1440 × 900 text view was also inspected directly. No reference was replaced.

The application-shell skill influenced the narrow lifecycle/command changes
and direct native validation; working panels were not redesigned.

## Final source checks

At source `baa94a99429199f8e6ac867407cd4f1ffb73f5b1690cefd1fd9c4ae7e9ead2cd`:

- `artifacts/local-hardening-report.json`: all checks passed, unchanged source;
  **1,229 engine tests, 21 native-bridge tests, nine native-core tests**, types
  and lint. Lint retains one pre-existing unused-variable warning.
- `artifacts/shell-matrix-fCSNtm/report.json`: all 21 visual comparisons and
  interaction/reload assertions passed against the unchanged reference set.
- `artifacts/native-paragraph-history-r0ZcuU/report.json`: the actual native-
  written archive again passed editable-model and both-history-step validation.
- `git diff --check` passed.
- Release status remains **4/10 evidence gates**, not a product score. No gate
  was weakened to count a known failure or missing external evidence as PASS.

The signed native candidate was rebuilt at this exact source. Its executable
SHA-256 is `38221aef81349d1d7b1981cae8f73ac8db13502d9134e62c4a507a73155ff245`;
`artifacts/native-build-report.json` records the receipt. Strict deep code-
signature verification passed. Developer ID signing/hardened runtime are
present; notarization was explicitly skipped for missing release credentials.
The production installation remains untouched.

The final native testing attempt again encountered a locked Mac. Cocoa
Quit, Dock Quit, Cancel, Save All and post-quit recovery still require a new
direct native campaign once the Mac is unlocked. In particular, the existing
Don't Save quit path also needs explicit recovery-record disposition testing;
the working tab-close flow must not be assumed to prove whole-app discard.

## Direct native retest after unlock — passed paths

The subsequent user-requested check ran the exact signed binary above; its
on-disk SHA-256 was reverified before testing. No application source changed.

- Startup restored both private QA tabs and the prior unsaved text checkpoint.
- **Cmd+Q with dirty work:** the app remained open and showed Save All / Don't
  Save / Cancel. This reproduces and now passes the originally failing exit path.
- **Cancel:** the same unsaved text and both document tabs remained present.
- Saved a separate `quit-safety-check.luma` copy in
  `artifacts/native-trust-pass8-gkRzYs/`; the original paragraph evidence was not
  overwritten. Added a paint layer and verified the dirty indicator.
- **Save All:** with two open tabs and one dirty document, the app saved the
  new layer to the remembered path and exited. The resulting archive contains
  Paint / Editable paragraph / Layer 1, editable text, and two history nodes.
  Its SHA-256 is
  `76b64a46a21b472f63ec851dd451726979d3f7103c8d7ddba6ac39483df1f243`.
- **Relaunch:** both tabs returned; the test project showed all three layers
  and No unsaved changes.
- **Native window close:** after a further test layer addition, the window
  close button also showed the unsaved-work dialog. Cancel retained four
  layers and dirty state. Undo restored three layers and clean state.

The review app was left open with the test document clean. The application-shell
validation checklist guided these separate keyboard and window-close paths.
This verifies the Cmd+Q regression fix and the listed save/relaunch behavior;
it does not certify Dock Quit, multiple simultaneously dirty documents,
Don't Save recovery disposition, interrupted writes, or every release gate.
