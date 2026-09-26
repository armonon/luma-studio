# Designer Campaign workspace — 2026-09-24

This is a connected, bounded implementation across the seven designer-workflow directions. It is **not** a declaration that the entire designer/Photoshop-parity roadmap is complete.

## Entry points

Window → Campaign, command search → Campaign, or Command/Control–Option/Alt–K. Text/shape/path tools also expose Campaign from their contextual Space deck. The panel uses the existing registry and dock manager; the application-shell skill guided that integration rather than a parallel sidebar.

## Implemented behavior

### Group/mask and exact text-layout follow-up (current)

This supersedes the group/mask and estimated-text limitations in the historical follow-up below.

- Linked formats now copy complete nested components, including grouped/clipped raster, text, shapes and paths, sparse/legacy alpha masks and vector masks. Component ownership is stored in `.luma`; selecting both a group and a descendant does not duplicate the child.
- Explicit **Replace local content & appearance** reconciles added/deleted/reordered/reparented master children, preserves surviving copy identities, restores deleted copies, remaps masks and editable vector-mask construction recipes, and replaces local overrides. Default sync retains local appearances/masks and refuses membership changes until replacement is explicitly selected. Detaching a component member detaches its entire synchronization relationship.
- Groups use a single root-derived contain/anchor mapping. Children are document-space objects, not multiplicatively nested transforms. Resizing the master therefore transforms each descendant once. Raster alpha stays sparse; vector alpha is traced into bounded viewport frames rather than a document-sized bitmap. Group vector masks and their effects-hiding switches now render instead of being ignored.
- Auto-layout measures the **same text drawing path** as preview, after bundled fonts are ready. A bounded rendered-ink pass corrects WebKit's whitespace/overhang metric discrepancies. Arabic joining, Hebrew/bidi, mixed fonts, combining marks, ligatures, decorations, baselines, paragraph overrides/wrapping and vertical graphemes are exercised in real browsers. Paragraph spacing/indents and mixed-size leading are honored. Editable text remains text.
- Text ink measurement is limited to **2 Mi pixels / 16,384 pixels per edge**, at most 8 MiB of scratch RGBA plus 8 MiB of readback. The cache is bounded to 64 entries and 2 MiB of keys. Sparse mask remapping shares a **32 MiB per-command output budget**; component copies and history additionally pass the existing total known-memory admission. Oversized operations, lock conflicts, corruption, cancellation and document changes fail before publication.
- Complex synchronization is one transactional undo step; save/reopen retains both states. A delayed font load can be cancelled promptly and cannot write into another tab. A 15-second font-load timeout refuses layout safely.

Remaining scope boundaries: component sources exclude document-wide adjustment layers, RAW/embedded/source-backed content, root-level clipping and partial child selections; choose a complete parent group. Canvas expansion still refuses active selections and saved alpha channels. Saved row/column layouts arrange standalone objects, not group subtrees. Text bounds cover actual preview ink, not layer effects, depth shadows or universal cross-platform font equivalence. Very large text objects fail the explicit measurement budget rather than allocating a document-sized canvas. Print certification and installed-app/distribution qualification remain separate work.

### Completion follow-up (supersedes the initial limits below)

