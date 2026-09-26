# Atelier workspace update

The editor now has a scoped visual contract in `app/studio/workspace.css`, applied
by AppShell through `data-ui="atelier"`. It covers the native and browser editor
without changing the marketing site. The document engine, docking layout format,
panel registry, command IDs, and recovery model remain authoritative.

## Visible changes

- Edge-to-edge graphite workspace, coordinated surfaces, clearer control text,
  restrained blue selection, keyboard focus rings, and reduced-motion support.
- Visible document tabs, separate dirty indicators, and an Open action routed
  through the existing command registry.
- Grouped native tool rail, related-tool menus, active specialist-tool icons,
  foreground color and color swapping.
- Bounded 64 × 64 layer thumbnails drawn from actual bitmap content. Vector,
  text, adjustment and group layers use meaningful icons, not stock imagery.
- Consistent panel icons, scrollable panel tabs, tab keyboard navigation,
  accurate disabled layer actions, and layer keyboard navigation.
- Compact Properties with expandable quick and spatial controls, plus a working
  Space palette launcher. Full contextual editors remain available below.
- Coordinated Space palette, tool search, floating panels, and dialogs.
- Tool search traps focus, returns focus on close, and isolates keyboard events
  from the canvas. This fixes Enter triggering layer focus behind search.

## Verification

Native review uses a separate bundle identifier (`app.luma.studio.ui-review`) so
opening the review build does not replace a running production document.

Direct native checks exercised brush selection, Space open/pin/close,
right-click related tools, Capture Brush activation, Properties float/redock,
and search filtering. Search keyboard activation exposed a canvas shortcut
conflict. In the rebuilt app, searching for Paragraph text, moving to the
result with Down, and pressing Enter selects that tool and updates its options
without entering canvas focus. The review app also restored the redocked panel
layout after restarting.

The focused shell, dock, tool, presentation, and Space-model tests, TypeScript,
lint, desktop frontend build, web build, and native review bundle are checked
as part of this change. They do not establish that every imaging operation is
correct or certify release packaging.

Existing reference images in `tests/visual-regression` describe the previous
visual design. They are preserved rather than automatically rebaselined. A
complete replacement screenshot matrix at 1920×1080, 1440×900, and 1280×800
remains a separate release gate.
