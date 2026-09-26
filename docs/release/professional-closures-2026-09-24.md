# Professional workflow completion campaign — 2026-09-24

This is a bounded implementation milestone, **not closure of Photoshop parity**.

## Follow-up: Photoshop channel and Smart Object interchange

- Saved alpha channels now export/reimport through RGB8/16/32 PSD and PSB, with Unicode names and separate transparency. The import adapter corrects an upstream saved-alpha-versus-composite-transparency mistake on Luma's image-data path. Alpha remains 8-bit editable data; high-depth containers do not add mask precision.
- Named-alpha interchange admits at most 52 channels and 32 MiB of conservative native sample storage. Raw and PackBits composites are supported; unsupported encodings remain source-preserved with a warning. Spot/display metadata is not a native spot-ink editing model.
- Guarded desktop exports embed native Smart Object contents as layered PSBs, including newly converted raster objects. Affine placement and contained source dimensions are recorded explicitly. Child compatibility warnings propagate to the parent approval dialog.
- Edit Smart Contents now opens a bounded subset of imported embedded PSD/PSB objects. Apply stores the edited source transactionally; parent undo/redo and native save/reopen retain it; subsequent desktop PSD export replaces the placed source with the edited layered PSB.
- Imported editing is restricted to single-instance RGB8 raster objects with axis-aligned integer placement, no custom warp/filter/animation/crop/comp, no external link, and no nested Smart Objects. Profiled embedded files fail safely rather than assuming their samples are sRGB. Native source preparation remains bounded to 4 MP, 128 layers, 32 MiB per object and 128 MiB aggregate embedded output (maximum 32 objects).
- Embedded source edits invalidate original-source passthrough even if the flattened appearance is unchanged. The synchronous low-level writer refuses edited imported sources that have not passed asynchronous preparation; it cannot silently re-emit their stale original payload.
- The guarded export pipeline now writes clean merged previews for supported 8-bit documents up to 4 MP. Paths without a merged preview explicitly warn that composite-only readers may display an empty image. High-depth native composites retain their separately validated path.
- Browser round-trip verification caught a Display P3/sRGB mix-up that the Node canvas harness did not expose: clean rendering requested a monitor-oriented P3 canvas, but PSD/print consumers treated readback samples as sRGB. Full-frame and tiled clean rendering now explicitly request sRGB and reject an already-P3 target rather than mislabel its samples. Display canvases retain their wide-gamut path.
- Menu labels/availability use the existing command route, following the application-shell skill. No unrelated workspace redesign was made.

These are additional implemented subsets, not unrestricted Adobe Smart Object or channel parity. The bounds below are revised accordingly; print certification and general CMYK/high-depth editing remain open.

Follow-up browser evidence: rebuilt desktop shell → import PSD → Edit Smart Contents → add layer → Apply → export PSD. The downloaded file was decoded independently: all three child layers survived, and the parent and embedded composite samples exactly matched the source `[34, 153, 102, 255]`. The pre-fix output was `[75, 151, 106, 255]`, demonstrating why Node-only tests were insufficient. No uncaught browser errors occurred. Print UI malformed-profile, conversion failure, retry and save checks also pass with the mocked native bridge; these are not live WKWebView/press tests.

Final follow-up qualification: **1,080 engine tests, 12 native bridge tests, 9 native core tests, TypeScript and lint pass**, with the source unchanged throughout the final run. Desktop and web production builds and all 4 rendered-route tests pass. The final downloaded UI output was checked over the entire image (not just one sample): parent and embedded merged pixels exactly equal the input, while the embedded layer count increased from two to three. Existing bundle-size/dynamic-import warnings remain; these are not a claim of performance parity. This pass does not install or replace the user's Mac application.

## Delivered