- **Full-document variants:** Campaign → Variants now captures archive-backed document states, including raster pixels, high-depth/sparse surfaces, masks, selections, geometry, editable text/3D and document settings. Deleted layers are restored. Apply, capture and delete participate in document-owned undo. Full variants survive Save/reopen and recovery, independently of history pruning. Original lightweight style variants remain available separately.
- **Bounded storage:** six full variants, 128 MiB of archived bytes total. Capture requires a conservative serialization working-set estimate of at most 128 MiB; capture/restore also use shared known-memory admission. Archives contain no nested variant collection or history. The ZIP writer enforces its output limit while streaming. Imported archives are bounded and decoded only when applied; corruption, changed documents, cancellation or undo-budget refusal prevents publication.
- **Saved layouts:** row/column recipes, wrap, start/center/end alignment, gap and inset are saved in the project. Reflow reapplies them after edits; explicit linked synchronization also reflows. Artboard resize applies origin constraints and saved layouts atomically, but must fit inside the existing canvas. Missing/locked layers, overflow and invalid recipes refuse without partial edits.
- **Explicit content replacement:** the default linked-format update still preserves independent appearances. Opting into “Replace local content & appearance” copies raster/vector/text/3D/effects and brand bindings from masters, then reflows. It deliberately overwrites local content and is undoable. Standalone layers only: groups, clipping, masks and embedded/source-backed content are refused rather than incorrectly remapped.
- **Print handoff:** Campaign → Deliver links to the existing native CMYK proof export using the printer's ICC profile. It exports the **whole document**, not a new per-artboard print pipeline. Proof PDFs remain explicitly uncertified; no PDF/X/printer approval is claimed.
- **Persistence fixes:** `.luma` version 14 stores full variants as deduplicated binary assets, not giant JSON byte arrays, including undo metadata. Version 13 and older supported projects remain readable; older applications cannot open version 14. Global-light settings now round-trip. Document/layer cloning retains Photoshop descriptor metadata and separately owns global-light settings.

Historical boundaries for this first follow-up are superseded by the group/mask and text-layout section above. Printer certification still requires the target printer, PDF/X standard, ICC profile, independent preflight and approved proof. Native installed-app/distribution qualification is separate from browser-hosted desktop-shell checks.

### Initial implementation (historical)

The follow-up validation is recorded at the end of this document. Statements below describing metadata-only variants or text-only synchronization refer to the initial implementation, not the opt-in full-variant/content-replacement routes above.

1. **Adaptive layouts:** six editable output formats (square, portrait, story, landscape, banner, poster), contain scaling, origin constraints, row/column arrangement with inset/gap, bounded column/row guide grids. Objects remain ordinary editable layers. Explicit Update linked text & layout propagates text content and transforms.
2. **Reusable brand system:** document-owned named colors and typography recipes, links to selected layers, local-override preservation, portable `.lumabrand` import/export. Imported kits receive fresh identities and do not overwrite existing links. Existing asset/symbol workflows remain separate.
3. **Color direction:** link text/vector colors and spatial-preview front/side materials; delegate raster pixels to the existing Recolor command. Homogeneous appearance stacks are supported. Mixed-color stacks refuse a single-color assignment rather than destroying the stack. Vector symbols must be detached before independent campaign color assignment.
4. **Typography:** reusable font, size, tracking, spacing, variable axes and OpenType settings. Character overrides remain editable. Type/appearance/3D opens the existing authoritative editor; no new shaping engine or 3D renderer is claimed.
5. **Design variants:** up to 12 named snapshots of layout, visibility, opacity, supported colors, typography, text content/runs/paragraphs and design-link baselines. Apply is atomic and undoable. This is not a pixel/geometry/mask snapshot or a complete document branch.
6. **Context and commands:** one transactional engine command route, central Window command and accelerator, contextual Space entry, lazy-loaded panel, existing docking/persistence. Fixed the tool-library shortcut handler swallowing modified Command-K shortcuts.
7. **Delivery:** preflight plus sequential, cancellable PNG artboards in a ZIP with JSON manifest and explicit limitations. Delivery requests 8-bit sRGB, excludes linked objects owned by other artboards, and frees temporary canvases. Keeps editable project saving separate.

## Initial safety and file format (historical)

- `.luma` version 13 persists campaign metadata and campaign undo history; older supported project versions remain readable. Old applications will not understand version 13.
- Metadata commands stage new ownership and publish only after validation. Locked layers and unfinished editing gestures refuse changes. History admission failure restores the original document.
- Color/style updates preserve local overrides rather than silently overwriting them.
- Export checks document ownership/history between asynchronous steps. Switching documents, editing during export, or cancellation prevents publishing a stale package.
- 64 colors, 64 type recipes, 1,024 design links, 12 variants and 2 MB serialized campaign metadata maximum. Portable kits are capped at 512 KB.
- 1–128 selected layers per layout command; 2,048-layer document command ceiling. Format raster copies capped at 128 MiB plus existing known-memory admission. Guide grids support 1–24 rows/columns and at most 256 total guides.
- Campaign packages: at most 12 artboards, 4 MP each, and available admitted memory. These are operation budgets, not a hard process-RAM ceiling.

