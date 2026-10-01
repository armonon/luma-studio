# iPad workspace — implementation and qualification

## Delivered scope

This is a touch-oriented presentation of the existing Luma editor, not a fork of
the document engine and not an iOS native binary. `/ipad` explicitly selects it.
The existing editor also detects multi-touch iPadOS (including desktop user agent
and attached trackpad); `?interface=tablet` / `?interface=desktop` provide previews.

- A six-family tool rail opens related tools by tap; the full tool library remains available.
- Layers and contextual Properties open a dismissible drawer. Its selector exposes
  all 22 registered panels using the existing content and document context.
- Tablet panel changes do not rearrange the saved desktop dock layout.
- Header actions, document tabs, options, and drawer controls have larger touch targets.
- Portrait, landscape, safe-area insets, and narrow split-view layouts have scoped styling.
- Fingers navigate by default: one-finger pan and centroid-anchored pinch zoom.
- Pencil/mouse edit with the selected tool. Existing pressure, tilt, and coalesced
  brush sampling are reused. Extra touches cannot commandeer an active editing pointer.
- Optional finger drawing is a device-local preference. In this mode, a touch edits
  rather than pans; turn it off to navigate. Additional fingers do not start a second edit.
- Navigation updates are frame-coalesced. Display backing targets are capped at
  4,000,000 pixels and 3,072 pixels per dimension; this is NOT a process-memory cap.
- The `/ipad` route includes standalone/Home Screen metadata and a web manifest.
  No offline service worker or App Store distribution is being claimed.

## Verification

- 39 focused tests passed: tablet input ownership/navigation/buffer bounds,
  shell contracts, tool dock, viewport calculations, canvas gestures, document views.
- TypeScript passed; scoped ESLint passed during implementation.
- Desktop frontend production build passed (existing large-chunk/dynamic-import warnings remain).
- Sites web production build passed and includes `/ipad`; hosting was not changed.
- Initial isolated WebKit run passed drawer/tool access, navigation without edits,
  one undoable finger stroke, secondary-touch isolation, portrait bounds, and preference reload.
  Evidence: `artifacts/ipad-workspace-eDPrIt/report.json`.
- Portrait and landscape screenshots were inspected. Overlapping option sliders
  found in that pass were corrected without changing desktop styles.
- The browser campaign in `check-ipad-workspace.mjs` also covers synthetic pen
  cancellation, zoom state, and 600px split view. Pointer-capture is shimmed only
  for synthetic events; this does not establish hardware input accuracy.
- Final shared-editor run: `artifacts/ipad-workspace-IpSSkE/report.json`, all six
  workflow checks passed, no page errors.
- Dedicated `/ipad` route: `artifacts/ipad-workspace-TklL01/report.json`, all six
  workflow checks passed, no page errors. An earlier web run completed the actions
  but reported WebKit blob I/O/access errors (`ipad-workspace-2WD9eI`), while the
  web dev server and production build were active. A repeat after the build
  completed was clean; the root cause is not established and no recovery bug is
  claimed fixed. Keep this failure in the device/recovery qualification campaign.

## Not yet qualified

Physical iPad/iPad mini/iPad Pro testing is still required, including Pencil
latency, palm rejection by the OS, hover, double-tap/squeeze, Safari Files
downloads/imports, clipboard permissions, virtual keyboard, long sessions,
background suspension, recovery after OS eviction, and actual Home Screen installation.
No claim of native iOS packaging, full offline operation, or unrestricted
large-document support is made. Existing format and native-only feature boundaries
remain in force. Keep explicit `.luma` backups: browser recovery storage is not a
substitute for a saved file, and a browser download does not prove a durable Files write.

The app-shell skill guided reuse of registries and command/document ownership.
The Sites configuration was preserved; this work does not publish a deployment,
change signing credentials, or replace the installed macOS app.
