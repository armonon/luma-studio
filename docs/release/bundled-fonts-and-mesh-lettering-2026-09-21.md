# Bundled fonts and mesh lettering

Follow-up: production mesh lettering now uses [HarfBuzz-shaped outlines](./shaped-lettering-and-delivery-2026-09-21.md). This report records the original mesh-workspace milestone; the raster-insertion/live-3D boundary still applies.

## Scope and implementation

The existing contextual Type panel now has a lazy-loaded **3D lettering workspace**. It adapts Form Studio's `app/luma-text-bridge.ts` Shape/ExtrudeGeometry, physical-material and Y-up XYZ conventions. Form Studio's current text proxy is a textured box; Luma's new workspace instead builds each letter from bundled OpenType glyph outlines, including counters/holes, depth and bevels. Form Studio source files were not changed.

The ordinary image canvas keeps its earlier lightweight depth preview. The new workspace provides actual mesh perspective, environment lighting, roughness/metalness, separate front/side colors, pointer rotation and arrow-key rotation. Geometry rebuilds are debounced; rotation and material changes reuse geometry. There is no continuous render loop.

“Add render layer” inserts a bounded 1600 × 1200 transparent raster snapshot as one undoable operation, preserving the original editable text layer. It never allocates a document-sized bitmap. The resulting raster is a snapshot, not a live-linked mesh layer. PNG exports that view; GLB exports actual geometry and source metadata. Form Studio can import the GLB as geometry; editable-source `.lumaformtext` remains a separate interchange option, not live sync.

## Font library

12 bundled families / 28 static faces: Lato, Arvo, Abel, Anton, Lobster, Pacifico, Space Mono, Bangers, Righteous, Rajdhani, Amatic SC and Great Vibes. New text defaults to Lato. Other installed/system choices remain available but are not represented as bundled.

The unmodified font binaries and per-family SIL OFL copyright/license texts are checked into `public/fonts`. Sources are pinned to Google Fonts revision `e44c4b011a820c2cbe2fd2cfa8052037d7edb571`, with a SHA-256 manifest. Total fonts plus licenses/manifest input payload is approximately 8.46 MB; fonts load on demand from the app, not a third-party CDN. Desktop assets are available offline. Font-dependent exports wait for local font readiness, and font completion invalidates text render caches.

Three.js and OpenType.js MIT notices are included in `public/licenses`. The build does not download fonts; `build/vendor-fonts.ts` is an explicit maintenance command only.

## Defined limits

- Point text, one character style, left-to-right lettering; up to 160 UTF-16 code units per object.
- Bundled fonts only for mesh outlines; missing glyphs and unsupported layouts produce actionable errors instead of silently substituting a mesh font.
- Contextual ligatures/complex-script shaping, styled text ranges, 2D fill/outline stacks, decorations and path/frame/vertical text are not reproduced in the mesh workspace.
- The actual nearest bundled static font face is reported. Not every family has every weight/style.
- Bevel is capped relative to em size and depth to reduce invalid geometry.
- 12,000 path commands, 300,000 generated vertices, 2 MB per font, four parsed font entries, one GPU renderer per mounted editor. Oversized stories are rejected before geometry construction; final vertex count is checked and rejected geometry disposed.
- Closing or changing the selected source disposes geometry, materials, environment and GPU context. PNG/GLB export refuses stale source/settings after asynchronous work.
- Render-layer insertion accepts at most 2048 pixels per axis and preserves the source text through undo/redo and project save/reopen.

## Verification notes

Focused tests cover every bundled font/license/hash, family-face selection, all twelve mesh families, letter holes, finite geometry/depth/material groups, material/rotation reuse, GLB structure and source extras, unsupported input, and bounded 50K-document insertion with undo/redo and project round-trip.

The combined typography/mesh/interchange/command suite passed 39 tests. After changing the font parser to an explicit ESM entry point for server-build compatibility, the seven font/mesh tests and TypeScript passed again. Targeted ESLint passed before that import-only correction. Both the final Sites/Vinext web build (including SSR) and the isolated native Tauri app build passed. No new claim of comparative speed is based on these runs: the host was heavily loaded (observed system load average above 200).

The first isolated native build succeeded and was launched. Native UI verification could not complete: the computer-use service returned accessibility/startup errors. No native pointer/keyboard/visual-parity claim is made from that attempt. `/Applications/Luma Studio.app` was not replaced.

Full complex-script typography, a live mesh document layer, full 3D scene authoring, and full Form Studio round-trip editing are not claims of this implementation.
