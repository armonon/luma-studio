# Pen precision snapping and measurements

## Controls

The Pen tool's contextual toolbar and Space popup share Snap, Grid, grid spacing, Shift angle increment (15°, 30°, 45°, 90°), and Measure settings. Preferences are stored locally. Defaults recover safely if saved settings are malformed or unavailable.

- Snap aligns to the current draft's anchors, document guides, and canvas edges/center. Grid adds configurable document-pixel targets.
- The automatic snap tolerance is eight screen pixels, independent of zoom.
- Option bypasses automatic snapping. Shift explicitly constrains the next segment or Bézier handle to the selected angle increment; this takes precedence over automatic alignment.
- Cyan guide lines show alignment. A ring and label indicate closing near the first anchor.
- Measurements show document-pixel distance, angle, and X/Y deltas. **Chord** means straight-line anchor-to-anchor distance, not Bézier arc length. **Handle** means the tangent handle's length. Angles follow canvas coordinates: 0° right, 90° down.
- Enter / Finish commits an open path; Close path joins the ends; Escape cancels the draft. Open paths now receive a visible two-pixel stroke instead of zero stroke and no visible fill.

Preview and handle updates coalesce to animation frames. Drafts are cleared on document switches and commits guard document identity. Committed paths use normal vector history and serialization. Automatic snapping does not currently scan other layers' geometry or infer equal-distance spacing constraints.

## Verification

- 916 engine tests passed, including 11 new tests for alignment, zoom tolerance, bypass, grid, angles, closure, handles, invalid settings, and editable path undo/save/reopen.
- Type checking and lint of changed TypeScript files passed.
- Desktop frontend build passed; existing bundle-size warnings remain.
- Direct browser interaction: two slightly misaligned clicks produced a horizontal snapped draft with an 881.3 px / 0° measurement; Enter created one path and one keyboard Undo removed it. Space settings and toolbar state stayed synchronized.
- Pen toolbar inspected at 1280×800, 1440×900 and 1920×1080; viewport overrides reset. This is manual visual inspection, not a new automated golden suite or native WKWebView qualification.

No installed Mac application was replaced, and no commit or push was performed.
