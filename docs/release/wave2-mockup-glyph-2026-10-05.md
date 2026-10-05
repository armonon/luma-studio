# Wave 2 alpha: Mockups and Glyph font maker (2026-10-05)

Both tools are **alpha**. They are reachable from the studio's `…` menu
(More application actions), the tool library's command search, and the
desktop **File** menu (`Mockups…`, `Glyph Font Maker…`). Both open as
full-screen dialogs and do not modify the open document unless asked to
(“Open as document”, “Add text layer”).

## Mockups

Places the current document (flattened via the normal PNG export path) or an
uploaded image onto six product scenes: T-shirt, hoodie, tote bag, framed
poster on a wall, 12-inch vinyl sleeve with record, and phone screen.

How it works (`app/engine/mockup.ts`, `app/engine/mockup-scenes.ts`):

- Each scene defines a print quad. Artwork is mapped through a projective
  homography (perspective), so the poster, sleeve and phone read in 3D.
- Garments carry a procedural height field (folds, seams, pocket, ribbing).
  It drives a displacement map, so lines in the art bend over folds, and a
  normal-based shading map, so folds and weave light the ink.
- Things in front of the print (hoodie drawstrings, tote handle, glass and
  screen glare) are a separate overlay composited after the art.
- Rendering runs in a Web Worker (`app/studio/mockup.worker.ts`) with a
  main-thread fallback; scenes are cached per size and colour.

Controls: fit inside / fill area, scale, rotation, offset (or drag on the
preview, scroll to scale), product/wall/backdrop/label colour, ink density for
fabrics, apply placement to all scenes. Export PNG or JPEG at 1200, 1600 or
2000 px: the current scene, all six as a ZIP, or the current scene opened as a
new Luma document.

Limits (honest):

- Scenes are stylised procedural renders, not photographs; they look like
  clean product illustrations rather than studio photography.
- Folds are hand-placed per scene, not physically simulated; very large art
  scales are clipped to the print area like a real printer would.
- Artwork is downsampled to at most 2048 px on its long edge before placing.
- No custom scene upload yet, no Form 3D objects as artwork yet.

### Asset sources and licences

| Asset | Source | Licence |
|---|---|---|
| All six scene base images (silhouettes, folds, fabric weave, plaster wall, oak floor/table, vinyl grooves, phone body, glare) | Generated at runtime by `app/engine/mockup-scenes.ts` + `app/engine/mockup-raster.ts` (written for Luma) | Luma's own code; no third-party imagery |
| ZIP packaging | `jszip` (existing dependency) | MIT (dual MIT / GPL-3.0; used under MIT) |

`armonon/photoboothstudio` was checked: its `Mockups.tsx` contains only
marketing illustrations (simple SVG shirts), not a garment compositor, and
the repository has no licence file. Nothing was copied from it.

## Glyph font maker

Draw-your-own-font editor for A–Z, a–z, 0–9 and basic punctuation
(`. , ; : ! ? ' " - ( ) & @ # / * + = % $ _ [ ]`).

- **Brush**: freehand strokes, converted to round-capped outlines with
  clipper-lib offsetting; pen pressure (Apple Pencil / stylus) tapers width.
- **Pen shape**: click points to build a filled polygon or smooth
  (Catmull–Rom) shape; **Cut** subtracts it to make counters/holes.
- **Erase** removes a stroke; undo/redo; copy strokes from another glyph.
- Metrics: ascender, cap height, x-height, baseline, descender guides;
  default and per-glyph advance width (drag the advance line, type it, or
  auto-fit). A faint reference letter can be shown for tracing.
- Live type preview of any text.
- Export **OTF** (CFF, via opentype.js) and **TTF** (glyf, small writer in
  `app/engine/glyph-font.ts`). Both are verified by parsing with opentype.js,
  shaping the TTF in HarfBuzz, and loading both through Chrome's font
  sanitizer.
- **Install in Luma**: stores the TTF in IndexedDB, registers it with
  `document.fonts`, lists it in Type & Vector → Typeface under
  “Yours · Glyph”, and reloads it automatically for documents that use it.
  **Add text layer** creates a text layer set in the font.
- Projects autosave in the browser and can be saved/opened as
  `.lumaglyph.json`.

Limits (honest):

- Outlines are straight-segment polygons (no curve fitting, no hinting), so
  files are larger than hand-built fonts and very large sizes can show facets.
- No kerning, ligatures, accented characters, bold/italic styles, or
  variable axes. Undrawn characters are omitted and fall back to the next
  family in the CSS stack.
- Installed fonts live in that browser profile only. They are not embedded
  in `.luma` projects or PSD exports; another machine shows the fallback.
- Mesh lettering, Create Outlines and other outline-based type features still
  require a bundled font (unchanged behaviour).

Libraries: `opentype.js` (MIT) and `clipper-lib` (Boost Software License 1.0),
both already dependencies. No new dependencies, no GPL code, no network or
paid APIs.

## Verification

- `tests/mockup.test.ts` (10) and `tests/glyph-font.test.ts` (13). Mutations
  checked: ignoring displacement, skipping the overlay, dropping TTF winding
  reversal, and the closed-stroke simplification fix each fail the suite.
- Headless Chrome smoke test: open both tools from the menu, drag placement,
  export all mockups as a ZIP of six JPEGs, draw glyphs with brush and pen
  (including a cut), export OTF/TTF, install, add a text layer, reload and see
  the font restored from IndexedDB, with no page errors.
