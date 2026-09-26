# Vector editing expansion — 2026-09-21

Follow-up: [shaped lettering and delivery](./shaped-lettering-and-delivery-2026-09-21.md) adds shared outline shaping and PDF paint/layer transparency. The observations below describe the earlier vector-editing checkpoint.

This is a bounded vector-editing milestone, **not completion of every requested professional-creator capability**. Existing typography and mesh-preview implementations were not replaced in this pass.

## Implemented and wired

| Capability | Implementation | Important boundary |
| --- | --- | --- |
| Offsets | Positive/negative distances, round/miter/square joins, retained source contours, parameter recalculation, expand, one-step undo, original layer retained hidden | Closed contours; ±1,000 local pixels; 512 source anchors; 8,192 flattened points; 4,096 result anchors. Cubics are flattened with a 0.25 px control-hull tolerance; integer coordinates use 1/1,024 px quantization. This is not an exact analytic Bézier offset. |
| Linked vector instances | Shared geometry and paints, independent transforms, editing from any instance, detach, undo/redo, project save/reopen | Path-only, document-local; no nested symbol library, per-instance paint overrides, or cross-document master links. Self-contained replicated geometry; 256 instances and a 16 MiB aggregate estimated-geometry limit per linked edit. |
| Appearance stacks | Up to 16 ordered fill/stroke paints, independent opacity, enabled state, widths, reordering/removal, undo, rendering, SVG delivery | Solid colors and centered round strokes; no pattern/gradient/brush/effect paints. PDF currently rejects paint transparency. PSD rejects stacks instead of silently writing a different appearance. |
| Editable SVG opening | Native file-picker extension and shared browser/native import route; paths, compound contours, rectangles, circles/ellipses, polygons, polylines, lines, affine transforms, inherited solid paints and fill rules | Explicit supported subset, not unrestricted SVG. Groups are flattened into independently editable paths. Exported stacks may reopen as separate paint paths. Symbol links and offset recipes require `.luma`. |

Both offset computation and SVG parsing run in disposable workers with five-second deadlines. These deadlines and input/geometry limits are **not an independently measured hard browser-process RAM ceiling**.

SVG limits: 2 MiB UTF-8, 4,096 visited elements, depth 32, 512 paths, 20,000 total anchors, 4,096 anchors per path, whole-pixel dimensions ≤50K (also subject to edition limits). XML errors, DTDs/entities, scripts, external references, CSS effects, embedded images, SVG text, nested viewports, non-opaque groups, unsupported paints/caps/joins, and open filled contours with area are rejected. Rejection occurs before installing a document; it does not import a misleading subset. Rounded rectangles and arbitrary physical units are not supported yet.

Path recipes, appearance, and instance links use project schema **v7**. Versions 1–6 remain readable. Older builds cannot read v7 projects; they must not silently discard new semantics. Save as `.luma` for continued editing.

## Evidence

- Full engine suite: **803/803 passed**, including the linked-memory and import-to-boolean regression additions. Targeted vector checks passed (30/30); the 11 editing tests were rerun successfully after switching new symbol identities to UUIDs to avoid process-counter collisions after reopening.
- TypeScript and focused ESLint passed; production desktop frontend build succeeded with lazy offset (~104 KB) and SVG import (~452 KB) worker bundles.
- Browser UI: offset creation produced a new path and hid/preserved the source; adding a stroke and setting its opacity worked; linked instance edits updated the original's displayed opacity; SVG file chooser opened `tests/fixtures/vector-editable.svg` as three editable layers; the compound ring retained its hole and the previous dirty document stayed open.
- Dependency re-optimization caused a development-only mixed-React/HMR error. Reload restored the QA workspace. This is not evidence of a packaged-app crash regression pass.
- No installed `.app` was replaced. The native dialog extension change is in Rust source; browser tests are not native binary tests.
- Manual browser inspections used 1440×900, 1280×800 and 1920×1080 viewports; temporary sizing was reset. Panel spacing and numeric-input identities were corrected during inspection. This is **not** a saved-baseline visual regression pass: capture scaling/cropping limits prevent treating these images as pixel-comparison evidence, and the full empty/text/floating/collapsed-state matrix was not run.
- The shared native read path now applies the SVG 2 MiB limit before allocating its response buffer, including OS open-by-path. Its targeted Rust regression **passed** (1/1), covering uppercase extensions and rejection of an oversized sparse file. An initial native compile raced a simultaneous frontend rebuild and failed on a replaced asset; the final frontend build and native test were run sequentially and both passed. Do not rebuild `dist-desktop` while Tauri is embedding its assets.

