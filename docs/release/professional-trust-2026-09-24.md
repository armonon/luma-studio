# Professional trust campaign — pass 1

## Scope

This implements the first **baseline → reproduce → repair → external compare**
pass of the professional-reliability brief. It does not complete the entire
roadmap, certify print output, or qualify a production release. No user originals
are overwritten. Private source files and generated references remain local in
ignored `artifacts/` directories. The installed Luma application is not replaced.

## Fresh baseline

`artifacts/trust-baseline-2026-09-24.json` retains the pre-change eight-project
campaign against source `280022ddd6c1ac620cb713a0bacca418b6197e14926a1142ae00f909e0fa3351`.
It completed on an admitted host with unchanged source and manifest:

- Six PSD workflows passed their internal open/edit/native-reopen/PSD-reopen checks.
- Both PSB inputs failed at the input stage: `Invalid Photoshop global layer tag`.
- Passing cases recorded engine-worker peak RSS from 817.1 to 2525.9 MiB. These
  are not installed-app process-tree measurements or a Photoshop speed comparison.
- One passing PSD is composite-only. It is not evidence of editable layer fidelity.
- The `photoshopReopen` stage name in this legacy runner means **Luma's PSD decoder**,
  not Adobe Photoshop. The new independent campaign separately invokes Photoshop.

## Reproduced defects and repairs

### 1. Modern PSB metadata rejected

The admission parser recognized the `8B64` signature but chose the length width
only from an older PSB key list. Real files contained `8B64/cinf` and `8B64/lnkE`;
their low length word was interpreted as the next block signature.

The parser now honors the explicit signature, retaining the known-key fallback,
safe-integer checks and enclosing-section bounds. Small redistributable synthetic
fixtures cover modern/unknown keys, truncation and oversized 64-bit lengths.
Neither file admission limits nor corpus timing/memory tolerances were raised.

