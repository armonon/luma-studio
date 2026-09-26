# Transform interaction update

The Move tool's registered contextual options now expose Transform, Skew and
Distort, plus auto-select, handle visibility and snapping. The Space deck uses
the same mode setter. Existing panels, document protection and workspaces remain
unchanged.

- Move and handle input is coalesced to one update per animation frame. Pointer-up
  flushes the final sample; a gesture keeps its original layer and pointer ID.
- Shift locks movement to its dominant axis, scaling to the original proportions,
  and rotation to 15-degree increments. Option/Alt bypasses move snapping.
- Rotation preserves the transformed center, including on skewed layers. The
  numeric rotation field uses the same pivot convention.
- Skew is nondestructive affine shear. Drag either corner of a horizontal edge to
  shear that edge, keeping the opposite edge fixed. Picking, tiled rendering,
  native flattening, GPU cache invalidation, project persistence and PSD geometry
  include the shear. Older transforms default to zero shear.
- Distort is a convex four-corner **wireframe draft**. Apply/Enter rasterizes it;
  Cancel/Escape discards it. One Apply is one undo operation. This is not a live
  full-composite perspective preview or a nondestructive smart-object warp.
- Distort is explicitly limited to unlocked 8-bit raster layers and documents
  up to 8 million pixels. Masked, RAW, spatial, filtered, high-depth and proxy-only
  layers are refused rather than silently losing fidelity. Applying clips output
  to the document bounds. Skew/move/rotate do not allocate full-document buffers.
- Escape and pointer cancellation restore live affine transformations. No-motion
  clicks and returning to the initial affine transform do not add undo entries.

Regression coverage lives in `tests/transform-interaction.test.ts`, alongside the
existing canvas geometry, coordinate mapping, frame coalescer, PSD/local bounds,
native flattening, project history and tool registry suites. Interactive desktop
verification and frame-time benchmarks must be recorded separately; unit tests
are not proof of a sustained frame rate on real documents.
