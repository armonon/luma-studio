# Pass 10 — ordinary grouped vector delivery

## Completed

- Added one shared, bounded SVG/PDF delivery plan and object-specific preflight. It validates layer hierarchy, dimensions, color/depth, geometry, paints, transform/opacity, masks, clipping and resource budgets before writing.
- Replaced flat SVG traversal with nested groups, correct paint order, group/fill opacity and document-space vector masks. Masks stay geometry rather than bitmap traces.
- PDF now uses nested transparency Form XObjects and geometric clipping; group opacity is applied once after children compose.
- Supports clipping to a single opaque, unmasked solid-vector base, including transformed compound paths. General soft-alpha/multi-member clipping still blocks explicitly.
- Added a real preflight dialog before SVG/PDF delivery, with affected-object paths, A/B/C classification, suggested conversion and editability impact. Users can return to the affected object. No conversion is performed automatically.
- Preflight captures document ownership/revision; switching tabs, editing or undoing invalidates approval before export.
- Preserved existing vector-construction restrictions and save/recovery behavior. This is not a shell redesign or a relaxation of import limits.

## Professional job affected

Brand campaign (B) and vector illustration (C): ordinary grouped shapes, opacity, holes and vector masks no longer require ungrouping or flattening for supported SVG/PDF delivery. These are enabling changes; neither complete professional acceptance job is certified.

## Root cause

The previous exporter treated layers as a flat list and rejected `parentId` and all masks. PDF reused the flat SVG gate. Merely removing those errors would lose hierarchy, mask placement and group opacity. The new plan builds a validated tree and the writers explicitly preserve supported composition semantics.

## Automated and UI evidence

- Twelve new regression cases cover nested groups/order, masks, clipping, selected ancestors, hidden unsupported content, hierarchy cycles/orphans/empty parents/duplicates/depth, generated-ID collisions, aggregate budget admission, large sparse SVG geometry, project save/reopen, unchanged document state and stale preflight.
- Existing vector workflows and adjacent ownership tests were rerun, including independent SVG rasterization and Poppler PDF checks.
- `artifacts/vector-delivery-ui-xoeLgf/report.json`: final-source isolated persistent WebKit, actual export controls and SVG/PDF downloads, three viewport sizes, focus containment, Escape, stale revision rejection and blocked-object navigation. Zero page errors. This is not native macOS save-dialog evidence.
- First UI attempt, `artifacts/vector-delivery-ui-dpRX6T/report.json`, is retained as failed. The harness created its fixture before asynchronous sample startup completed; waiting for startup content corrected the harness. No production safeguard was relaxed.

## Real workflow validation

Synthetic grouped/masked document → native project serialization → decode → SVG byte equality; studio export does not mutate dirty state/history. Browser shell → grouped design → export menu → preflight → downloaded SVG/PDF. Real professional files, external editing and native installed-app execution of these new paths remain unqualified.

## Independent comparison

SVG is rasterized by the canvas package's SVG renderer; PDFs by Poppler, not Luma's importer. Full 160×160 comparisons supplement seven interior/outside/hole probes. Initial Poppler measurements:

| Fixture | RGBA mean absolute delta | Alpha mean delta | Pixels with channel delta >8 | Worst channel delta |
|---|---:|---:|---:|---:|
| Nested groups + masks | 0.147559 | 0 | 1.22266% | 102 |
| Opaque vector clipping | 0.217168 | 0 | 0.93359% | 74 |

Tolerance is explicitly 1.5 mean RGBA delta, 1 alpha delta and at most 2% changed pixels; interior probes allow ±2. Worst edge deltas are reported, not hidden behind PASS. PDF comparisons use a white backdrop, so alpha=0 difference does **not** independently prove PDF transparency. SVG checks compare transparent output separately. PDFs and PNGs under `artifacts/vector-delivery-pass10/` were visually inspected. Synthetic fixtures are not Photoshop/Affinity qualification or print certification.

## Performance

The delivery plan and mask geometry allocate no document-sized pixel surfaces. A 50K grouped SVG regression stays below 5 KB. Layer budget remains 1,024; geometry budgets remain 100,000 SVG / 10,000 PDF anchors, including masks; maximum nesting is 32. This does not establish a hard process-memory ceiling or measured native painting/viewport performance. No competitor speed claim is made.

`artifacts/grouped-svg-performance-HfCmEB/report.json`: Apple M3, Node 22.23.2; 100 paths in a group, 400 anchors, 3 warmups + 20 runs at each of 4K/8K/16K/32K/50K. The 50K export measured p50 **0.856 ms**, p95 **1.081 ms**, worst **1.213 ms**, output **49,783 bytes**. RSS sampled between runs reached about **152.1 MiB** for the Node harness; this is not an actual peak or native app/GPU measurement. No before/after speedup is claimed. Canvas dimensions did not cause pixel-buffer growth in this geometry-only task.

## Regressions / final qualification

Final source: `9bcf6332fde64ed9fccacbdf6d1a3e565ae1e1fbf06e26829d4fd0dbcd2b008c`.

- `artifacts/local-hardening-report.json`: unchanged source; **1,249 engine tests**, **28 native bridge tests**, **9 native core tests**, types and lint pass. One existing unused `activePreset` warning remains; zero lint errors.
- `artifacts/shell-matrix-gVyzKZ/report.json`: **21 existing screenshot comparisons pass**, with workspace interactions and recovery/reload checks. References were not replaced or relaxed.
- The first full-suite failure was an existing assertion expecting direct `exportVectorDocument(format)` dispatch. It was updated to require preflight, revision checks before/after export, error-boundary coverage, native command exclusion and paused native-open queue while the dialog is active. The failed receipt/log are preserved under `artifacts/vector-preflight-first-regression-RKMDrm/`.
- `artifacts/vector-delivery-desktop-build.json`: desktop frontend production bundle passes at the same unchanged source hash. Large-chunk and mixed static/dynamic-import warnings remain; no bundle-speed improvement is claimed.
- Native packaging has not been rebuilt/installed for this pass; the prior installed review app is still the earlier artifact. The frontend bundle is not distribution qualification.

## Updated score

No numerical increase. The prior approximate 6.5/10 assessment remains provisional. See `delivery-confidence-roadmap.md` for the live acceptance gaps.

## Gap to 10

Pixel/soft masks; general alpha clipping; localized raster effects; explicit text conversion and faithful typography; richer vector paints; editable SVG/PDF reimport; current external PSD/PSB evidence; five real projects; sustained tablet/native-memory campaigns; production notarization/updater/crash/clean-machine evidence. The full brief remains in progress, not complete.
