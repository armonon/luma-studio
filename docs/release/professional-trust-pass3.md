# Professional trust — effect descriptors and independent delivery

This pass continues P0/P1 qualification. It is not roadmap completion or release
certification. Private originals remain unchanged; generated diagnostic files
stay in ignored local artifacts. No installed app or production deployment is
changed.

## Reproduced defects

1. ag-psd synthesized an empty drop-shadow `TrnS` curve when a legacy effect had
   no contour. Photoshop 27.10.0 rejected the exported PSB layer records. A
   pixel-only diagnostic opened, removing only effects opened, and replacing
   only empty shadow contours with the implicit linear curve opened all 14
   layers with effects retained. The shared writer now makes that repair without
   mutating retained descriptors or copying pixel/channel storage.
2. The real project's modern effect descriptors use `BlnM.vLit`. The codec
   accepted only the long vivid-light spelling, threw, and silently kept the
   old `lrFX` block instead. Strokes and other modern effects disappeared. A
   narrow compatibility adapter accepts the observed alias; remaining effect
   parse errors are surfaced outside the codec's catch-and-ignore boundary.
3. Luma effect contours use 0–1 coordinates; Photoshop uses 0–255. Import and
   edited export had copied these without conversion. Conversely, ag-psd
   already normalizes gradient locations/midpoints; Luma applied 4096/100
   conversions a second time. Both boundaries are now corrected and covered by
   edited-export regression tests.
4. Imported text ignored Photoshop's automatic-leading flag and treated a
   retained 0.01 manual-leading placeholder as active line spacing. Horizontal
   text scale also crossed the ratio/percentage boundary without conversion.
   Both are fixed for default styles and character runs. Edited exports set
   explicit leading, and regressions cover manual/automatic leading through
   native save/reopen and export.

## Independent evidence

- Diagnostic shadow repair: `artifacts/photoshop-bisect-RyHJR3/receipt.json`.
  Deliberately reduced diagnostic files are not compatibility passes.
- First repaired reopen: `artifacts/photoshop-external-ESESzT/report.json`.
  It reopened, but visual inspection found missing headline text and outlines,
  despite aggregate export RGB MAE of 1.965 being below the old threshold.
- After modern-effect parsing and unit repairs:
  `artifacts/photoshop-external-encrrp/report.json`. All three real projects
  completed external reopen; all native save/reopen comparisons were exact.
  The previously failing PSB's external RGB MAE is 0.02597/255, maximum delta 2,
  and compared structural differences are empty. Text and outlines are visible
  again. The other PSD's external comparison is pixel-exact, while the second
  PSB retains a small alpha difference.

Final-source repeat: `artifacts/photoshop-external-cf1MeP/report.json`, source
`e079f7ae7e99a9a25e13f28e3b5c40738356f5026a193354c615b12894ee6e53`.
The repaired PSB reopened again with the same external visual metrics after the
text-unit corrections; native save/reopen remained pixel-exact in all cases.

**0/3 complete workflow passes:** Luma's own import/edit previews still differ
from Photoshop. The PSB import RGB MAE remains 12.06; the PSD import alpha MAE
remains 1.704. These results must not be presented as full interoperability.
The pilot remains 512px-long-edge, headless Luma, not full-resolution or
installed-app qualification. Timing/RAM are not a Photoshop performance claim.

Headless WebKit 26.5 was also tested with the actual engine modules, isolated
browser contexts and loopback-only fixture delivery, using
`docs/release/check-webkit-import.mjs`. Evidence:
`artifacts/webkit-import-eJB2ZT/report.json`. All three preview comparisons
remain failed; the PSB RGB MAE is 9.897. This rules out treating the remaining
appearance issue as solely a Node canvas mismatch. It does not substitute for
installed Tauri qualification. WebKit could load Helvetica-Light and
MonsieurLaDoulaise-Regular via local FontFace requests; CanelaText-Regular was
unavailable through that API. Font loading alone is not render fidelity.
In a follow-up probe, the purported loaded Monsieur face measured identically
to Times even after font readiness and a rendered frame. Do not use a successful
`FontFace.load()` as evidence that the requested face supplied the glyphs.

Final-source local checks: 1,170 engine tests, 12 native-bridge tests, 9 native
core tests, type checking and lint pass. Receipt:
`artifacts/local-hardening-report.json` (source unchanged).

The eight-project internal corpus now passes **8/8**, up from the retained 6/8
baseline. Seven cases stay layered; one source is composite-only. All measured
native and self-decoded Photoshop preview deltas are zero. The run completed on
an admitted host with unchanged source/manifest and original thresholds:
`artifacts/trust-pass3-corpus.json`. Isolated engine peak RSS is 624.6–2454.3 MiB.
The canonical corpus receipt now points to the same result; the prior stale
receipt is preserved at `artifacts/pre-pass3-corpus-report.json`. The release
checker still reports **4/10 gates**, not a production compatibility pass.
This is not a hard whole-process memory ceiling, an independent Photoshop pass,
a 50-project corpus, RAW qualification or a matched performance comparison.
Desktop and web production builds pass. Existing large-chunk, ineffective
dynamic-import and HarfBuzz browser-externalization warnings remain. The desktop
bundle was built, not installed over the user's application.

## Stronger checks

Global visual tolerances are unchanged. New 32×32 local-error measurements
reject missing local content that a full-page average could hide. Maximum tile
RGB/alpha MAE limits are 15/8 byte levels. This is additional sensitivity, not
a substitute for visual review, mask-plane comparison or full-resolution checks.
An unavailable Photoshop profile name is recorded explicitly and cannot qualify
color fidelity. Reference errors now identify the stage that failed.

## Still open

- Remaining imported-font resolution and rendering discrepancies (basic
  automatic-leading and horizontal-scale unit defects are repaired).
- Full-resolution/mask-plane/text-run/linked-object external comparisons.
- Broader independent corpus, high-depth and print qualification.
- Installed-app memory/long-session qualification and RC2 infrastructure gates.

Overall professional-replacement assessment remains approximately 6.5/10.
The reopened file is much safer; the complete product is not yet qualified.

## Next campaign and external prerequisites

1. Qualify actual font identity and glyph rendering in installed WKWebView,
   including unavailable-font behavior; do not hide discrepancies with snapshots
   or assume a headless WebKit receipt qualifies the installed application.
2. Compare full-resolution regions, text styles and mask planes, then expand the
   independently rendered project corpus beyond these three pilots/eight
   internal files. Representative licensed camera/RAW and high-depth/print
   projects are still needed.
3. Repeat long-session and memory-pressure tests on the actual app process tree.
4. Complete production distribution only with the chosen Developer ID identity,
   notarization credentials, updater key/HTTPS endpoint, crash collector and
   independent clean test machines. None was invented or marked complete.

No user original was saved, no live app was replaced, and no release, commit,
push or remote upload was performed. The temporary diagnostic Vite server is
separate from the user's existing preview.
It was stopped after diagnostics; the user's preview was left untouched.
