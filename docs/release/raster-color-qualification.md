# Raster export color qualification

The 8-bit import/edit bitmap stores display-encoded sRGB samples. Its linear-light
`rgba8` tile derivative cannot retain all those samples: quantizing linear dark
values to 8 bits caused up to seven code values of PNG export drift. Full-size
8-bit bitmaps are now used by the CPU renderer and GPU raster upload selection.
High-depth surfaces and tile-only/proxy layers remain surface-authoritative.
Explicit conversion to 8-bit refreshes the full-size bitmap from the converted
master, including transparent missing tiles, before switching authority.
Neither the archive format nor precision tile encoding has changed.

## Automated regressions

- `npx tsx --test tests/raster-export-fidelity.test.ts tests/transform-coordinates.test.ts`
- `npm test`, `npx tsc --noEmit`, `npm run lint`

The targeted suite covers dark/full-range gradients, opaque/partial-alpha samples,
full and tiled rendering, repeated render, 16/32-bit sRGB/P3/linear masters,
8-bit tile-only/proxy layers and explicit 32→8 conversion with Undo/Redo.
The merged eyedropper now returns the actual fill color (`#39b86a`), not the
previous quantized `#38b86a`.

## Real local browser qualification

Use Node 22. Start `npm run desktop:dev -- --port 4187`, then in a second terminal:

```sh
LUMA_UI_URL=http://localhost:4187 \
LUMA_PLAYWRIGHT_MODULE=/absolute/path/to/existing/playwright-core/index.mjs \
LUMA_CHROMIUM_EXECUTABLE=/absolute/path/to/existing/chromium \
LUMA_COLOR_OUTPUT=/absolute/path/to/evidence \
npx tsx build/qualify-raster-color.mjs
```

The harness generates synthetic PNGs: the retained 2048×1536 gradient with
partial alpha, an opaque image containing a real synthetic matrix/TRC sRGB ICC
profile, and an image with transparent/partially transparent pixels. It uses
actual file inputs and downloads, repeats PNG export, saves a `.luma` archive,
confirms downloaded bytes, closes and reopens the document, then exports again.
It rejects non-local application URLs and blocks external requests.

Reference pixels come from an independent browser decode into an sRGB canvas;
PNG comparisons use the native canvas decoder. Fixed tolerance: maximum RGB
error **2** and maximum alpha error **0**. Fully transparent RGB is canonicalized
by canvas, not claimed preserved. Repeated/reopened exports must also be
pixel-identical to the first output. Reports retain source SHA, working-tree
status, diff/harness hashes, fixture/archive hashes, browser version and failures.

This is a CPU/browser regression gate, not native Tauri, every supported OS,
physical display calibration, arbitrary ICC support, GPU qualification or a
release/deployment approval. Required hosted CI and source/deployment provenance
remain separate release gates. Never treat unexecuted gates as passed.

## Browser save-confirmation regression

The save busy overlay previously remained above the required browser-download
confirmation, so a file could download while both confirmation buttons were
unclickable. The busy overlay now yields to that confirmation; the save remains
in flight and editor/reentrant-save guards stay enabled. The browser harness
requires actual pointer confirmation and keyboard navigation/cancel/retry—never
forced clicks or direct invocation of a confirmation callback.
