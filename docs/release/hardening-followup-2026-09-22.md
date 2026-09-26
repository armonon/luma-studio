# Critical-review hardening follow-up — September 22, 2026

This is an implementation follow-up, not a declaration that every finding or release gate is complete. Existing unrelated working-tree changes were preserved. Nothing was committed, pushed, deployed, or installed over the user's application.

## Implemented

- Pixel-memory reconciliation includes **all open documents**, not just the active tab. Evicted accounts can rebind; releasing an old handle cannot unregister a new generation. Closing a tab releases its live accounts.
- Fill and Clear preflight shared tile capacity. A failed precision sync rolls back the affected bitmap region and precision tiles without advancing undo history. This is not yet a universal transaction wrapper for every engine mutation.
- Document/session/history/render/action guards reject stale recovery, image/Photoshop/artboard exports, native compositing, generative editing, neural masking and SAM selection. Neural fallback cannot bypass stale-document rejection.
- Recovery rejects bitmap/precision hybrids produced by an edit during PNG encoding. Synchronous close tombstones and commit-time checks prevent delayed recovery writes from recreating a closed tab; older timestamps cannot replace a newer per-document checkpoint.
- Project decoding has a **512 MiB aggregate estimate ceiling**, counting repeated asset references rather than unique ZIP entries. PNG content is recognized by signature, including renamed assets. Document layers decode serially.
- Image export, project save/recovery, project decoding and generative editing reserve estimated working memory against a **1 GiB known-memory admission ceiling** that includes open-document canvases, resident tiles, history, caches and concurrent reservations. Streaming PNG additionally caps retained compressed output at **128 MiB**, with cancellation/stream cleanup.
- Viewport partial reuse checks document identity. The shell explicitly reattaches the current canvas target after remounts. Sparse masks can enter Focus mode.
- Uniform decorated/appearance text stays a complete Canvas-shaped run. Styled horizontal text groups contiguous styles and bidi levels rather than drawing each grapheme independently. This improves joining, ligatures and visual order within runs.
- Vendored PDF runtime glue is excluded from application lint. Marketing no longer promises unlimited undo retention.
- Compatibility gates no longer count composite-only PSDs as editable imports. Qualification evidence must identify the current source hash (including dirty and untracked source). `npm run qualify:local` records actual type, regression, lint and Rust test outcomes; test-file existence alone no longer passes those release checks.

## Regression coverage

`tests/document-ownership-regressions.test.ts` reproduces cross-tab accounting/editing, account rebinding, asynchronous export ownership, edit/close during recovery, repeated-asset decode amplification, streaming cancellation/output ceilings, failed precision-commit rollback, decorated Arabic shaping, cross-document partial repaint, mid-encoding recovery edits and delayed AI responses. AI tests use a local stub; no paid requests or user artwork uploads occur.

Latest full engine run: **866/866 passed**. TypeScript and whole-repository lint passed. An isolated ad-hoc-signed `Luma Studio Hardening Review.app` was built; it does not replace `/Applications/Luma Studio.app`.

The source-pinned local campaign also passed all five checks, including **7 native bridge tests and 9 native core tests**. The release checklist remains **4/10**, now backed by executed local tests for its regression checks.

The fresh eight-file PSD/PSB campaign completed with **4 passing and 4 failing workflows**. All four failures occur at the aggregate `.luma` decode-memory ceiling during project round trips. One passing workflow explicitly uses flattened fallback; it is not counted as editable Photoshop parity. This is a known compatibility regression from the new conservative admission policy, not a completed large-file fix. The previous 8/8 report predates these changes and must not be treated as current evidence. Fresh results: `artifacts/compatibility-corpus-hardening-2026-09-22.json`.

## Still open / do not advertise as complete

1. **Native visual acceptance:** the previous build still displayed a previous document's image while changing tabs. The new target/cache fixes require verification in the rebuilt app. The Mac locked before that check; no visual pass is claimed.
2. **Universal transactions and memory admission:** the protected workflows above are not every editor path. Browser/GPU/model memory cannot be measured exactly from JavaScript. Stroke/filter/transform/import paths outside these reservations still need a complete failure-injection and peak-RSS campaign. These limits are conservative known-allocation estimates, not a hard process-RAM cap.
3. **Typography unification:** cross-style complex-script joining, path/vertical layouts, custom OpenType axes and exact parity between Canvas, HarfBuzz outlines and SVG/PDF still need qualification. Grouped Canvas runs are not a replacement for a single shared glyph-layout engine.
4. **Compatibility:** the available eight-file PSD/PSB corpus is not the required 50–100-project campaign and has no representative camera RAW coverage or Photoshop-generated fidelity goldens. Safe refusals must remain visible failures where an expected workflow cannot complete.
5. **Distribution:** Developer ID/notarization credentials, production signed-update endpoint/public key, verified remote crash collection/symbolication, clean-machine installation and interrupted-update evidence are still required. Local compilation/ad-hoc signing is not distribution certification.

## Re-run

```sh
npm run qualify:local
npm run desktop:build
npm run release:status
```

Local logs/report: `artifacts/local-qualification/` and `artifacts/local-hardening-report.json`. Qualification reports are invalidated by subsequent source changes. External reports must carry `sourceSha256` for the actually tested candidate, alongside their artifact hashes; do not stamp an old binary's report with the current checkout hash.
