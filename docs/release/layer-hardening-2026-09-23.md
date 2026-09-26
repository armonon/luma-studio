# Layer-workflow hardening — September 23, 2026

This implements the immediate findings from `critical-review-layer-workflows-2026-09-23.md`. It is not a certification of every editor feature or of the installed macOS application.

## Changes

- Structural publication failures restore the original layer owners and property descriptors, topology, hierarchy revision, and memory bindings. Group, delete, duplicate, merge, visibility, and lock mutations no longer remain live after a failed pre-publication commit. Merge cleanup cannot shrink a still-installed output canvas after a failed publication.
- Reordering keeps compact order-only history and now restores its original order if publication fails.
- Ordinary merges composite through the tiled renderer, with renderer-derived destination, cache, scratch and group working-set admission. Filtered merges retain exact full-frame rendering and reserve its larger working set: the viewport's capped overscan is not safe for permanently baking arbitrary filters. These estimates cover known buffers, **not total process RSS**. The output bitmap is still dense and existing safe-canvas limits still apply.
- Row deletion uses the same hierarchy lock policy as bulk deletion. Legacy group/ungroup, reorder and transform entry points respect ancestor locks. Opacity/property previews also respect ancestor locks. Row deletion, reorder commands and opacity controls expose appropriate disabled states.
- Unsupported group transforms are explicitly unavailable in the engine and inspector. This prevents invisible edits/history entries; it does **not** implement hierarchical transformable groups.
- Group, ungroup, multi-layer duplicate, merge, visibility, lock and delete can record selection-aware Actions. Recipes store stack positions and layer types, validate these on replay, and record only after successful publication. Their editor explains this matching-structure requirement. They are not semantic/name-based selectors for arbitrary unrelated documents.
- Color/decoration-only text spans preserve a shared Canvas shaping run. Each paint span clips the same shaped string rather than reshaping Arabic fragments independently. Arabic and Latin regression tests compare against matching-color raster references. Canvas does not expose glyph-cluster caret boundaries: color boundaries within ligatures are approximate. This is **not** complete viewport/HarfBuzz/PDF typography unification, nor a fix for every mixed-font, path or vertical-script case.

## Validation

New regressions inject both commit and memory-binding failures for seven structural operations, verify owners/pixels/history/dirty state and successful retry/undo/redo, and cover lock policy, Actions serialization/replay, nested masked-group merging, filtered output equivalence, scratch allocation shape, and shared text-paint context.

Direct desktop-shell UI checks used a disposable 256×256 document on the local development build:

- Shift-range selection and toolbar Group created the expected hierarchy.
- Locking a group disabled deletion of both child rows. Undo/redo changed those disabled states correctly.
- The group inspector explained unsupported transforms and omitted numeric transform fields.
- Command-Shift-G ungrouped, Command-E merged, and Undo restored both layers.
- Dirty close opened Save/Don't Save/Cancel; Cancel preserved the document. Only the disposable QA document was discarded afterward.
- Layout screenshots were inspected at 1280×800, 1440×900 and 1920×1080. These are interactive smoke checks, **not** seven newly persisted golden references or a full visual-regression pass. One screenshot caught a transient development reload; subsequent UI state verified the populated panels. No installed-binary/native-dialog certification is claimed.

Final source-bound qualification and build results are recorded in `artifacts/local-hardening-report.json` and its referenced logs.

Final run: **977 TypeScript tests, 10 native bridge tests, 9 native core tests, types and lint passed**. `npm run desktop:build` and `git diff --check` also passed. The qualification report has `unchanged: true` and matches source SHA-256 `fcfbbaa48869c3b760190d7432c4d585d00a04d462d5bec0adab0612620b466f`. This replaces the intermediate run invalidated by edits during testing. The desktop build is the production frontend build, not a newly installed/notarized macOS bundle.

## Performance/compatibility evidence limitation

An eight-case diagnostic corpus run overlapped regression testing and source edits. Its first two cases passed; the third completed but exceeded the configured 120-second limit (133,005 ms); a fourth passed using its declared flattened fallback. The campaign was stopped during the fifth case after interactive browser commands began timing out. Do not treat this interrupted, contended run as a current-source 8/8 pass, an isolated performance measurement, or a changed release threshold. The standard corpus command still requires at least 50 projects and PSD, PSB and RAW coverage.

## Still open

1. An isolated process-RSS/latency campaign and sustained real editing sessions; known-allocation admission is not a hard process-memory ceiling.
2. Independent Photoshop references and an expanded real-project/camera corpus. The retained earlier eight-case report includes three flattened fallbacks and one composite-only case.
3. Full shared glyph-layout/export correctness, including complex mixed-style and path/vertical text.
4. The remaining persisted visual-regression states and complete installed-app interaction campaigns.
5. Production updater endpoint/key, interrupted-update evidence, Developer ID/notarization validation, remote crash delivery, and clean-machine qualification. These need real deployment/signing/machine evidence; local unit tests cannot substitute for it.

The local keychain does contain a Developer ID Application identity. The remaining signing claim is therefore **unvalidated distribution**, not "no signing certificate exists." Production endpoints/public key and the intended notarization keychain profile have been requested rather than invented.

The earlier review remains the historical reproduction record. No claim of Photoshop parity, print certification, completed release qualification, or an updated installed app follows from this patch.
