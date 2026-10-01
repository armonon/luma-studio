# iPhone workspace

## Implementation

`/iphone` opens the phone presentation of the shared editor. Touch-capable phones
are also detected by platform/screen dimensions in the existing editor;
`?interface=phone` forces a preview and the existing desktop/tablet overrides win
over automatic detection. Keyboard viewport resizing does not change device class.

The phone workspace uses a bottom tool rail, two-row portrait header, single-row
landscape header, horizontally scrollable contextual options, and a full-width
panel drawer. All 22 registered panels remain accessible from the drawer selector.
Choosing a tool returns to the canvas. The desktop dock arrangement is not changed.
Menus, undo/redo, export and dirty-document confirmation retain their shared commands.

Finger drawing is on by default, with an explicit Navigate toggle for finger pan
and pinch. The preference has its own phone key, separate from iPad. Existing
pointer ownership and brush cancellation are reused. This does not add Apple Pencil
hardware support to iPhones.

Safe-area padding and VisualViewport listeners adapt the shell to browser chrome
and keyboard viewport changes; page magnification is not disabled. The rendered
viewport is capped at 2 million pixels and 2048 pixels per dimension. These are
display-buffer bounds, not a guarantee about total memory or maximum project size.

A route-specific manifest and Home Screen metadata are included. No service worker,
offline guarantee, native iOS binary, App Store release, or deployment is included.

## Validation

- 24 focused phone/tablet input, shell, tool-dock and document-view tests passed.
- TypeScript, scoped ESLint, production web build, and `git diff --check` passed.
  The build still reports existing large-chunk and HarfBuzz browser-externalization
  warnings; passing the build is not performance or typography qualification.
- Initial WebKit run found an off-screen landscape header; phone-only flex layout fixed it.
- A subsequent run passed six sizes (320×568, 375×667, 390×844, 430×932,
  667×375, 844×390), panel access, finger drawing, undo/redo, brush cancellation,
  non-editing pinch, independent preferences, and dirty-close Cancel.
- Screenshot review then found compressed export selectors. The export grid now
  gives format selectors/action buttons full usable columns and spanning descriptions.
- Final WebKit evidence: `artifacts/iphone-workspace-K9l1GM/report.json` — all five
  campaign groups passed with no page errors, including all six viewports and
  the revised export selector sizing/JPEG selection. Portrait and export screenshots
  were also visually reviewed.
- iPad regression evidence: `artifacts/ipad-workspace-R3mJpN/report.json` — all
  six groups passed, including reload preference persistence and split-view bounds.
  An earlier run timed out waiting for page reload; the unchanged harness passed
  on retry. These checks use emulation, not physical hardware.
- `check-iphone-workspace.mjs` records screenshots and a report under ignored
  `artifacts/iphone-workspace-*`. Synthetic pointer capture is shimmed; hardware
  input/capture behavior is not established by these checks.

## Follow-up polish — 2026-09-30

- Phone header has a direct Save command with dirty/error/busy feedback. Shared
  editing stays reachable from the application menu without crowding the header.
- Related-tool sheets have an explicit close action, contained keyboard navigation
  and focus restoration. Touch tool browsing no longer automatically focuses search
  and requests the software keyboard. Desktop search keeps its autofocus behavior.
- Application menus dismiss outside/on Escape; panel Escape is scoped to its own
  focus rather than reacting to dialogs above it.
- The phone rail fits seven 44px targets in a 320px layout, with larger labels.
  Application menus are anchored inside screen edges; sheets respect safe areas.
- 25 focused tests, TypeScript and the final production web build passed. The
  refreshed local `/iphone` route returned HTTP 200. Existing large-chunk and
  HarfBuzz externalization build warnings remain. The browser campaign now
  includes the new controls and focus checks, but the earlier WebKit report above
  predates this polish. Fresh interactive and physical-device qualification remains
  necessary; server-rendered tests do not prove touch or focus behavior.

## Remaining device qualification

### Tap behavior correction

Mobile category buttons now select their current/recent tool directly instead of
opening the desktop-style related-tool menu. The explicit More button retains the
complete library, and library choices update each category's recent tool. Desktop
right-click, primary-button hold, and ArrowRight family access remain available;
touch holds do not start desktop menu timers. Browser callouts are suppressed on
the tool rail, contextual controls, document tabs and canvas, not text inputs.

Finger editing no longer inherits the desktop Space-to-pan modifier. Secondary
canvas clicks are ignored rather than starting a paint/edit interaction. Focused
policy/markup tests cover these distinctions. The three browser campaign scripts
have been adjusted to the new direct-selection behavior; their earlier reports
above/below predate this correction and are not new device-test evidence.

