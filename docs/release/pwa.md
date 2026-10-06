# Luma as an installable, offline app (PWA)

Same pattern as Glyph Studio (`armonon/glyph-studio@4dbb3c3`), adapted to the
Next runtime. Honest claim: **works offline after the first visit**.

## Pieces
- `public/luma.webmanifest` (name/short_name "Luma", start_url `/studio`),
  plus the existing `/iphone` and `/ipad` manifests; icons in `public/icons/`
  (regenerate with `PLAYWRIGHT=… node build/generate-pwa-icons.mjs`).
- `build/sw-template.js` → `public/sw.js`, generated after `next build` by
  `build/generate-sw.mjs` (`npm run build:netlify` runs both). `public/sw.js`
  is git-ignored.
- `app/studio/pwa.tsx`: registers `/sw.js` (hosted web build only — not
  Tauri, not `next dev`), shows "Luma now works offline on this device." once,
  and "A new version of Luma is ready. Reload" for updates. The new worker
  activates only after that click. "Install Luma app" appears in the "…"
  menu where the browser supports install prompts.

## What the worker does (and doesn't)
- Precaches `/studio`, `/iphone`, `/ipad`, every hashed `/_next/static` file
  except the on-device AI runtime (ORT, 27 MB — AI needs the network anyway),
  the manifests, icons, Lato Regular/Bold and the starter images (~10 MB).
- Studio navigations: network-first (4 s), then the cached page, then the
  precached `/studio` shell. Other pages (marketing home, `/learn`,
  `/campaign`) are not intercepted.
- Never cached: `/api/*` (the server function), non-GET requests, anything
  cross-origin except `https://thecreatingco.com/suite/v1/suite.js` and
  `apps.json` (last-known copy so the suite menu renders offline).
- `/fonts/*` and `/pdfjs/*` are cached after first use. User documents are
  never stored by the worker (autosave is IndexedDB, as before).

## Kill switch
If the worker itself ever misbehaves, ship `build/kill-switch-sw.js` as
`/sw.js`: it deletes Luma's caches, unregisters, and reloads open tabs.
`/sw.js` is served `Cache-Control: no-cache` (netlify.toml) so browsers pick
it up on their next navigation. With the parity method, overlay just `/sw.js`
onto the live deploy's file manifest (draft → verify → `/restore`). Restoring
an older deploy alone does not remove an installed worker — pair a content
rollback with the kill switch if the PWA is the problem.

## Verification
- `build/verify-pwa.mjs <base> <fixture.luma>`: manifest + icons, Chrome
  installability (CDP), `/sw.js` no-cache, SW control, precache complete,
  `/api/ai/edit` still reaches the function, then offline: reload `/studio`,
  open `/iphone` (never visited), open a project, hide a layer, export PNG and
  Export for Figma, reload again — 0 console errors.
- `build/verify-pwa-upgrade.mjs <local next start>`: v1 → v2 shows the update
  prompt, nothing activates until Reload, old precache removed afterwards.
- Fixture: `npx tsx build/figma-export-fixture.ts out/fixture.luma`.
Playwright is not a dependency of this repo; set `PLAYWRIGHT` to any local
install.