Reference: [Adobe's PSD/PSB additional layer information specification](https://www.adobe.com/devnet-apps/photoshop/fileformatashtml/),
installed ag-psd reader behavior, and the retained real-file block traces.

### 2. Intentional trailing paragraphs lost

Actual Photoshop reopened one exported project without its final paragraph break.
The codec trims every terminal newline in its engine-text decoder, not just the
one engine terminator. Self-round-trips used the same already-trimmed text.

A narrow codec adapter preserves the authoritative text descriptor and decodes
affected engine runs with a temporary non-newline terminator. It removes exactly
that unit, retaining blank paragraph styles. Only affected descriptors are
reparsed; an 8 MiB block ceiling prevents unbounded additional metadata work.
The dependency installation itself is not patched. Tests cover multiple blank
paragraphs, all-newline text, differing blank-paragraph styles, native project
reopen and PSD re-export. This does not claim general text-engine equivalence.

### 3. Unsafe high-depth/vector-mask export

The single-layer 16-bit fast path omitted several appearance exclusions present
in the multi-layer writer. A vector-masked raster could be reported as native
16-bit output even though its raw composite was not masked. The ordinary writer
also lacks serialization of Luma-owned standalone vector masks.

The fast-path eligibility now rejects these combinations. PSD/PSB delivery with
an editable Luma vector mask fails explicitly before bytes are published, with
the affected layer identified. **This closes silent loss, not the missing mask
writer implementation.** Existing imported descriptor preservation is separate.

### 4. Approval bypass and opaque blocking errors

The Studio exporter previously accepted lossy output when its optional approval
callback was omitted. It now requires approval whenever the final report has
warnings. The lower-level codec still returns bytes plus a report for internal
qualification and composition; user-facing engine exports use the guarded path.

The existing export dialog now distinguishes blocked delivery from a partially
editable copy, explains next actions, and returns to the affected layer. Blocked
output has no proceed control and cannot be approved programmatically. Existing
document-ownership checks still reject changes made during an approval dialog.
No destructive conversion is automatically performed on the master.

The independent text-appearance failure also now creates a layer-specific
`IMPORTED_TEXT_PREVIEW_REGENERATED` warning when imported editable text is
rewritten. This invokes the same mandatory approval flow, explaining that fonts,
line layout and effects need external verification. It does not pretend to fix
the remaining rendering discrepancy. Untouched byte-for-byte source delivery
does not receive a spurious regeneration warning.

The application-shell skill guided reuse of the existing dialog, command path,
selection authority, focus handling and error boundary rather than a new sidebar.

## Independent Photoshop evidence

Run:

```sh
npm run corpus:external -- --case private-ndw,private-sattari-music-psb,private-flme-psb
```

The tool explicitly uses installed Adobe Photoshop 2026 via its scripting API.
It refuses already-open input documents, makes private source copies, preserves
existing open documents, restores dialog/ruler preferences, and closes only its
own documents without saving them. It does not upload documents or use a paid API.

For each case it retains original/expected-edited/external-reopened Photoshop
PNGs and structural receipts, Luma import/edit/reopen PNGs, the native project,
the PSD/PSB export, source/output/artifact hashes, application version, tolerances
and the exact Luma source fingerprint. It records failed cases rather than
stopping at the first discrepancy. Reports go into fresh directories; the latest
index is `artifacts/photoshop-external-report.json`.

The first independent run is retained at
`artifacts/photoshop-external-u3rHKc/report.json`. All three external reopens
completed, but **0/3 met every baseline criterion**. The text-content defect above
was found there. Independent comparison must not be replaced by the internal count.

The post-fix reproduction is retained at
`artifacts/photoshop-external-lqmrb2/report.json`, against unchanged source
`204d200cf0b53f51a1aae9caf8b160b898be3d297b39b72191194e75cf25eeab`.
Actual Photoshop 27.10.0 now reports **zero structural differences** for
`private-flme-psb`, including the previously lost final paragraph. Native
save/reopen has zero pixel delta. However, the case correctly remains failed:
external RGB MAE is 9.7467/255, edge MAE 6.1569/255, and 11.26% of pixels differ
by more than eight levels. The original-to-Luma preview differs still more.
Visual inspection shows changed script-font appearance and overlapping text
lines in the reopened Photoshop image. Font-name equality is insufficient.

The current text export preserves the original editable descriptor when text is
unchanged, but `textLayersToPsd` regenerates the raster preview through Luma's
text renderer. This is a concrete next investigation, not yet proof that it is
the only cause: missing fonts, engine-run regeneration and layout must be
isolated. Do not turn this case green merely because its structure matches.

### Final-source independent rerun: new release blocker

`artifacts/photoshop-external-1tNqJX/report.json` records all three cases on final
source `7b1b77827858287accddc4c4180c93899702c67456515296615be7869ff747d1`.
The source and manifest remained unchanged. **0/3 complete workflows pass.**
The first two cases reopened externally with no compared structural differences
but failed visual criteria. The last case reached `external-reopen`, where
Photoshop displayed a critical alert about layer-reading errors (program error
`f376f9.870`) for Layer 0, sattari l, The Splendid North Indian Tour, Limelight and
others. The test import was canceled rather than continuing with layer loss.
Its failure is retained; it is not treated as a successful external reopen.
Photoshop returned to its home screen afterward, with no test document visible.

The earlier successful reopen does not override this later failure. Repeated
external-reopen stability is now a P0 qualification blocker alongside the known
text appearance discrepancy. The cause of this alert is not yet isolated;
host load is not an established explanation for file-reading errors.
The failing export is byte-identical to the earlier successfully opened export
(SHA-256 `c91b0891d074e96f0b024c1b734d8ff3510c51d8092f300cea93588444955efc`).
That rules out an output-byte regression between those two runs, but does not
qualify reliable delivery. Isolate Photoshop session state and repeat the exact
artifact under controlled conditions before attributing the alert to either app.

### Scope of this baseline

- 512-pixel long-edge references, not full-resolution fidelity certification.
- Explicit Photoshop sRGB conversion and bicubic resampling after compositing.
- Luma uses the headless canvas runtime, not installed WKWebView typography.
- Measures premultiplied RGB error, alpha error, maximum delta, fraction of pixels
  over eight levels, luminance-edge error and alpha-edge error.
- Structural checks include hierarchy, names, kind, opacity, clipping, visibility,
  blend mode, mask presence, text contents/primary font, channels, dimensions,
  resolution, depth and profile. They do not compare every mask sample, effect
  parameter, character run or linked-source payload.
- No external edit-and-save continuation, tablet, color-chart, RAW-camera,
  long-session or process-tree memory qualification is implied.

The release checker now also requires independently qualified external evidence.
A golden PNG or an internal decoder reopening a PSD can no longer, by itself,
satisfy that part of the production compatibility gate. The preview-baseline
report deliberately does **not** qualify it.

## Delivery restriction classification

| Restriction | Class | Required next outcome |
| --- | --- | --- |
| PSD maximum dimension | A: format | Offer PSB and re-check that workflow |
| Grouped/masked SVG/PDF export | B: implementation | Preserve hierarchy/clips with independent renderer comparisons |
| Luma-owned vector mask to PSD | B: implementation | Encode separate mask structure and qualify import/edit/external reopen |
| High-depth raster-stack/effect limits | B: implementation | End-to-end precision compositor/writer, not only correct file headers |
| Missing composite preview on large PSD | B: implementation | Bounded merged-preview writing; disclose composite-only reader impact |
| Luma-specific multi-pass/backdrop effects | C: conversion semantics | Explicit localized conversion choices; preserve the master |
| Linked designer objects in interchange | C: semantics | Preserve geometry; disclose lost synchronization or use a shared master |
| Print certification | External qualification | Printer/RIP, PDF/X target, ICC profile and independently approved proof |

Safe refusal is preferable to silent loss, but is not professional feature parity.

## Next highest-risk work

1. Isolate the repeated-open Photoshop alert, then close independent visual discrepancies without relaxing tolerances.
   Separate missing-font/runtime issues, text layout, effect rendering and resampling.
2. Implement independently qualified standalone vector-mask delivery, then nested
   vector/group/clipping delivery. Retain fail-closed paths for unsupported cases.
3. Extend external checks to full resolution, mask planes, richer text/effects,
   external edit/save continuation, and the full 50–100-project camera/design corpus.
4. Run installed-app save failures, multi-hour histories and process-tree telemetry.
5. Complete production credentials/configuration, signing/notarization, signed
   updater failure campaigns, crash receipt/symbolication and clean-machine tests.

No score increase is justified solely by this pass or its additional test count.

## Final verification

- Final full implementation campaign: **1,160 engine tests, 12 native bridge
  tests and 9 native core tests passed**, along with types and lint (one existing
  `print-export-dialog` ref-cleanup warning, zero errors). Source remained
  unchanged at `7b1b77827858287accddc4c4180c93899702c67456515296615be7869ff747d1`.
  Receipt: `artifacts/local-hardening-report.json`. This includes the final
  imported-text disclosure, modal focus/positioning and header admission changes.
- Desktop and web production builds passed. Existing large-chunk,
  mixed-static/dynamic-import and HarfBuzz browser-external warnings remain;
  a successful build does not qualify every runtime shaping path.
- Chromium **and WebKit** exercised blocked delivery, cancel/Escape, affected
  layer navigation, partial-copy disclosure, Tab containment, and 1280×720,
  1280×800, 1440×900 and 1920×1080 viewports. Screenshots are retained under
  `artifacts/delivery-preflight-ui/`; centered modal inspected visually.
- These isolated browser checks use the desktop shell build, not the installed
  Tauri executable. They do not fill unrelated visual-matrix coverage gaps.
- The temporary preview on 4179 was stopped. The user's original preview and
  installed application were not replaced. No original corpus input was saved.
- The host had substantial competing load. Timings from this verification
  period are not speed/parity evidence; no memory ceilings were increased.
- A full eight-case timing rerun was refused at load 13.60 on eight logical CPUs
  (limit 1.5 load/CPU). The refusal is recorded, not counted as a compatibility
  pass. The pre-change baseline and independent functional reopens remain
  separate evidence. Production compatibility is still unqualified.
- `git diff --check` passed. The user's extensive pre-existing working-tree
  changes were preserved. No commit, publication or production installation was
  made as part of this pass.

**Score: unchanged at approximately 6.5/10 as a professional replacement.**
This pass increases diagnostic confidence and closes concrete trust bugs; it
does not satisfy the full-resolution interchange, long-session, print, RAW,
clean-machine or distribution gates.
