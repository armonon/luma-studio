# Editable shape creation — September 23, 2026

## Use

Open More Tools / Cmd+K, choose **Custom shape**, then use the shape picker in the contextual toolbar. Rectangle, ellipse, triangle, polygon, star, heart, diamond, arrow, chevron, cross, speech bubble and line are included. Drag to draw; Shift constrains proportions or line angles, Option draws from the center, and Escape cancels. Space exposes the same creation settings.

Fill, stroke, polygon/star count, star inner radius and rectangle corner radius are creation defaults. Existing objects remain editable through Properties, direct-selection anchors and the established vector construction tools. Changing creation defaults does not mutate the selected object.

To reuse a custom outline, draw a closed Pen path or construct a closed compound vector. Select it, then choose **Save selected outline** in the picker, **Define Custom Shape** in command search, or Edit → Define Custom Shape in the rebuilt native menu. Presets take the layer's name. Curves, compound contours, fill rules and the layer transform are captured; paint stacks, masks, effects and editable boolean recipes are not part of an outline preset.

The library is local to this browser origin/application data store, with 32 presets and a bounded serialized size. Placed copies are independent vector layers saved inside their documents, not references to local presets. Removing a preset does not remove placed artwork. A blocked or malformed local store is not silently overwritten. Libraries do not currently sync across apps or devices.

## Implementation

- Central shape geometry builder is shared by previews and committed edits.
- Shape gestures capture the originating document and creation settings; stale document targets are refused.
- Horizontal, vertical and reverse-direction lines work without normalized-bounds mirroring.
- Shape creation selects the new layer and uses one structural undo step.
- Existing tool and command registries own routing. Toolbar and Space settings share state; the picker is a keyboard-accessible dialog outside the scrolling toolbar.
- Rounded rectangles now convert to cubic vector outlines for custom capture and vector delivery.
- No raster allocation is needed to construct shape geometry.

## Evidence

- 905 engine tests passed, including ten new shape regressions and the existing vector/menu/gesture coverage.
- TypeScript checking and lint of all touched TypeScript files passed.
- Desktop frontend production build passed (existing large-chunk warnings remain).
- Direct UI: selected a heart preset, drew a vector, saved it as a custom outline, drew a second copy, undid/redid it with keyboard shortcuts, and opened its Space controls.
- A fresh editor instance restored both the local custom preset and the recovery document containing the two vector layers.
- Rendered inspection at 1280×800, 1440×900 and 1920×1080; temporary viewport overrides reset. These are manual observations, not a newly persisted automated golden suite.

Installed macOS applications were not replaced. The native menu change requires rebuilding/installing the application to appear in an existing installation. No commit or push was performed.
