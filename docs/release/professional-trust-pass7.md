# Professional trust — updater, typography, recovery and shell defects

This is continued engineering and qualification, not roadmap completion or a
10/10 claim. No compatibility tolerance, resource ceiling or release gate was
relaxed. The production installation and user projects were not replaced.

## Repairs

- Update installation is two-phase: bounded, signature-verified download,
  then a durable whole-workspace checkpoint and immediate ownership check,
  then installation using a single-use native ticket. Concurrent attempts,
  stale tickets, dirty tabs, checkpoint failures and late edits refuse safely.
- Native artifact retention is capped at 512 MiB, with advertised-length and
  incremental chunk admission, bounded allocation, HTTPS/redirect restrictions,
  timeouts and Minisign verification. Tests exercise valid/tampered signatures
  and local fault transport. This is not a total-process memory ceiling, nor
  production updater qualification; metadata checking still uses Tauri's path.
- Recovery validates all tab identities and durable-write ownership. Aborted
  IndexedDB transactions reject and close connections. Damaged manifests are
  reported and retained; routine checkpoints cannot silently replace them.
  Failed workspace reads no longer silently fall back to older legacy files.
- Display-only changes (viewport, target canvas, focus and font readiness) no
  longer invalidate document save/recovery tickets. Actual edits still do.
- Titles, canvas labels and export names follow the engine's active document;
  the duplicate UI-only name was removed. PSD imports retain the input filename.
- Transform handles and snapping use local shape/path/text content bounds.
  Scaling and skew preserve the opposite corner/edge for nonzero local origins,
  including rotated/sheared objects. Text measurement reuses the bounded layout
  pipeline; unmeasurable/over-budget text retains a document-box fallback.
- Fully collapsed side docks become compact icon rails with keyboard-accessible
  reopen buttons. The contextual font selector no longer truncates ordinary
  family names to an 82 px field.

## Independent paragraph defect

Photoshop created the private Arial paragraph fixture itself. Before repair,
Luma imported it as point text. Edited output also omitted real `boxBounds`,
allowing an external paragraph frame of zero size.

Import/export now retain a valid paragraph frame, top-vs-baseline origin,
alignment and paragraph properties. Native cap-height metrics use bounded SFNT
table parsing. Wrapping no longer counts trailing breakable whitespace against
the line width; NBSP remains nonbreaking. Unsupported paragraph outlining and
unqualified external recomposition are explicit, not silently approximated.

`artifacts/photoshop-paragraph-EhLLQK/report.json` records the original failure.
`artifacts/photoshop-paragraph-F2KTWE/report.json` records the first repaired
structural round trip, including external Photoshop reopen and recomposition.
This is one independently authored synthetic fixture, not a real-project corpus.

Visual parity remains **failed**, with unchanged tolerances.
`artifacts/native-font-regions-UzwTwh/report.json` reports RGB MAE 0.5611636,
alpha MAE 3.5432958 and worst local alpha MAE 31.677734. Correct line wrapping
improved the comparison, but glyph placement/coverage still differs. No pixel
translation or tolerance adjustment was used to relabel that failure.

## Shell validation

The Photoshop-class app-shell skill guided authoritative document ownership,
actual interaction testing and screenshot review rather than a cosmetic rewrite.
The first screenshots exposed incorrect object handles and an empty collapsed
dock even though click assertions passed. Those defects were repaired before
references were accepted.

`tests/visual-regression/shell-matrix.json` contains 21 reviewed references:
empty document, brush, text, active transform, floating panel, collapsed rail
and multiple documents at 1920×1080, 1440×900 and 1280×800. The existing three
references remain. Installed-Mac capture coverage is still separately required.

The repeat run `artifacts/shell-matrix-2Xll29/report.json` passed at unchanged
source `ce1ff63e4b4bd4ab3c9f23074045f9232abea55f23ad2173fa6e836d3908ae80`.
All 21 comparisons have zero pixel delta outside the explicitly excluded
asynchronous save-status text. Errors are asserted separately; recovery is not
disabled. The script uses an isolated persistent WebKit profile because this
host's ephemeral profile cannot commit Blob storage.

Actual controls exercise tool shortcuts, pinned shape handles, transform/Escape
rollback, float/resize/dock, compact rail/reopen and dirty-tab cancellation.
Real IndexedDB checkpoints and a reload restore both tabs, active identity and
layers. This does not qualify native dialogs, system clipboard or clean installs.

