# Critical-review fixes — September 23, 2026

## Implemented

- **Save/reopen safety:** project and recovery encoders now validate restore-memory admission, manifest, entry, expansion and archive limits before returning success. Unsupported saves leave the open document intact. This fixes the reproduced unsafe-success case; it does not expand the supported document-size envelope.
- **Destructive edits:** filters and radial warp stage bitmap/precision changes, reserve known working memory, and restore original owners on pre-commit failure. Action recording happens after successful filter commit. Perspective crop and selection refinement gained failure rollback/admission. History size accounting runs before topology mutation; UI subscriber exceptions no longer masquerade as failed commits.
- **Native Cut:** captures a cut ticket first, publishes the OS clipboard, then deletes only if publication succeeded and document/revision/clipboard ownership still matches. Failed or superseded publication leaves original pixels intact.
- **Smart Select:** permits the verified Hugging Face CDN origin, bundles the installed ONNX runtime module and WASM instead of executing CDN JavaScript, uses a single-threaded WKWebView-compatible setup, stops late progress callbacks after completion/failure, and explains fallback. Release CSP is derived from the canonical policy rather than a diverging handwritten copy.
- **Memory:** layer and major history snapshot serialization/restoration run sequentially rather than spawning a codec task per layer. Added Fill admission and refusal of destructive filters on reduced-resolution proxies. These are bounded-allocation improvements, not a hard process-RAM limit.
- **UI:** selection sliders appear in the contextual toolbar or inspector, not both. Selection action styling follows the dark workspace and permits wrapped labels. Save errors persist until dismissed; generic notifications no longer display a success checkmark for errors.
- **AI upload security:** total bytes are counted in the stream before multipart parsing completes, including chunked bodies. Rate and process-wide concurrency admission precedes parsing/hashing. Permits release on validation failures, identity buckets are bounded, and active requests cannot escape concurrency accounting at a rate-window rollover.
- **Release evidence:** corpus output explicitly distinguishes stale/current source and layered versus flattened results. Native builds produce an executable/source receipt for notarization verification. Crash endpoint acceptance no longer falsely asserts that server-side scrubbing was verified.

## Direct native evidence

In the separate Developer ID-signed **Luma Hardening Runtime Review.app**, the sampled cold-load selection finished with **SAM click select** in native Version History. The earlier CDN-only candidate still fell back; bundling the inference runtime resolved that tested path. The loading overlay cleared. This is runtime qualification of a sample operation, not an accuracy-parity benchmark.

Native **Cut → Paste in Place** produced an editable `Pasted pixels` layer and the transparency-preserved confirmation. Failure/stale-completion behavior is covered by deterministic tests. Installed `/Applications/Luma Studio.app` was not replaced.

Native Save As dialog completion was not verified end to end. Save/reopen admission and small-project round-trip behavior are covered by regression tests; these do not replace native dialog and filesystem qualification.

Developer ID signature verification and hardened-runtime inspection passed for the isolated review candidate. The build explicitly skipped notarization because credentials were not configured. No production notarization, updater or crash-service success is claimed.

## Validation and limitations

The local campaign passes 895 TypeScript tests, type checking, lint, 10 native tests and 9 core tests. Its authoritative, source-bound result is `artifacts/local-hardening-report.json`; check `unchanged` and the source hash before reusing it after edits. Focused regression tests live in `tests/critical-review-regressions.test.ts` and `tests/release-config.test.ts`.

The final bounded-concurrency campaign completed with `unchanged: true`, source `f83f7f43fa3eb285040e91aa4f038ea05c11959e58d4e8144b6bf62d65e08fd5`. The release evidence checker reports 4/10 gates passing. The earlier complete compatibility report is explicitly stale against this final source; it is retained as historical evidence, not a current release pass.

The rerun of the available eight-file real PSD/PSB corpus still records four workflow passes: two layered, one composite-only, one explicitly flattened fallback. Four projects are refused at restore-memory admission, now during save preparation instead of after a successful save. The corpus is not qualified for full editable compatibility. See `artifacts/compatibility-corpus-report.json` for the exact source-bound run; timings and peak process RAM are machine/load-dependent, not competitor benchmarks.

A later repeat overlapped substantial host activity and recorded a 241-second case against its 120-second ceiling; it was stopped without replacing the last complete report. Approximately 15 GB of system swap was in use during this period. These runs do not establish a controlled performance comparison. The qualification runner now caps test concurrency at two, and the vendored ONNX runtime is excluded from application lint, like the existing vendored PDF runtime. Application source remains linted.

The existing multi-document workspace was visually inspected at 1280×800, 1440×900 and 1920×1080, and the temporary browser viewport override was reset. These observations do not substitute for new persisted golden screenshots or the seven missing state baselines.

## Not complete / required next

1. Streaming/lazy project and Photoshop metadata restoration, larger-document transaction coverage, and reliable editable PSD/PSB fidelity. Do not loosen ceilings merely to obtain more passing files.
2. The seven missing persisted visual reference states and full three-viewport interaction/diff campaign. Native selection UI was inspected, but that is not the complete matrix.
3. A representative 50–100-project compatibility corpus with independent Photoshop visual/structural references and camera RAW cases.
4. Production notarization credentials or an existing keychain profile; production updater endpoint/public key and signing setup; a real crash collector with independently verified scrubbing/symbolication; clean-machine and interrupted-update tests.
5. Process-level memory measurements and broader selection accuracy qualification. A working native SAM sample is not proof of Photoshop parity.

No user project was intentionally overwritten, and no changes were committed or pushed in this pass.
