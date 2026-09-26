# Typography customization pass — 2026-09-21

## Delivered

- Shared catalog of 60 suggested font families across system, sans, serif, display, script, mono, and multilingual categories. The Character panel searches the catalog and previews the active family; the options bar and Space controls use the same choices.
- User-triggered installed-font discovery: native macOS CoreText lists family names without loading or copying font files. The native unit test discovered 201 families on this machine. Supported browsers can request local-font access; unsupported browsers explain the limitation. Exact family names can also be entered manually.
- Weights 100–900, upright/italic/oblique, underline/strikethrough, alongside existing size, tracking, baseline, range styling, paragraph, vertical, and path controls.
- Editable appearance stacks: add up to eight solid fills and eight outlines, with individual enable/color/opacity controls and outline width. Empty or entirely disabled fills now correctly render outline-only or transparent text rather than falling back to the default fill.
- Five spatial text starting styles: Raised, Isometric, Deep block, Gold, and Violet. Reset and existing rotation/depth/bevel/material controls remain available. Front material color now affects preview pixels without overwriting the underlying text colors.
- All additions use the existing contextual Type panel and document editing/undo infrastructure; no separate sidebar or competing text state was introduced.

## Boundaries

Suggested fonts are not bundled, downloaded, or embedded. The family must be installed on the machine rendering the document; missing families fall back. Font discovery is bounded to 4,096 family names, and the picker renders at most 100 search matches plus the active choice.

Luma's spatial text is an affine, offset-depth/shadow preview, not a true extruded perspective mesh renderer. Roughness and metalness are exported material metadata. “Export for Form Studio” creates the existing portable editable `.lumaformtext` asset; it does not launch or live-sync Form Studio. General OpenType axes/features are not all rendered by Canvas. The former metadata-only optical-size slider was removed to avoid implying otherwise.

## Verification

- 20 focused JavaScript tests passed: typography rendering and customization, project round-trip, undo/redo, Form interchange contract, contextual routing, and command integration.
- One macOS native font-discovery test passed (201 families).
- TypeScript and targeted ESLint checks passed.
- Desktop frontend and isolated Tauri debug review app built; ad-hoc signature verified. No notarization claim and no replacement of `/Applications/Luma Studio.app`.
- Live browser smoke test in an isolated review server: created a disposable text document, searched Avenir, selected Avenir Next, confirmed the shared options bar updated, added two outlines, applied Gold, visually confirmed gold front/depth/outline output, and used Command-Z to restore the pre-preset settings.
- Reviewed compact 3D preset layout at the current 1280×720 test viewport. Full multi-resolution screenshot regression and native font-button end-to-end interaction were not performed; native enumeration itself was exercised by the Rust test.

## Sources for platform integration

- [Apple CoreText family enumeration](https://developer.apple.com/documentation/coretext/ctfontmanagercopyavailablefontfamilynames%28%29)
- [Browser local-font access](https://developer.mozilla.org/en-US/docs/Web/API/Window/queryLocalFonts)

No broad claim of full typography-engine parity or real-time 3D mesh authoring is made by this pass.
