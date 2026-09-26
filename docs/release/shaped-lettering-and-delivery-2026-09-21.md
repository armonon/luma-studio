# Shaped lettering, vector delivery and sparse-render hardening

Status: implemented increment; **not completion of the entire professional-creator roadmap**.

Follow-up: [Editable 3D objects and archive hardening](editable-3d-objects-2026-09-21.md) adds source-backed 3D lettering objects and updates the validation record. The boundaries below describe the earlier increment.

## Implemented

- Pinned HarfBuzz 1.6.2, shipped locally with its WASM and license notices. Production shaping runs in disposable workers, with two concurrent jobs, no queue, cancellation, and an eight-second timeout. No third-party font requests.
- Shared positioned glyph outlines for 3D lettering and Create outlines: kerning, ligatures, combining marks, feature flags, cluster-aware tracking, alignment, baseline shifts, selected bundled faces and stretch.
- Create outlines in the existing contextual Type panel through a shared command. It inserts editable compound contours at the original stack position, retains the hidden source text, copies transform/opacity, and commits one undo operation. Stale asynchronous results and unsupported appearance/masks/blending are rejected without changing the source.
- Actual 3D glyph meshes now use the shared shaper. Rotation/material updates reuse geometry. Superseded shaping jobs are cancelled, exports reject stale geometry, and GLB metadata takes the current editable source.
- New point, vertical, path and paragraph text selects its own layer instead of leaving the previous layer selected.
- Vector PDF preserves independent paint opacity and isolated layer opacity. Layer opacity is applied once after its appearance stack, not once per overlapping paint. Independent Poppler raster tests check both transparency and compound holes.
- Native development, production and generated release CSP permits bundled WASM compilation without permitting JavaScript `eval`.
- Sparse rendering traverses tile identities without cloning master pixel buffers, and culls offscreen tiles before preview conversion. PNG export uses minimal padding for plain artwork and bypasses composition for provably empty sparse raster documents; styled/filtered documents retain the previous conservative padding.

## Explicit boundaries

| Area | Current boundary |
| --- | --- |
| Typography | Outlined lettering supports bundled fonts, single-style left-to-right point text, at most 160 UTF-16 code units / 12,000 outline commands. Editable vector output also has the existing 4,096-anchor / 256-contour ceiling. It is not full paragraph shaping, Bidi, script segmentation or font fallback. Ordinary Canvas text still uses a different layout path. |
| 3D | Preview, shaped extrusion, material/camera controls and geometry export work. The document canvas still has a lightweight 2D spatial preview; inserting a render still adds a raster layer. No new authoritative live-3D document layer or verified live Form Studio round trip is claimed. |
| PDF | Solid RGB vector output with transparency, not editable PDF import. No PDF/X, CMYK/spot/overprint certification or independent press validation. |
| SVG | Existing strict editable subset remains; unsupported content is refused, not silently flattened. |
| Performance | The blank 17,000 × 4,000 export regression improved from 395,994 ms to 15,140 ms in the focused run and 32,127 ms in the final concurrent full suite. Machine load was not controlled, so this is targeted regression evidence, not an Affinity comparison or a general speed multiplier. |
| Affinity | No competitor measurements were invented. A matched application/version, representative project corpus and controlled runs are still needed. |
| Distribution | Source and frontend builds are updated. This pass does not install a new signed/notarized macOS application or certify a release. |

## Validation record

- Final full suite: **816/816 passed**, zero skipped. TypeScript, focused ESLint, desktop production build and web production build all passed. Build warnings about large chunks and the shaper's unreachable Node-only `module` import remain.

- Targeted shaping/mesh tests cover every bundled family, ligature and kerning toggles, composed/decomposed accents, counters, alignment, missing glyphs, malformed fonts, limits, worker cancellation/concurrency, undo/redo, retained source and `.luma` round trips.
- Vector workflows: 20/20 passed, including independent Poppler transparency and hole rendering.
- Sparse rendering / large-document export: 16/16 passed, including projected tile visibility, no master-buffer cloning, streamed artboard offsets and transparent padding.
- Production browser: Create outlines produced six contours / 142 anchors for “office”; keyboard undo restored the original text layer. Development cold-worker timeout was also observed and safely left the document unchanged.
- Final production browser: the actual 3D workspace generated a Lato Bold mesh (7,216 triangles); the Gold preset and arrow-key rotation worked, and undo restored the prior rotation. Newly placed text selected its own layer. Layout smoke checks used 1440×900, 1920×1080 and 1280×800 overrides; the widest screenshot was clipped by the capture surface, so this is not a complete screenshot-baseline comparison.
- Keyboard activation of Create outlines also produced the expected six contours / 142 anchors. Temporary viewport overrides were reset after testing.
- Replacing build assets while a QA tab was open caused a stale lazy-chunk fetch failure; reloading recovered the workspace. The final static build passed, but missing-asset error-boundary resilience remains a release-hardening gap. Development dependency reoptimization also required a reload after an invalid-hook error; no user document was intentionally modified during these tests.
- Builds emit the 433.76 kB HarfBuzz WASM as a separate lazy asset. Existing large-chunk warnings remain.
- Dependency audit reports 20 findings (6 moderate, 13 high, 1 critical), unchanged by adding HarfBuzz. These are unresolved; no blanket forced dependency upgrade was applied.

## Remaining completion work

1. Shared paragraph layout/shaping across Canvas, outlines and export, with Bidi/script/fallback and variable-font reference fixtures.
2. A bounded PDF graphics/text importer and a real-world fidelity corpus.
3. Authoritative live 3D document assets with demand-driven rendering, cache invalidation, bounded history, save/reopen and verified Form round trips.
4. Print pipeline implementation plus independent PDF/X/ICC/overprint validation.
5. Controlled illustration, poster, photo-composite and large-document comparisons against the chosen Affinity edition.

The shell skill kept the work inside existing contextual panels and shared commands. No docking or workspace architecture was replaced, and no shell-wide visual-regression pass is implied by the focused UI checks.