## Final local regression qualification

The frozen-source rerun passed all five checks at
`3ca6bf3856c8044d2862fb49edddb3b7e7ebdbdfb831c18195e9633252bb6b76`:
type checking, lint, **1,223 engine tests**, **20 native-bridge tests**, and
**nine native-core tests**. `artifacts/local-hardening-report.json` records
`unchanged: true`. The earlier run caught a PNG-test Buffer typing incompatibility;
the portable DataView fix was followed by the entire campaign, not an edited
receipt. `git diff --check` passed.

The independent paragraph workflow was repeated at the same final source:
`artifacts/photoshop-paragraph-4k4hfz/report.json` passes import, text edit,
native save/reopen and external Photoshop paragraph-frame/text verification.
The exact-font visual diagnostic was repeated too:
`artifacts/native-font-regions-kNVuD7/report.json` still fails with the same
reported metrics (Photoshop 27.10.0, WebKit 26.5). Structural success is not
being substituted for that failed visual gate.

The release-status command still reports **4/10 evidence gates**, not a product
score. The internal eight-case report remains stale, with seven layered and one
flattened workflow; the real independent Photoshop pilot remains 0/3 complete
workflow qualifications. None of the following gaps is relabelled PASS.

## Signed native candidate

The final source built successfully as the separate
`src-tauri/target/release/bundle/macos/Luma Save Trust Review.app`.
`artifacts/native-build-report.json` records executable SHA-256
`c23a139c553804e8fffe631b5acb183c5638d4a25251cc30b510c8734c4b8429` and the same
final source hash. Strict deep code-signature verification passed, with
Developer ID Application: Armon Nasiri (NJBZDU7XZX) and hardened runtime.
The build explicitly skipped notarization because release credentials were
absent. This does not pass the notarization or clean-machine gates.

Attempting to inspect this rebuilt app through native UI automation was blocked
by the locked Mac; automatic unlock failed. Manual unlock was requested. No
native interaction pass is claimed for this new binary. The earlier pass-6
native workflows apply to their older binary, not this candidate.

## Additional WebKit regression found after signing

The next repeat capture failed dramatically at the collapsed dock:
`artifacts/shell-matrix-SvbJbg/report.json` records a real DOM Range spanning
the workspace and computed `webkitUserSelect: text`. Clearing that browser
selection in a diagnostic copy removed the blue canvas tint; no reference was
changed and no tolerance was widened.

The shell now supplies WebKit's prefixed selection policy, preserving text
selection in input/textarea/contenteditable fields. Dock move/resize gestures
reject non-primary buttons, prevent default browser selection, capture their
pointer, and end on pointer cancellation. The matrix now asserts no DOM range
from workspace gestures and explicitly tests Cmd+A inside the text editor.

`artifacts/shell-matrix-oR0THm/report.json` passes all 21 unchanged references
and the new text-selection assertion at source
`8271d8386639ddc5fe296a09e74135e5367ff10ba3d6a52a4b301ea08ca6c190`.
The prior signed candidate and regression receipt were superseded for this
follow-up. A second consecutive visual run,
`artifacts/shell-matrix-rPOsni/report.json`, also passed all 21 references with
zero delta outside save-status text. At that same source, the entire local
campaign passed again: **1,224 engine tests, 20 native-bridge tests, nine
native-core tests, types and lint**, with `unchanged: true`.

The candidate was rebuilt and strictly verified again at this follow-up source.
`artifacts/native-build-report.json` now records executable SHA-256
`169b8c6b0ac0f1ad5d043dcd20d7c7c13554f5694d651204d554a3e4c23bad2b`.
Developer ID signing and hardened runtime passed; notarization was again
explicitly skipped. Native interaction remains blocked pending manual Mac
unlock. The owned diagnostic server on port 4183 was stopped after testing;
the production installation and other apps were not changed.

## Remaining gates

The independent real-project pilot is still not a qualified 50–100-project
corpus. Exact Photoshop text rendering, missing licensed fonts, broader editable
interchange, high-depth/RAW/print workflows, sustained process-memory limits and
long-session installed-app qualification remain unfinished engineering/evidence.

External prerequisites remain: licensed CanelaText-Regular; Apple notarization
Keychain profile; production updater signing/endpoint configuration; production
crash collector with stored scrub/symbolication evidence; printer/PDF-X/ICC
requirements; and independent clean machines. Do not request private keys or
passwords in chat. These prerequisites do not make the remaining local work done.
