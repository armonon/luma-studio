# Local release-candidate completion follow-up

## Implemented

- Canvas text and HarfBuzz outline delivery now share paragraph-direction, line-order and physical start/end alignment rules. Wrapped numeric lines keep their parent paragraph's direction. RTL point/paragraph rendering no longer silently uses LTR start/end anchoring.
- The single-run Canvas path respects the authoritative default-style font, color and tracking instead of overwriting them with legacy fields.
- Local qualification, compatibility campaigns and native candidate builds share an exclusive per-project lock. Another campaign cannot start against the same project until the current one releases it. Malformed/stale locks fail closed; a competing process is never killed and lock ownership is checked during release.
- Corpus workers have a deadline derived from each fixture's declared duration ceiling (with a bounded startup allowance). The worker still applies the original workflow limit. Interrupts cancel the active child instead of leaving it running.
- Corpus results are checkpointed atomically before and during a run. Partial/interrupted/source-changed results are identified explicitly; the release checker requires a completed, unchanged, internally consistent campaign before considering its substantive compatibility requirements.

## Verified local qualification

The final local campaign completed on September 23, 2026 against source fingerprint `9c69a12d2e9f72e72c9e362e6aacd44472afa4b48935fd2efa050dec902ef139`, unchanged throughout the run:

- TypeScript checks and ESLint: passed.
- Engine/application regressions: 984 passed, zero failures.
- Native bridge tests: 10 passed.
- Native core parity tests: 9 passed.
- Evidence: `artifacts/local-hardening-report.json` and individual logs under `artifacts/local-qualification/`.

These are automated qualification results, not proof that every native interaction or arbitrary external project works.

The release evidence checker currently passes four of ten gates: P0 checkpoint, sparse selections, sparse masks, and recovery/destructive regressions. Compatibility, updater configuration, updater failure testing, notarization, remote crash collection, and clean-machine installation remain unqualified. This fraction describes release evidence, not a product-quality score.

## Fresh native candidate

- `npm run pro:build -- --bundles app --ci`: passed against the same source fingerprint.
- Candidate: `src-tauri/target/release/bundle/macos/Luma Studio.app`, version `0.6.0-rc.0`, 22.79 MiB sealed file contents.
- Executable SHA-256: `73e9951707ab7764d47c7dae506d5f2d1cc4e29488074c358add963fcd042fb5`.
- Bundle audit: strict signature validation, absence of checked development paths, and required document associations passed. The signature is ad hoc; notarization was explicitly skipped because release credentials were not configured.
- Native UI smoke: launched this exact bundle, verified the recovered document canvas, layer list, contextual toolbar and native File menu (New, Open, Save, Save As, Export, Batch, Close). Quit normally without editing the recovered document. This is launch/render/menu-presence evidence, not a complete native feature-matrix test.
- `/Applications/Luma Studio.app` was not replaced. Receipts: `artifacts/native-build-report.json`, `artifacts/local-bundle-audit.json`.

## Remaining scope and limits

### Current-source real-file campaign: 7/8 passed, not release-qualified

The final retained campaign ran all eight cases sequentially against the same unchanged source used by the local qualification and native build. It completed (not interrupted) and returned a nonzero exit code for its one failure. Evidence: `artifacts/compatibility-corpus-report.json`.

- Three passing workflows retained editable layer structure; three passed with explicitly declared flattened fallback; one passed as composite-only input.
- One editable PSD workflow completed its structural/preview round-trip checks but failed the peak-memory criterion: **3524.9 MiB** against its **3072 MiB** maximum (about 34.6 seconds). Its failure must not be relabeled as a compatibility pass. The runner currently omits per-stage metrics from failure records, so the final high-water mark does not identify the allocating stage.
- Peak process RSS across the eight cases ranged from **1114.8 to 3524.9 MiB**. No threshold was relaxed and no forced garbage collection or alternate manifest was used to turn this campaign green.
- The earlier single-case pass is not the final result. It demonstrates variability, not a reliable memory bound.

The next engineering blocker is to attribute and bound allocations across PSD import, native encode/decode, and Photoshop export/reopen, including concurrent live document copies. Keep this complete failing report as the baseline; retain stage metrics on failures in the next instrumentation pass, then rerun the same campaign after a substantive memory fix. Disk-backed editable layer storage remains necessary for the flattened-admission cases. Do not promote this candidate as professionally qualified for arbitrary large projects.

These changes fix additional correctness and validation problems. They do not establish complete Canvas/HarfBuzz/PDF glyph-layout equivalence, arbitrary mixed-style/path/vertical-script support, disk-backed editable layer storage, or a hard process-RSS ceiling.

The three retained flattened PSD imports are constrained by the native project restore budget. Removing that admission check would let users create projects that cannot safely reopen; it has deliberately not been removed or relaxed.

A single-case serial diagnostic of the earlier slow editable PSD passed before these final source changes: approximately 64.0 seconds, 2230.6 MiB peak RSS. It is a diagnostic under this machine's load, not a competitor benchmark or proof of a 2× engine speedup. Its source fingerprint is retained in `artifacts/corpus-isolated-smoke.json`.

## External release requirements

- At least 50 representative real projects, PSD/PSB/RAW coverage, and independent Photoshop-rendered references. Only eight configured projects are currently available.
- Production updater URL/public key and crash collector; a tested upgrade between two independently signed versions, interruption/invalid-signature/offline cases, and a symbolicated crash receipt.
- Intended Apple notarization credentials/profile and successful Developer ID/notarization verification. A signing identity exists locally; that alone is not notarization evidence.
- Installation and complete workflows on two independently identified clean Macs.
- The missing saved visual-reference states and an installed-native interaction campaign remain separate from headless unit tests and browser smoke checks.

The user has been asked for the corpus/reference location and production release configuration. No endpoints, reference images, notarization receipts or clean-machine results have been invented.
