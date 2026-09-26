# PSD/PSB flattened-fallback reduction

## Scope

Reduce unnecessary flattened imports without raising the 2 GiB Photoshop decode estimate, the 512 MiB native-project decode admission ceiling, or the corpus's 3 GiB per-process RSS ceiling. This is not full Photoshop compatibility qualification.

## Changes

- RGB8 PSD/PSB preflight walks bounded layer records, channel lengths and mask rectangles without allocating pixels. Local rectangles replace the old assumption that every layer—including groups—fills the document. High-depth and non-RGB decoding retain their prior conservative path.
- Eligible layered imports retain compressed channel views and decode one layer at a time. Actual layer bounds, format and cumulative pixels must stay within the admitted geometry. Decoder images are released after ownership passes to Luma.
- Project PNG restoration streams each entry into one owned buffer and closes decoder images even on failure. Admission counts every independent retained canvas, with one serial PNG scratch working set. History pixel patches also restore serially. Opaque assets do not receive the canvas-specific byte discount.
- Text exports trim transparent preview margins in bounded strips. Editable text descriptors and absolute placement remain intact. Exported text no longer creates a document-sized raster preview that can force fallback on reopening.
- Export-owned rasterization canvases are explicitly released after writing (including writer failures), rather than retaining another native bitmap stack until garbage collection. Preserved masks, linked assets and document bitmaps are not released.
- Import admission checks an estimated native restore cost as well as PSD decode cost. The final project save/open admission remains authoritative: this estimate is not a hard process-RAM guarantee.
- Corpus checks now compare layer names, kinds, parent hierarchy, mask presence and the opacity edit across native and Photoshop round trips, in addition to preview pixels.

## Acceptance policy

Two formerly flattened cases now require layered import: `private-bad-habits` requires 13 editor layers and `private-flme-psb` requires 14. Their source records number 15 each because Photoshop includes two and one group-end marker records respectively. The acceptance counts exclude only those markers; they are not permission to drop content. Save/reopen/export must preserve the imported structure.

Three cases remain explicitly fallback-qualified: `private-bad-habits-life`, `private-pussi` and `private-where-we-at`. The first two can now fit serial PSD decoding but still exceed the current native restore budget. The last has roughly 878 MiB of local layer RGBA bounds before masks, scratch, original source, history or compositor overhead.

## Remaining work

Removing the remaining three fallbacks needs disk-backed/lazy raster layer storage through import, editing, project save/reopen, history and export. Merely raising a limit or returning many layer names over one flattened bitmap is not a fix. Existing .luma files already saved as flattened previews are not automatically converted into editable layers by this change; reopen copies of the original PSD/PSB inputs.

Independent Photoshop-rendered reference goldens and a substantially larger real-world corpus remain missing. Self-roundtrip success does not establish Photoshop visual fidelity, complete editable effects/smart objects, or a hard process-memory cap.

## Evidence

Canonical machine-readable results: `artifacts/compatibility-corpus-report.json` and `artifacts/local-hardening-report.json`. The desktop frontend build is validated separately. No installation, distribution signing or notarization is implied.

Final source: `eddcb40d85d44f95ce849bd81200b4b9962da23b69d564cbbf5639984acec16f`. Both canonical reports match this source.

- 949 TypeScript tests, 10 native-bridge tests and 9 native-core tests pass; types, lint and desktop frontend build pass.
- All eight corpus workflows pass: four layered, one source-composite-only, three declared flattened fallbacks.
- Newly layered cases retain 13 and 14 editor layers, with zero native round-trip preview error. Photoshop self-roundtrip mean errors are 0 and 0.002 respectively.
- Latest full-run peak RSS is 1190.9–2184.8 MiB, below the unchanged 3072 MiB case ceiling. A focused run of the 13-layer case reached 2822.4 MiB; RSS varies with runtime allocation/collection. This is evidence for these measured workflows, not a hard process-memory guarantee.
- An intermediate run failed the RSS gate before explicit export-canvas disposal was added. That failure was not reclassified or waived.