### Mobile optimization pass — 2026-09-30

- Touch painting uses separate Brushes, Mirror, and Settings sections backed by
  the existing panel and brush state. The library uses one vertical scroller,
  with visible-only cached previews and sticky phone navigation. Desktop retains
  the expanded controls. This follows the application-shell contract: no separate
  mobile document engine, command implementation, or duplicated brush state.
- Finger input skips hover-cursor geometry/layout/style work. Identical viewport
  plans preserve React state identity. VisualViewport events are frame-coalesced
  and repeated dimensions do not rewrite CSS variables. The existing phone
  display-buffer budget remains unchanged; this is not a total-RAM guarantee.
- Keyboard-occluded panels fill the visible viewport, including the interval
  between input blur and keyboard dismissal. Compact landscape/keyboard headings
  preserve space for controls. Mobile form fields override legacy light-theme
  colors; reduced-motion preferences suppress phone UI transitions/animations.
- The observed WebKit recovery warning was isolated to
  `navigator.storage.getDirectory()`, while IndexedDB succeeds. It is **not fixed
  by hiding the error or treating it as an empty workspace**. Failed workspace
  reads now pause checkpoint writes/discards so inaccessible older work cannot be
  hidden by a fresh recovery index. Routine recovery encoding is not scheduled in
  that state; explicit `.luma` saves remain available and report the recovery
  limitation separately. A successful re-read clears the guard.
- 59 focused tests pass, including the failed-legacy-storage guard and subsequent
  successful recovery, abort/discard protections, touch input, brush streaming,
  viewport bounds, keyboard detection and phone controls. TypeScript and scoped
  ESLint pass. The production web build passes with the existing large-chunk and
  HarfBuzz browser-externalization warnings; neither warning is waived as mobile
  performance or typography qualification.
- Browser evidence: `artifacts/iphone-workspace-L8zF2h/report.json` (six phone
  viewports and editing/export/dirty-close workflows),
  `artifacts/ipad-workspace-tvTRZ9/report.json` (tablet/palm/pen regression), and
  `artifacts/brush-toolbox-OlWYEn/report.json` (sections, mirroring, keyboard
  occlusion, stroke undo/redo, and explicit backup download while recovery is
  blocked). Screenshots were inspected; initial checks caught and corrected light
  input fields and premature panel shrink after blurring search.
- These are local browser/emulated tests. Physical iPhone/iPad thermal behavior,
  long-session latency, real software keyboards, iOS Files delivery and browser
  storage persistence still need device qualification. No speed-parity claim,
  deployment, native iOS packaging, or App Store release is established here.

### Brush toolbox follow-up

The existing registered Brushes panel now includes 24 categorized, searchable
engine-native recipes, lazily rendered/cached stroke previews, a shortcut to the
existing image-brush capture workflow, and one-tap mirrored/radial/kaleidoscope
painting. Repeats are bounded to 2–12, center position is normalized to document
dimensions, and guides follow the document overlay plane. Presets keep the user's
color and symmetry choices; applying one deliberately activates the regular brush.
Retouch tools do not falsely advertise mirror support. These are texture/dab
recipes, not fluid-media simulation or imported third-party brush packs.

35 focused tests passed, along with TypeScript, scoped lint and the final production
web build. WebKit evidence is `artifacts/brush-toolbox-2TeCr8/report.json`: search,
categories, selection, card layout, three phone sizes, live off-center eight-way
kaleidoscope parameters, and one-step undo/redo passed. Desktop library/four-way
guides also passed at 1440×900 (`artifacts/brush-desktop-dpT9qV/desktop.png`).
The app-shell skill kept this inside the shared registry, commands and stroke
engine rather than adding a second painting implementation.

**Unresolved qualification warning:** these isolated browser runs displayed
“Recovery needs attention: The operation failed for an unknown transient reason
(e.g. out of memory).” An independent empty IndexedDB probe succeeded. The cause
has not been established, and the toolbox pass must not be counted as recovery
qualification. Preserve explicit `.luma` backups pending investigation. Physical
stylus/iPhone behavior is not established by synthetic pointer events.

Test on physical iPhones: Safari chrome and keyboard behavior, accessibility text
scaling/VoiceOver, actual Home Screen installation, Files imports/downloads, clipboard,
background suspension/recovery, memory pressure, thermal behavior and long sessions.
Browser download initiation alone is not proof of a durable Files save. Maintain
explicit `.luma` backups. Existing interchange and native-only feature limits remain.

The app-shell skill guided reuse of the registries and command/document ownership;
the phone CSS is isolated from iPad and desktop styling. Existing unrelated macOS
release-packaging changes were preserved.
