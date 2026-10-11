# Integrated Luma web release

The integrated editor is live at https://luma.thecreatingco.com/studio and
https://luma.thecreatingco.com/iphone.

- Qualified source: `1d840fb1d6d6ce25f4a03e9c35d2c2914d8008b3`, equivalent to
  merged main `ac3dbddcc1f3958232412f760066d028ded8d0ca`.
- Published Netlify deploy: `6acb9cc290d71f2f3a7c5ea2`.
- Previous deploy: `6aca8083d33e649fecd6843e`.
- Captured 1,692 publicly served baseline files with verified checksums. Retained
  the protected `/netlify.toml` digest and the current marketing homepage,
  workshops, campaign content, and older chunks.
- Final 1,716-file manifest matched the additive release plan exactly.
- Official streamed Next handler SHA-256:
  `cbb92326fd64c89d8551c3b4990a366988e127a785de7aff8ef2c0ce2fbe485c`.
  Node 22, streaming mode, 1,024 MB, `us-east-2`, and the static-preferred wildcard
  route were verified after publication. Uploaded all eight generated
  deploy-scoped page blobs using the hosting runtime's blob utilities.

The standalone Next production build and the complete official Netlify adapter
build passed. A stalled parallel Tailwind scan was stopped and the adapter build
passed with `RAYON_NUM_THREADS=2`; application assertions were unchanged.

Local, draft, and published-domain Chrome browser runs each passed at 1,440, 390,
and 320 pixels. Each imported a real 64 × 48 image, downloaded a `.luma` project,
confirmed the saved file, reopened it, and exported a PNG containing exactly
2,304 red and 768 blue pixels. No page errors occurred. The desktop save command
is accessed through the application menu; the phone has a direct save button.

WebKit phone checks passed across six portrait and landscape sizes: reachable
actions and touch targets, all registered panels, drawing/undo/redo/cancellation,
pinch zoom, export controls, and canceling a dirty-document close. This is browser
emulation, not physical iPhone or native application qualification.

Draft routes returned 200 for the editor, phone editor, homepage, and service
worker. The service worker retained `Cache-Control: no-cache`. Unsupported API
methods returned 405; invalid AI and crash-report requests returned 401 and 400.

The Luma–Form source exchange also passed against the integrated Form source:
shaped editable text became extruded glyph geometry in Form, a rotation returned
as source metadata, and editable text plus spatial metadata survived a `.luma`
save and reopen. This does not establish arbitrary mesh or live-sync fidelity.

The publication guard verified the previous live deploy immediately before
promotion. Existing native and professional-format qualification requirements
remain separate from this web release.