## Reproducible local baseline

Run `npx tsx build/benchmark-vector-workflows.ts`. This is CPU geometry and SVG serialization/parsing in Node, **not UI interaction latency or a competitor benchmark**. Each document holds the same 100 stars / 6,400 source anchors; increasing dimensions does not make its geometry denser.

| Document edge | Boolean median | Offset median | SVG export | SVG import | Cumulative process peak RSS |
| --- | ---: | ---: | ---: | ---: | ---: |
| 10K | 4.87 ms | 1.78 ms | 16.52 ms | 69.59 ms | 122.61 MiB |
| 25K | 3.22 ms | 0.63 ms | 11.94 ms | 55.84 ms | 128.69 MiB |
| 50K | 2.40 ms | 0.74 ms | 10.34 ms | 54.48 ms | 134.48 MiB |

Ten boolean and ten offset samples per size; later sizes benefit from warm-up. Peak RSS is cumulative for the process, not isolated operation memory. SVG files are ~1.40 MB and reopen as 200 fill/stroke paths. These numbers establish no Affinity advantage.

## Still unfinished from the request

1. **Professional shaping:** one shared shaping/layout pipeline for canvas, text outlines, PDF, SVG and mesh generation; complex-script/Bidi/fallback/variation tests against reference fonts. Existing browser text and the restricted mesh text path are not equivalent to this.
2. **Editable PDF import:** bounded PDF graphics/text interpreter, page selection, clipping/transparency/font handling and fidelity corpus. `pdf-lib` export is not an editable PDF importer.
3. **Live 3D document layers:** authoritative geometry/material/camera assets, demand-driven rendering, history/cache invalidation, persistence and verified Form Studio round trips. Current editable source metadata plus mesh preview/PNG insertion is not a live document renderer.
4. **Certified print:** actual output-intent/ICC conversion, PDF/X/overprint/spot/bleed behavior and independent preflight/press validation. Current vector PDF is DeviceRGB, not PDF/X or CMYK-certified output.
5. **Matched Affinity benchmarks:** same licensed application builds, computer, display, power state, documents and operations; cold/warm repetitions, latency traces, isolated peak RAM and output-fidelity checks. No Affinity measurements were run here.
6. Broader symbols, appearance paints and unrestricted SVG capabilities remain incremental extensions, not completed professional parity.

## Matched-workflow acceptance protocol

Use identical fixtures in both products: logo with holes/offsets; poster with multilingual mixed fonts; 100-instance icon sheet; multi-fill/stroke illustration; and sparse 10K/25K/50K vector canvases. Add real licensed illustration files separately; synthetic fixtures do not replace a corpus.

Record application/build, OS, chip, RAM, display scale, file hash, dimensions, object/anchor count, effects, color settings and warm/cold state. Five warm-ups then twenty measured runs per operation: open, pan/zoom, select, transform, offset, update all instances, undo/redo, save/reopen, SVG/PDF export. Compare structural retention and rasterized output before accepting a faster result. Report median/p95/max, crashes, failures and isolated peak RSS; never compare Node geometry timings to another application's whole UI job. No competitor values should be filled with estimates.

## Dependency references

- [Paper.js path data](https://paperjs.org/reference/pathitem/) for SVG curve parsing.
- [Clipper JavaScript implementation](https://github.com/junmer/clipper-lib) and [Clipper offset documentation](https://www.angusj.com/delphi/clipper/documentation/Docs/Units/ClipperLib/Classes/ClipperOffset/Methods/Execute.htm). Union-normalization precedes polygon offsets.
- [xmldom](https://github.com/xmldom/xmldom), pinned 0.9.12; strict parser errors plus explicit import allowlists.

License notices are bundled in `public/licenses`. The dependency audit still reports 20 findings (6 moderate, 13 high, 1 critical); this pass does not claim to remediate the pre-existing audit set.
