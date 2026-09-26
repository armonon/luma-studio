# Professional trust — exact imported fonts in native WebKit

## Completed / root cause

WebKit reported a locally requested PostScript font as loaded, yet rendered
MonsieurLaDoulaise-Regular with Times glyphs. CoreText and Chromium could resolve
the installed face. A successful `FontFace.load()` was therefore insufficient
evidence of font identity.

The macOS bridge now resolves the exact PostScript face, rejects CoreText's
silent fallback, reconstructs a checked SFNT from that face's tables, and sends
it directly to the local webview as binary data. It exposes no arbitrary path
reader. Font bytes are not added to Luma projects or delivery exports.

The loader admits one native request at a time, at most 16 MiB per face, 64 faces
and 64 MiB of admitted font data per session. It checks restricted outline
permissions and refuses unqualified variable-face reconstruction. Browser font
validation remains required. These are bounded font-data limits, NOT a measured
ceiling on CoreText, browser, GPU or total application memory.

Duplicate requests share a promise. Failures release admission without starving
later faces. A delivery wait times out after 15 seconds without releasing the
still-running request's admission or starting a second copy. Text-bound and GPU
cache signatures advance when an exact face becomes ready. CPU preview caches
are invalidated without misclassifying font readiness as a document edit.

Missing fonts block newly rendered delivery assets. Native project Save and
explicit untouched-source Photoshop export remain available. The existing
notification surface reports viewport font failures for the active document;
export errors explain the affected font and replacement requirement. This is
not yet a complete persistent missing-font management panel.

## Validation / external fidelity

The native Rust tests check font checksums, malformed/restricted input and
missing-face rejection. Frontend regression tests cover deduplication,
serialization, browser rejection, retry, invalid responses, count and byte
admission, timeouts, cache revisions, native save, source preservation and edit
guards. A first fixture omitted the required legacy canvas font field; that
fixture was corrected rather than weakening production validation.

The first broad run passed 1,178 engine tests, 14 native-bridge tests, 9 native
core tests, types and lint. It is not the final-source receipt: review during
that run found a blend-stack rendering copy could lose the original layer's
font metadata. Font preparation now occurs before that copy is made, with an
additional viewport regression covering multi-pass text. A source-stable broad
repeat was required after that wiring fix.

The repeat now passes: **1,178 engine tests, 14 native-bridge tests, 9 native-core
tests, type checking and lint**, with `unchanged: true` in
`artifacts/local-hardening-report.json`. Qualified source:
`8e399f604f9068bea9cb670caa16dbf086edc522d29a5f63193674946fbcc4dc`.

The actual CoreText extractor produced a script face whose “Limelight” advance
at 150px measured 512.25px in WebKit and 512.24994px in Chromium. WebKit's prior
local-font path measured 591.57715px, identical to Times. This confirms the
specific substitution repair, not general typography parity.
The same binary-font probe also passes under the exact production Content
Security Policy (`artifacts/native-font-regions-akumwN/production-csp.json`);
no security policy relaxation was needed.

Diagnostic receipt: `artifacts/native-font-preview-lnHNMj/report.json`.
Actual engine modules ran in headless WebKit 26.5, using the real Rust/CoreText
extractor and simulated IPC transport. References were retained Photoshop
27.10.0 originals, with source-file and reference-image hashes recorded. This
does NOT qualify installed Tauri, new external export, full-resolution rendering
or color-managed print delivery.

| Independent preview | Result | Remaining difference |
| --- | --- | --- |
| private-ndw | Fail | Alpha MAE 2.7205; worst local alpha MAE 31.9922 |
| private-sattari-music-psb | Pass at existing preview tolerances | RGB MAE 1.7919; worst local RGB MAE 14.1064 |
| private-flme-psb | Fail | RGB MAE 5.9476; CanelaText-Regular unavailable |

No thresholds changed. These are **1/3 preview passes**, not 1/3 complete
professional-workflow passes. The retained full external workflow pilot remains
unqualified. The diagnostic was source-stable; a subsequent test-only type
access correction means its source hash is not the final qualification hash.

Follow-up at native resolution: `artifacts/native-font-regions-akumwN/report.json`
compares two selected regions to fresh Photoshop-rendered, merged-then-cropped
references without downsampling. The 768×768 headline region passes existing
tolerances (alpha MAE 0.7909; worst local alpha 7.6289). The 768×400 smaller-type
region still fails (alpha MAE 1.0375; worst local alpha 8.6152). One passing region
does not qualify the complete document. This separates part of the low-zoom
sampling discrepancy from the remaining native-resolution glyph differences.
The report uses current source and real CoreText extraction, but simulated IPC;
it remains distinct from installed-app evidence. Desktop production build passes.

## Performance

Admitted font data in these cases was 128,836, 82,912 and 378,324 bytes. Requests
were serial, and repeat faces reused the loaded resource. No timing/performance
parity claim: the workstation was also running unrelated native builds. No
whole-process memory ceiling or long-session font-cache qualification is claimed.

## Remaining blockers / score / next work

Overall professional-replacement assessment remains approximately **6.5/10**.
This repairs a concrete platform defect, not a category-wide qualification.

- Remaining glyph-shape/alpha and layout differences need independent comparison.
- CanelaText-Regular needs the user's licensed font; no substitute was installed.
- Full-resolution regions, paragraph/character styles and independent mask
  planes still need coverage beyond the three preview pilots.
- Native installed-app, broad PSD/PSB/RAW, print, tablet, long-session and clean
  machine gates remain open.
- A read-only Keychain inventory found a valid Developer ID Application
  identity. This removes the assumption that a signing certificate is missing;
  it is not itself evidence of a signed/notarized release. The notarization
  profile name, production updater and crash infrastructure remain prerequisites.
  No placeholders have been accepted as proof.

Continue with deeper typography/interchange comparisons, then the remaining
professional trust roadmap. No original project, installed application or
production deployment was overwritten by this pass.
