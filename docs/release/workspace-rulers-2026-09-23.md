# Workspace rulers

Implemented document-pixel rulers along the viewport's top and left edges. Tick density follows the renderer's CSS scale and positions follow its document-space viewport, including negative pasteboard coordinates. Tick generation is viewport-bounded, with a defensive 2,048-tick cap per axis.

View → Show Rulers and Cmd/Ctrl+R use the shared command registry. Visibility defaults on and persists locally. Native View-menu wiring is included. Rulers do not resize the rendering surface. This small shell integration follows the existing application-shell contracts; no unrelated panels or editor workflows were redesigned.

Drag either ruler into the canvas to create a horizontal or vertical document guide. Drops outside the document or viewport are rejected. Guide creation uses the existing engine history transaction and makes guides visible. Existing Pen snapping consumes these document guides. The ruler component uses its own document-prefixed React key, distinct from the canvas key, to prevent stale ruler instances during document changes.

Verification:

- 921/921 TypeScript tests passed, including five new ruler-model/command tests.
- 10/10 Rust tests passed.
- Typecheck, changed-file lint, and desktop frontend build passed. Existing bundle warnings remain.
- Browser preview at 1280×720: horizontal guide drag at Fit, vertical guide drag at 100%, one-step undo, Cmd+R visibility toggle, hidden preference after reload, and exactly one pair of rulers after recovery/document initialization verified.
- Returned test preview to Fit with rulers visible; test guides undone.

Scope: pixel units, fixed document top-left origin. No inch/mm units or draggable origin yet. No full visual-baseline campaign or native WKWebView interaction qualification performed for this change. Installed Mac app was not replaced.
