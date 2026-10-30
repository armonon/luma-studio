# Luma Edit Points review

Implemented on the isolated Form/Luma editor branches. Publication provenance is recorded separately by the release coordinator. Cursor development and rollout remain paused.

## Supported interface

Select an unlocked native path layer and choose **Edit Points (D)** in the vector tool rail or vector properties. Generated boolean/offset paths require the existing Expand command first; raster/photo layers never masquerade as editable paths.

The passive overlay displays anchors, active incoming/outgoing handles and the selected segment. The existing canvas captures/routes input, including the existing touch draw/navigate switch. Point/handle hits use screen-space distances (22 CSS pixel touch radius). Select points with Shift or Select all, move points as a group, move handles, choose Corner, Smooth (opposite length retained), or Symmetric. Alt-handle movement explicitly changes the anchor to Corner. Collapsed Smooth points acquire a tangent from neighboring source points. Unused open-endpoint handles are not draggable and their numeric fields are disabled.

Select/Bend segment/Add Point are distinct actions. Bend keeps both endpoints fixed. Add Point performs exact de Casteljau subdivision, with a chosen curve parameter from segment hit testing or the selected segment control. Exact subdivision can change just one endpoint handle length, so a Symmetric endpoint explicitly becomes Smooth; this is disclosed in the controls. Remove reconnects remaining neighbors; Cut/Open rotates a closed contour into an open contour or splits an open contour at an interior anchor, assigning a new identity only to the duplicated cut endpoint.

Numeric local X/Y and handle length/angle controls commit on blur/Enter. Straight endpoint chord length/angle is explicitly separate from curve arc length. Luma converts image-space Y-down coordinates so displayed positive angles are counterclockwise, matching Form. Snap local 1 px is visible and optional. Shift constrains drag direction to 45 degrees; arrows nudge 1 local pixel, Shift-arrows 10. Controls use 44px minimum sizes and start collapsed on phone layouts.

Pointer movement is coalesced to one transient preview per animation frame. Release uses its final coordinate and makes one native history entry. Escape, pointer cancellation, lost capture, window blur, tool/document/layer changes, unmount and outside menu actions restore the original source. Undo during a live preview cancels it without consuming an unrelated prior undo; ordinary undo/redo remain available afterwards. Native source geometry, other contours, fill rule, appearance, relative handles and layer transform remain editable. Stable point IDs and modes persist in `.luma`; validation rejects malformed/duplicate IDs and unsupported modes. History budgeting includes the new metadata.

## Validation

- `node --import tsx --test tests/path-editing.test.mjs tests/path-point-editing.test.ts tests/vector-editing.test.ts tests/vector-workflows.test.ts tests/tablet-input.test.ts tests/history-payload.test.ts tests/history-bytes.test.ts`: **70 passed, 0 failed, 2 pre-existing Poppler-dependent skips**, 72 total. Includes exact cubic preservation over sampled parameters, fixed-endpoint Bend, mode/unequal-handle behavior, multi-contour translation, affine/zoom/touch hit tests, CCW numeric conversion, distinct cut/remove, legacy identity upgrade, native transient cancel/one commit/undo/redo and `.luma` save/reopen.
- `LUMA_TEST_DOM_ROOT=/Users/lillypad/Documents/Codex/2026-10-29/task/form-publish node --test tests/path-point-editor-ui.test.mjs`: **1 mounted DOM test passed**. Uses existing trusted jsdom and esbuild without installation. Exercises selection-only no history, preview, final release coordinate, Escape, multiple point movement, numeric handle length/CCW angle, compact phone controls, touch cancellation, interrupted Undo isolation, outside menu cancellation and unmount rollback. This is a DOM unit harness, not browser automation or a real device test. The optional harness reports a skip on checkouts without an installed jsdom resolver root.
- Full `npx tsc --noEmit --incremental false`: passed.
- Targeted ESLint on new editor/math/tests, vector validation, history payload and tool registry: passed.
- `git diff --check`: passed.

No new packages, file transfers or browser drivers were used. Publication provenance is recorded separately. Browser visual/gesture QA, sustained large-path interaction profiling and real pen/touch hardware validation remain unqualified; no physical latency or universal smoothness claim is made.


## Presentation cache correction

Viewport/focus/remount and adaptive-quality changes reuse a document-content cache
identity. They retain their separate save-ticket counter, and font resource changes
still invalidate pixels through a dedicated font revision. Repeated navigation back
to an unchanged view therefore reuses tiles without keeping stale edited or fallback
font pixels. Native canvas checks cover return-view cache hits, content edits,
undo/redo, source save/reopen, focus isolation, preview-quality save tickets and font
refresh invalidation. This is a concrete cache correction; no updated production
browser frame distribution or physical latency improvement is claimed.
