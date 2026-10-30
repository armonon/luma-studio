# Shared drawing tools

The feature branches vendor identical pure affine, cursor, pointer-sampling, wheel and frame-scheduling modules. Existing Luma affine and cursor APIs retain their callers. Source and shared module hashes are recorded in app/shared/provenance.json.

From Form, run node scripts/check-shared-drawing-tools.mjs --luma-path <Luma checkout> to detect drift. This is an explicit source-sharing boundary rather than a published package. Raster/vector tools remain in Luma; measured source geometry remains in Form. See DRAWING-EDITOR-WORKFLOW.md for behavior, validation and qualification limits.
