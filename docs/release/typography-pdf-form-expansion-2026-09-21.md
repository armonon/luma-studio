# Typography, PDF and Form — follow-up implementation

This extends the earlier qualification pass. It does **not** declare all professional
typography, editable PDF, arbitrary 3D scene interchange or print certification complete.

## Working additions

### Typography

The shared HarfBuzz outline/3D pipeline now handles mixed-style LTR **point text**:
up to 32 nonoverlapping style runs and four bundled font faces, with per-run size,
weight, stretch, tracking, features, variation settings and baseline shift. Positioning
and final line alignment use the composed run advances. Style boundaries cannot split
a Unicode grapheme. The total 160-character/12,000-command budget remains, and the
worker still has bounded concurrency and a deadline.

Single-style paragraph shaping remains available. Mixed-color/decorated outlines,
mixed-style frames and complex-script/Bidi stories are explicitly refused rather
than flattened incorrectly. Ordinary 2D canvas text still uses its existing renderer;
this is not a unified professional shaping engine for every output path.

### PDF

Open, Cmd+O, native Open and document drop share a page dialog with two clear choices:

- **Editable vector paths:** the existing strict solid-vector subset.
- **Rendered page (flattened):** PDF text, images and graphics become one RGB raster
  layer on white, at 72/150/300 ppi. Physical resolution is stored in the document.

Rendered-page admission is capped at 16 million output pixels and 8192 pixels per
edge, in addition to the 8 MiB source/64-page/12-second parser-operation limits.
Embedded images over four million pixels and annotations/forms are refused.
Parsing is worker-based; canvas rendering uses PDF.js's display path. Timeout/failure
cancels rendering and releases its canvas without installing a document.

PDF.js standard fonts, CMaps and decoder resources are bundled locally (about 4.1 MiB,
including their license files), not fetched from a third-party CDN. Regenerate with
`npm run pdf:vendor` from the pinned dependency. Large/hostile compressed input still
needs fuzz and measured process-memory qualification; these bounds are not a proven
hard process-RAM ceiling. Flattened import is not editable PDF text or image objects.

### Form

The existing contextual **3D & Form** panel now offers:

- **Export glyphs to Form Studio:** includes positioned HarfBuzz contours with the
  source text; Form builds real extruded letter geometry and holes, not a text box.
- **Export source only (proxy):** preserves the previous broader source-only workflow
  when the text is outside the glyph-outlining subset.

The portable outline contract is bounded and validates contour ordering, finite
coordinates, complexity and a source-layout key. Form stores the source/geometry in
its project workspace. Returned supported front/side materials and local rotation
are preserved. Changed child transforms or glyph geometry are refused for source
return instead of silently discarded. The existing native Save/backup path is retained.

This is source-driven glyph interchange, not arbitrary edited mesh import, placement,
camera/lighting exchange or live synchronization. Luma imports returned text into a
new document and regenerates outlines on subsequent glyph export; it does not insert
arbitrary Form scene geometry into the document.

### Print and benchmark validation

`npm run print:inspect -- file.pdf` now reports explicit page-box and output-profile
structural problems, with a source hash. It **always** reports `NOT_CERTIFIED` and
exits 2. Metadata-only output intents cannot satisfy even this structural check.
It does not test ink coverage, overprint, font embedding, output color accuracy or
PDF/X conformance. A printer-selected PDF/X specification, ICC target, independent
preflight and actual RIP/proof approval remain required. The
[GWG preflight programme](https://gwg.org/ghent-pdf-preflight-compliancy/) has a much
broader test corpus; this implementation has not passed that programme.

`npm run benchmark:compare -- luma.json affinity.json` checks recorded full-GUI
workflow samples and artifact hashes. It rejects mismatched fixtures/machines/display
settings, fewer than five measured runs, absent warmup/evidence and failed fidelity.
It reports per-stage medians and peak memory for the submitted fixture only. The
synthetic unit-test samples are not performance evidence. No matched Affinity result
exists yet; an installed/licensed edition and real measurements are still needed.

## Verification

- Luma full suite: **839/839 pass**, no skips or failures.
- Form bridge suite: **6/6 pass**, including real extrusion, project persistence,
  front/side materials and modified-geometry refusal.
- Actual cross-repository round trip: Luma shaped text → Form glyph extrusion →
  rotation change → Form return → editable Luma text → `.luma` save/reopen passes.
- Luma and Form TypeScript checks and desktop frontend builds pass.
- Focused source and integration lint pass. Luma's web production build also passes, including
  server rendering; the new PDF/geometry code does not pull Node-only graphics into SSR.
- Production browser: Cmd+O → generated text/image PDF → Rendered page → one new
  raster document at 150 ppi, visibly correct text and image, no console errors/warnings.
- Production browser: returned Form source opens as editable text; glyph export
  writes a fresh `.lumaformtext` download. Its validated contours also instantiate
  actual Form `ExtrudeGeometry`. The browser automation download event timed out,
  but the resulting file on disk was independently found and parsed.

Native window/save-dialog interaction is not reverified in this pass: macOS was
locked. Source and frontend bundles were updated; installed application bundles were
not replaced. No commit, push or deployment was performed.

The application-shell skill kept these controls in the existing contextual panel,
shared file-open workflow and save path rather than adding a separate workspace.
