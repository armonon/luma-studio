# Smart selection and pixel editing — 2026-09-22

## Implemented

- Selected-pixel Copy, Cut, Delete, Copy Merged, Paste as a new raster layer, Paste in Place, and Layer via Copy. Sparse selection alpha, including soft edges, clips copied pixels in document coordinates.
- Commands are shared by the selection inspector, Space tool features, keyboard routing and native menu. Native text clipboard roles remain available in inputs. Mask-focused editing cannot accidentally invoke pixel Cut/Delete.
- Quick Selection latches its layer, document and combination mode for the stroke. Subtract no longer becomes Add on pointer movement. Intersect combines against the union of the stroke. One stroke creates one history entry; cancellation, lost pointer capture and document changes restore the original selection.
- SAM prompts now map document coordinates into transformed layer coordinates. Inference uses a bounded 1024-pixel-long-edge preview. Official mask postprocessing removes model padding before projection; proposal selection prefers prompt agreement and predicted confidence instead of largest area.
- Select Subject produces a selection, rather than silently installing a layer mask. The separate mask action remains available.
- Delete on precision/tiled layers visits resident tiles and records bounded tile patches. Injected failure rolls the edit back. HDR values outside the selection survive. Clipboard admission is bounded and failed copying preserves the previous internal clipboard.
- Native validation reproduced a stale canvas after creating a document. The display canvas now has per-document identity and binds directly on mount; pending frames from disposed engines are ignored. The rebuilt native review app displayed the correct new canvas and subsequent painted pixels.

## Validation

- Final TypeScript suite: **882/882 passed**; native Rust tests: **7/7 passed**. TypeScript checking, repository-wide lint, desktop web build and diff whitespace checks passed. The build retains existing large-chunk/dynamic-import warnings.
- Sixteen new regression tests cover clipboard alpha, transformed coordinates, cross-document paste, merged copy, Cut/Delete undo, locked/empty refusal, 50K sparse deletion, oversize-copy refusal, high-depth preservation, failure rollback, stroke history/cancellation/intersection, proposal ranking, shortcut metadata, paste routing and display-target lifecycle.
- Native review: new document → paint → Select All → Copy → Paste; Delete → empty-copy refusal; Undo → Cut → empty-copy refusal; Undo → successful Copy; Paste in Place. Layer counts and visible pixels were checked.
- Native text input: Cut empties the Name field and Paste restores its text without creating image layers.
- Native builds are local ad-hoc-signed review apps, not notarized releases. `/Applications/Luma Studio.app` was not replaced.

## Explicit boundaries

- Pixel clipboard data is a flattened **8-bit display-RGB** snapshot, limited to **16 megapixels** per copy. It does not preserve editable text, vectors, effects or HDR precision. High-depth Cut is disabled to avoid replacing high-depth originals with an 8-bit clipboard; Copy is nondestructive.
- Delete has a 128 MiB tile-history admission limit; legacy bitmap-only deletion has a 16 MP region limit. These are safe-refusal boundaries, not a promise that every full-canvas operation succeeds.
- Native in-app clipboard shortcuts were verified. The tested WKWebView refused browser PNG system-clipboard writes. Internal Copy/Paste works and reports that fallback; **cross-application image clipboard interoperability remains incomplete**. A bounded native clipboard bridge is the next step.
- No live SAM/subject-model accuracy corpus was run. Fine hair, transparency, low contrast and overlapping-object quality are not certified. Quick Selection remains color-region based, not equivalent to Photoshop's object-aware selection brush. SAM model loading still falls back to the wand, with the fallback identified by the UI.
- The app-shell skill guided shared command routing and preservation of the existing workspace, not a visual redesign.

This is a tested workflow improvement, **not a claim of perfect selection or Photoshop parity**.
