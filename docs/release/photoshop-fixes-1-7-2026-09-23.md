# Photoshop findings 1–7: implementation status

This is a partial closure report, not a Photoshop-parity declaration. Safety
mitigations are distinguished from missing professional capabilities.

| Finding | Implemented in this pass | Still open |
| --- | --- | --- |
| 1. Retouching | Remove/Spot Heal use bounded local patch search to retain texture; immutable fallback sampling avoids scan-order feedback. Shared patch plans produce matching whole/tiled results. | Real-photo quality campaign; full healing/patch solvers; wet mixer reservoir; advanced Liquify modes. Local patch search is not semantic object removal. |
| 2. Channels | Composite RGB luminosity, individual RGB channels, and transparency can be loaded as editable selection alpha. Central command, native menu, keyboard shortcut, panel button, undo/redo, alpha weighting and preflight refusal. | Named alpha/spot-channel editing, Apply Image and Calculations. Extraction is limited to 16 MP, not advertised as an extreme-document path. |
| 3. Adjustments | Six-color B&W mixing, 2–16 Gradient Map stops, .cube 3D LUT import with trilinear interpolation; bounded parsing, deep history copies, LUT history-byte accounting, project persistence. Version 11 projects deduplicate LUT samples in lossless binary assets instead of repeating them throughout the JSON history; versions 1–10 remain readable. B&W weights and gradient stop positions enter PSD descriptors. Reset and duplicate blur-commit bugs fixed; layer/document-keyed editor. | Targeted HSL bands; PSD LUT embedding; Adobe visual equivalence, gradient midpoints/opacity interpolation. |
| 4. Smart Objects | Admission covers replacement working buffers. A failed history commit restores the same original bitmap/surface owners. Failure-injection regression added. | Photoshop embedded/linked source editing and broader native content replacement. Existing 4 MP, RGB8/non-RAW restrictions intentionally retained. |
| 5. High-depth / print | Desktop export requires approval of compatibility warnings before encoding/writing; cancellation and a document change during approval abort export. Removed the misleading “editable fidelity preserved” toast. | General layered 16/32-bit PSD/PSB writing; CMYK/Lab document masters and certified CMYK/PDF-X delivery. Existing narrow native16 path remains. |
| 6. AI output geometry | Explicit 2× Upscale and 150% Expand raster copies in new document tabs; original layered tab untouched. Expansion masks protect the original area and original rendered pixels are restored into the result. Actual provider output size is requested. Geometry/provenance persist; generated layers undo/redo. | Live-provider/native-WebView qualification; larger output tiling; in-place editable-layer enlargement. Output capped at 3840/side, 8.29 MP, 3:1 aspect and memory admission. These are generative raster copies, not lossless super-resolution. |
| 7. Selection / speed proof | Offline paired-mask corpus runner compares Luma AND Photoshop against independent ground truth, hashes inputs/protocol/masks, records failures, and enforces coverage/accuracy gates. Existing matched GUI workflow benchmark tooling retained. | 50 independently annotated matched real-image cases and qualified paired GUI timing/memory runs. No new parity/performance claim is made. |

## Validation

- Targeted algorithm, channel, geometry, transactional failure, project reopen,
  native-menu parity, and PSD regressions passed.
- Full TypeScript test campaign: 1,044 passing tests at the final engine checkpoint;
  results are recorded in `artifacts/local-hardening-report.json`.
- Type checking, lint, 10 native bridge tests and 9 native core tests passed.
- Production web and desktop-front-end builds passed; four rendered-site/API
  smoke tests passed. Existing large-chunk and HarfBuzz browser-external build
  warnings remain.
- Browser checks in isolated port 4179: six B&W controls; slider edit; Reset;
  Cmd+Z restoring pre-reset value; adding a third gradient stop; Channels
  reachability; LUT import control; export warning dialog and Cancel; AI
  enlarged-copy labels.
- Imported the local identity `.cube` fixture through the browser file chooser
  and verified its title/size. Final rebuilt preview confirms visible 24px
  gradient color controls and a normal-sized Reverse checkbox.
- Empty-corpus CLI smoke test exits unqualified; no sample data was fabricated
  to satisfy the real-world selection gate.
- Additional project regressions cover a full 33³ LUT with 20 history edits,
  single-asset deduplication, exact sample preservation, reopened undo/redo,
  decoded-memory refusal, corrupt samples and legacy inline LUT import.
- AI response tests use a mocked provider. No production AI request, billed
  generation, or user image upload was performed.
- Native menu source was updated, but this pass does not assert an installed,
  signed/notarized native application has been qualified.
- The host became severely overloaded during validation. Test pass/fail remains
  useful; elapsed times from this session are NOT performance evidence.

## Run the paired selection corpus

Run from the repository:

```sh
npx tsx build/run-selection-corpus.ts /path/to/corpus/manifest.json /path/to/report.json
```

Example manifest (replace placeholders with real retained evidence):

```json
{
  "schema": "luma/selection-corpus@1",
  "photoshopVersion": "record the exact tested version",
  "cases": [{
    "id": "portrait-01",
    "category": "hair-fur",
    "image": "portrait-01/source.jpg",
    "luma": "portrait-01/luma-mask.png",
    "photoshop": "portrait-01/photoshop-mask.png",
    "truth": "portrait-01/independent-mask.png",
    "protocol": "portrait-01/protocol.txt",
    "independentAnnotation": true,
    "real": true
  }]
}
```

Masks must be dimension-matched opaque grayscale PNGs: black unselected, white
selected, intermediate values for partial coverage. Inputs are capped at 4 MP,
32 MiB each, with 200 cases maximum and corpus-relative paths (including symlink
checks). Cases run sequentially. Incomplete, malformed, synthetic, unlabeled,
duplicated, insufficient-category or failing evidence cannot pass the gate.

Declared thresholds: IoU ≥ .90, boundary F1 ≥ .85, at most .02/.03 behind the
paired Photoshop IoU/F1, soft-edge MAE ≤ .10 and no more than .02 behind
Photoshop. These are engineering acceptance thresholds, not certification.
Provenance and annotation independence still need human review. Do not mark
model-generated or Photoshop-derived masks as independent ground truth.

## Next closure priorities

1. Sparse named alpha channels, including persistence, crop/resize transforms,
   channel math, mask edits and memory accounting across open tabs/history.
2. Expand Smart Object source ownership before lifting its size/depth guards.
3. Replace the narrow native16 writer with qualified general high-depth output.
4. Run real retouch/selection/print campaigns; obtain printer specifications,
   appropriate reference profiles and independent print validation.