## Initial limitations (historical; superseded above)

- Not a general auto-layout/reflow engine. Text/path placement bounds are estimates; inspect complex scripts, effects and projected 3D manually.
- Format expansion refuses existing selections, masks, alpha channels, grouped/clipped sources and embedded/source-backed inputs. Those require full document-space remapping before support is safe.
- Linked format updates do not propagate arbitrary raster/vector content edits. This is not a universal component or asset-library system.
- Raster Recolor remains separate from live brand tokens; mixed appearance paints need their existing editors.
- Variants do not retain every appearance, geometry or pixel change. Use project history/save for full document versions.
- Font resources are not embedded in brand kits. Existing shaping/export boundaries remain; this work does not certify every script/font.
- RGB PNG delivery is neither editable SVG/PDF delivery nor CMYK/PDF-X print certification.
- Native installation, signing/notarization, updater and clean-machine qualification are not part of this change.

## Initial verification (historical)

Focused campaign regressions cover linked text/vector/material colors, local overrides, atomic lock failure, shared typography, all six formats, save/reopen with structural undo, layout overflow, selection refusal, rich-text variants, corrupt metadata, appearance-stack refusal, pending gestures, guide deduplication/undo, portable kit identity, document isolation, injected commit failure, stale async export, cancellation, manifest and PNG pixels.

Browser checks exercise the production desktop bundle through command search, panel controls, shortcut close/reopen, float/resize/dock, layout persistence after reload, actual linked raster-format creation and ZIP download at 1280×800, 1440×900 and 1920×1080. This is browser-hosted desktop-shell evidence, not interaction with an installed signed macOS binary.

Full qualification results live in `artifacts/local-hardening-report.json`; inspect `unchanged` and each check result rather than relying on a historical test count. Inspected screenshots are retained in `artifacts/campaign-ui/`. Browser scripts and the actual delivery package from this run are under `/tmp/luma-campaign.lcMXZh` (temporary). Both desktop and web production builds passed; all four rendered-route checks passed. The actual text workflow also passed color linking, typography capture/link, portable brand-kit export/import, guide creation, and opening the contextual Space deck.

Final frozen-source run: **1,125 engine tests (including 14 campaign tests), 12 native bridge tests, 9 native core tests, type checking and lint passed; `unchanged: true`.** Source fingerprint: `6741ccd30059bf1e15214368881307db4c99863dd7a3844a1279c51730235cc6`. Lint retains one pre-existing warning in `print-export-dialog.tsx`; no new lint errors. No commit, push, release deployment, or replacement of the installed Mac application was performed.

## Completion follow-up verification

Final source fingerprint: `b8638a3d4ba4df20543e98812878ce0fe47c1e6b24bcac39327f0f27f6ddebdd`; `unchanged: true`.

