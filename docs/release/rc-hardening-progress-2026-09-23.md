# RC hardening progress — 2026-09-23

## Assessment

Luma is not yet a qualified production release. This pass improves crash-reporting
safety, updater configuration validation, and dependency security without adding
features or weakening release gates. The existing shell and imaging architecture
were preserved.

Tested source fingerprint:
`47112c06a12b2d767869ac6468b5c551b7a07f05e44c09d7fb47b9ae5189d20b`.

The worktree already contained substantial application changes. This pass did not
commit, push, deploy, replace the installed app, or certify those changes as a
complete Photoshop replacement.

## Fixes in this pass

- **Crash-ingress admission:** count streamed UTF-8 bytes before decoding the
  complete request; enforce 32 KiB and a four-second read deadline; release
  admission on malformed, interrupted, or oversized bodies. Rate limits and the
  four-request concurrency limit now apply before body parsing.
- **Website crash reporting:** accept the endpoint's own origin, while retaining
  the desktop-origin allowlist and rejecting unrelated origins.
- **Delivery correctness:** separate in-flight reports from acknowledged reports.
  Concurrent success can no longer persist an unacknowledged report as delivered.
  Failed retained reports remain retryable after restart.
- **Bounded reporting state:** at most two client requests in flight and 100
  acknowledged receipt IDs in memory/storage.
- **Transport privacy:** reject client endpoints containing credentials or URL
  fragments; refuse redirects on both client delivery and collector forwarding.
- **Updater configuration:** validate canonical base64 and the actual 42-byte
  minisign public-key structure, algorithm, and nonzero key bytes. A plausible
  truncated string no longer passes. This validates format, not key ownership or
  the availability of a production update service.
- **Development dependencies:** a scoped esbuild override removes the remaining
  reported audit vulnerabilities without forcing a Drizzle downgrade. Drizzle's
  metadata check still passes.

## Verified locally

| Check | Result |
| --- | --- |
| Application regression tests | 1,029 passed, zero failures/skips |
| Native bridge tests | 10 passed |
| Native core tests | 9 passed |
| TypeScript | Passed |
| ESLint | Passed |
| Drizzle metadata check | Passed |
| Full npm dependency audit | Zero reported vulnerabilities |
| Production-only npm audit | Zero reported vulnerabilities |
| Whitespace/error diff check | Passed |
| Source unchanged during qualification | Passed |

Evidence: `artifacts/local-hardening-report.json` and the logs in
`artifacts/local-qualification/`. New regression coverage is in
`tests/crash-release-hardening.test.ts` and `tests/release-config.test.ts`.

The previous review's website/native-frontend builds and sampled UI checks are
historical evidence, not fresh builds of this fingerprint. This pass did not
change UI interactions or run an exhaustive native feature-matrix test.

## Real-file campaign: diagnostic only, incomplete

`artifacts/rc-hardening-corpus-2026-09-23.json` records a forced source-backed
PSD/PSB diagnostic campaign against the existing eight private fixtures. It did
not replace the official corpus evidence or reduce its 50-project/RAW/golden
reference requirements.

| Fixture ID | Observed result |
| --- | --- |
| private-ndw | Edit/native save/reopen/Photoshop export/reopen passed; peak RSS 537.3 MiB |
| private-bitty | Safely rejected by forced source-backed format/memory admission |
| private-bad-habits | Safely rejected: source-backed Photoshop masks not qualified |
| private-bad-habits-life | Workflow passed; peak RSS 1,631.7 MiB |
| private-pussi | Workflow passed; peak RSS 2,096.7 MiB |
| private-where-we-at | Interrupted after host overload; not a successful workflow |
| Two PSB cases | Not reached |

Forced source-backed rejection does not prove that normal import fails for the
same file; it identifies a limitation of that storage path. Passing self-round
trips do not establish Photoshop-rendering fidelity without external goldens.

The host was admitted initially, then exceeded the campaign load threshold.
The campaign recorded that condition. I interrupted only this campaign; no
unrelated processes were stopped. The report retains three passes and three
failures (including the interruption), two unexecuted cases, `completed: false`,
and `environmentQualified: false`. These observations are not a performance
benchmark or release qualification.

## Distribution status

A Developer ID Application certificate is available in the local keychain.
However, a new signed build was deferred when the host became severely
overloaded. No new signing, notarization, updater-delivery, remote-crash receipt,
symbolication, or clean-machine result is claimed.

The user was asked for the locations/names of existing updater infrastructure,
crash collection, and Apple notarization configuration—not secret values.
Production destinations or credentials must not be invented.

`npm run release:status` remains **4/10 gates passing**: P0 checkpoint, sparse
selection regressions, sparse mask regressions, and recovery regressions.
This count is a release-evidence checklist, not a product-quality score.

## Next release work

1. On a quiet machine, rebuild the website and desktop candidate from the tested
   fingerprint, run the rendered-site smoke tests, sign the candidate, and audit
   the sealed bundle. Do not confuse signing with notarization.
2. Complete the ordinary and source-backed compatibility campaigns, retain
   masked-layer failures, and expand to independent Photoshop goldens and a
   representative RAW corpus. Do not remove fallback guards without bounded
   masked-layer decoding and edit/save/reopen coverage.
3. Configure real production updater and crash endpoints; validate two-version
   upgrade/failure scenarios and a remotely received, symbolicated crash.
4. Submit the intended release through the approved notarization workflow,
   validate Gatekeeper and the stapled ticket, then qualify two clean machines.
5. Complete native visual/interaction coverage and professional job trials before
   declaring broad beta readiness.