- Named sparse alpha channels: save/load, replace, rename, delete, invert, selection combine modes and two-channel calculations with opacity. Independent surfaces, undo/redo, crop/resize, document ownership and native project persistence. Central commands and the Channels panel share execution routes.
- Native Smart Object contents: independent editable document tab, transactional Apply Contents to Parent, embedded editable `.luma` source, parent undo/redo and save/reopen. Changed or closed parents reject stale results. Contents tabs remain open and retain normal dirty-document protection.
- Layered native RGB16/RGB32 PSD/PSB writing for bounded normal-blend raster stacks. Separate layer alpha, opacity, translation and sparse raster masks survive export/reimport. 32-bit HDR values remain unclamped. The importer now detects layer tables in Lr16/Lr32 blocks instead of incorrectly treating those files as flattened.
- Saved channel changes invalidate byte-for-byte original-source export, preventing stale source output.
- Desktop ICC CMYK print PDF: statically bundled LittleCMS, printer profile selection, rendering intent, black-point compensation, white-paper flattening, exact output profile embedded in both image color space and output intent, explicit trim/bleed boxes. No generic CMYK fallback on conversion failure. One native conversion at a time, bounded binary IPC and profile validation.
- Project format 12 preserves channels and embedded native Smart Object source. It reads earlier formats 1–11; older application builds cannot open format 12.

## Deliberate bounds and remaining work

| Area | Current boundary | Still required |
| --- | --- | --- |
| Channels | 64 named 8-bit sparse alpha surfaces in `.luma`; bounded named RGB PSD/PSB alpha interchange | Spot plates, direct channel painting, ZIP-compressed alpha import, cross-document Apply Image, perspective/straighten of saved channels |
| Smart Objects | Native layered PSB export and simple single-instance embedded Photoshop contents editing; RGB8, 4 MP, 32 MiB per source | General linked/shared/warped/profiled/nested/large/high-depth contents and complete descriptor/filter fidelity |
| High-depth PSD | sRGB primaries, ≤128 raster layers, ≤8 MP and ≤384 MiB estimated writer memory; integer translation and normal blending; opaque unmasked bottom layer | General groups/adjustments/effects/blend modes/resampling, transparent composites, native CMYK/Lab masters and broader color profiles |
| CMYK PDF | Desktop only, RGB8 sRGB input ≤4 MP, CMYK printer ICC ≤4 MiB, one flattened 8-bit image | Editable CMYK documents, vector/text separations, spot inks, overprint, ink-limit checks, high-depth CMYK delivery |
| Print qualification | Profile-aware preparation and structural checks | Chosen printer/output condition, required PDF/X version, independent preflight, color-chart reference measurements and printer/RIP proof approval |
| Photoshop parity | No matched quality/performance acceptance result asserted | Controlled matched projects in Photoshop, fidelity comparisons and repeatable latency/RAM measurements |

The trim setting is an **inset into existing artwork**, not generated bleed. The source document is not converted or modified. A PDF output intent alone does not certify PDF/X conformance.

## Evidence

- Focused channel, Smart Object and high-depth round-trip tests, including malformed input, stale targets, transaction failure and extreme sparse dimensions.
- Headless desktop-shell interaction: channel save/load, inversion, calculations, keyboard undo/redo, and Smart Object convert → edit contents → add layer → apply to parent. No uncaught page errors. Channels inspected at 1280×800, 1440×900 and 1920×1080.
- Native LittleCMS test uses the macOS Generic CMYK profile to convert white, black and red; malformed and oversized input tests reject before conversion. This is a smoke check, not color certification.
- PDF reopen checks verify exact CMYK samples, embedded ICC bytes, page dimensions and page boxes. A four-quadrant CMYK sample with a real profile was rendered with Poppler and inspected for channel order/orientation and layout.
- Rebuilt print-dialog browser check covers malformed profiles, intent/BPC controls, conversion failure, retry and PDF save through a mocked native IPC bridge. It verifies UI wiring, not live macOS IPC or press accuracy. Profile ownership and document-switch rejection are engine regressions.
- Baseline qualification before the interchange follow-up: **1,063 engine tests, 12 native bridge tests, 9 native core tests, TypeScript and lint pass**, with an unchanged source fingerprint. Desktop production build, web production build and 4 rendered-route tests also pass. Browser checks pass without uncaught page errors. The latest qualification run supersedes this baseline in `artifacts/local-hardening-report.json` and qualification logs. Native app installation and native interactive print-dialog verification are separate from these checks.

Implementation references: [Adobe Photoshop file-format specification](https://www.adobe.com/devnet-apps/photoshop/fileformatashtml/), [LittleCMS Rust transform API](https://docs.rs/lcms2/latest/lcms2/struct.Transform.html), [static LittleCMS linkage](https://github.com/kornelski/rust-lcms2-sys). These document formats/APIs, not professional qualification of Luma's outputs.