- **1,133 engine tests passed**, including eight new completion regressions and the existing 14 campaign tests. Type checking, lint (one unchanged print-dialog warning), **12 native bridge tests and nine native core tests** passed.
- Desktop and web production builds passed; all four rendered-route checks passed. Existing bundle-size/dynamic-import warnings remain.
- Full variants: capture/apply/delete, deleted-layer restoration, independent pixels/masks/vector-mask clones/lighting, editable spatial text, undo/redo, Save/reopen, corrupt archive refusal, cancellation, document switching, injected commit failure, history-byte accounting and archive deduplication.
- A 50,000 × 50,000 sparse document retained its sparse selection and mask through capture/apply/undo/redo, with an archive under 1 MiB and no document-sized canvas. The web edition correctly refused restoring that size; the Pro edition accepted it. This is a sparse fixture, not a claim about dense 50K projects.
- Enlarged master content is admitted per target before any pixel clone. Inactive variant archives are charged for their bytes, not one unused Photoshop decoder workspace each.
- Browser-hosted desktop UI: two complete variants plus nine layers restored after a **confirmed IndexedDB checkpoint** and reload. Capture/apply/delete/undo, wrap/alignment/reflow/content replacement, float/resize/dock/close/shortcut, and screenshots at 1280×800, 1440×900 and 1920×1080 passed. The first automation attempt reloaded prematurely because its async wait was ineffective; the corrected test explicitly polls the completed stored checkpoint. A separate single-variant browser recovery test also passed.
- Reference images are in `artifacts/campaign-ui/full-variants-*.png`, `saved-layout-*.png` and `completion-floating.png`. Inspecting them showed no panel-width overflow. This is targeted coverage, not complete application-wide visual certification.

## Group/mask and exact text-layout verification

- Fourteen new engine regressions cover nested component identity/membership/order, clipping and pixel-equivalent group composites; sparse, legacy and vector masks; locked descendants; injected commit failure; restore/deletion/detach behavior; master resize without double-transforming children; editable offset-mask recipes; bounded 300K mask remapping; a vector-masked group in a 50K viewport; paragraph overrides; measured rich type; and oversize/cancel refusal. Existing campaign save/reopen/undo tests were updated to exercise supported masks rather than expect refusal.
- `docs/release/check-component-layout.mjs` runs the real desktop shell in **Chromium and WebKit 26.5**. Eight complex-text fixtures compare a full-canvas alpha scan with the bounded ink measurement; final measured boxes matched on both engines. Each fixture then exercises arrangement, undo/redo and save/reopen. A deliberately delayed font request tests prompt cancellation and stale-document protection. Panel screenshots at 1280×800, 1440×900 and 1920×1080 are in `artifacts/component-layout-ui/` and show no horizontal panel overflow.
- The browser test initially exposed WebKit's whitespace/overhang metric mismatch. The implementation was corrected with a bounded ink pass; the final test uses a one-pixel edge tolerance and actual nonzero alpha, not a relaxed font-metric comparison. The Node canvas backend's invalid RTL metrics are rejected; RTL evidence comes from real Chromium/WebKit, not that backend.
- `docs/release/check-campaign-ui.mjs` also passed against the rebuilt production desktop bundle: full variants, explicit synchronization, saved reflow, panel float/resize/dock/shortcut, and restoration after a confirmed IndexedDB recovery checkpoint. Its early tool-switch screenshot attempt correctly changed the contextual panel; the final script selects Move before opening Campaign.
- Desktop and web production builds passed, as did the four rendered-route tests. Existing bundle-size/dynamic-import warnings remain. These are source/build and browser-hosted shell checks, **not** qualification of an installed signed Mac application. The installed app was not replaced; no commit, push or deployment was performed.

Final qualification passed: **1,147 engine tests, 12 native bridge tests, nine native core tests, type checking and lint**; `unchanged: true`. Lint retains only the pre-existing print-dialog ref-cleanup warning. The authoritative frozen-source result is `artifacts/local-hardening-report.json`. Source for this follow-up: `280022ddd6c1ac620cb713a0bacca418b6197e14926a1142ae00f909e0fa3351`.

Reproduction: build the desktop bundle, serve its preview at port 4179, then run `node docs/release/check-campaign-ui.mjs`. Set `LUMA_PLAYWRIGHT_MODULE` to a configured Playwright ESM entry if it is not installed as `playwright`; `LUMA_UI_URL` can override the preview URL. The script creates an isolated browser context and writes screenshots to `/tmp/luma-campaign-check`; it does not change the user's open browser or installed Mac app. Reference screenshots should be reviewed before replacing them.

No commit, push, release deployment or installed-app replacement was performed. Printer/PDF-X/ICC requirements and independent print certification are still external blockers, not a green test gate.
