# Real-project restore memory fixes

## Root causes and changes

1. `.luma` restore previously decoded the saved Luma pixels and then imported the embedded original PSD/PSB again solely to recover preservation metadata. New v9 projects store the original import fingerprints and restore descriptors without allocating a second image stack. Original embedded source bytes are read into one bounded, owned allocation. The 512 MiB aggregate decode ceiling is unchanged; accounting distinguishes this single-buffer path from the old multi-copy/pixel-decoding path.
2. Imported Photoshop descriptors retained decoded raster buffers and group child trees after Luma already owned equivalent pixels. Those redundant references are removed. Enabled masks use Luma's saved alpha surfaces; disabled and secondary source masks retain the legacy path to avoid silently dropping their channels.
3. Composite-only PSDs could decode their composite twice. They now take the one-decode path. Eight-bit imports reuse the owned preservation buffer for read-only decoding; high-depth decoding retains its protective copy because the codec can endian-swap channels in place.
4. Display upload wraps eight-bit decoder data instead of copying it to another full RGBA array where the runtime supports ImageData. DOM-optional adapters retain the compatible createImageData fallback.
5. PSD/RAW hashing passes the precise buffer view to WebCrypto rather than first making a redundant full-size JavaScript copy. Untouched source export makes one defensive output copy, not two.

No corpus pass threshold or resource ceiling was increased. Existing flattened imports remain explicitly classified as flattened; these changes do not convert them into editable source layers.

## Regression coverage

- Group/source-index mapping, enabled masks and unchanged source-byte export after save/reopen.
- Edited exports do not use stale source passthrough.
- Metadata-only restore makes no canvas allocations and leaves source bytes unchanged.
- Disabled source masks retain their pixels through the legacy decoder.
- Old v8 projects remain readable.
- Streamed source reads reject short/oversized payloads and enforce exact owned allocation sizes.
- Admission counts other mutable references separately from optimized preservation-source references.

## File-version boundary

New saves use **Luma project v9**. Current code reads versions 1–9; older installed builds that only understand v8 will reject new v9 files. Keep original project/source files and use Save As when trying the new build. The installed application has not been replaced in this pass.

## Qualification boundary

Final current-source results:

- **942/942 engine tests**, 10 native bridge tests and 9 native core tests passed.
- Typechecking, repository lint, desktop frontend build and whitespace checks passed. Existing bundle-size warnings remain.
- `artifacts/local-hardening-report.json`: source `43077ee19486af0807390a2851e6c3d37c99c911217db8f59fbbe1686607b384`, `unchanged: true`.
- `artifacts/compatibility-corpus-report.json`: same source, **8/8 workflows passed**, compared with 3/8 in the prior diagnostic. Two remained layered, one was composite-only and five used already-declared flattened fallback. All sampled native and Photoshop round-trip preview mean errors were zero.
- Peak RSS across cases was **1,085.7–2,998.0 MiB**, below their unchanged 3,072 MiB limits. The largest-source workflow still has limited memory headroom; this is not a hard process-memory guarantee or a controlled competitor benchmark.
- Release evidence remains **4/10 gates**. The compatibility gate correctly remains failed because the corpus is small, not fully editable, lacks Photoshop goldens and has no representative RAW cases. Updater, notarization, remote crash collection and clean-machine qualification remain outstanding.

The diagnostic corpus contains eight local real PSD/PSB files, with self-round-trip comparisons rather than independent Photoshop goldens. Its per-case memory limits remain 3,072 MiB. The release corpus requirement remains at least 50 projects including representative RAW cases. Neither an eight-file pass nor unit tests establish general Photoshop parity or a hard process-RAM guarantee.
