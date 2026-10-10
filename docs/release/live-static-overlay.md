# The live static marketing/learning overlay

`luma.thecreatingco.com` (Netlify site `luma-studio-app`) has never been only
this repo's Next.js app. The published site is a merge of two things:

1. This repo's Next app — `/studio`, `/iphone`, `/ipad`, `/api/ai/edit`,
   `/api/diagnostics/crash`, plus a thin placeholder `/`.
2. A much larger static marketing/learning site — the real homepage, 14
   Luma workshops under `/learn`, `/campaign`, and the per-product
   workshop/after-hours/presentation pages for Form, ScenePilot and
   StemDeck that also live on this domain. **This half has never been in
   git.** It is produced by a separate, unknown pipeline and has only ever
   reached production via direct `netlify deploy` CLI runs.

`live-static/` is a point-in-time copy of that half: every file published by
this domain that this repo's build does not itself produce. It was captured
by diffing the Netlify deploy API's file manifest for the live published
deploy against the file manifest of a Next-only build of this same branch,
then downloading each live-only path from the deploy-pinned URL
(`https://<deploy-id>--luma-studio-app.netlify.app/<path>`) and verifying its
sha1 against the manifest. 1,097 marketing/learning paths plus 165 legacy
`_next/static/*` chunk files (shared React/webpack runtime chunks that the
static `/learn` pages reference directly by filename, because they embed the
live `/studio` editor in example boxes) — 1,262 files, 0 checksum mismatches.

`build/netlify-plugins/overlay-live-static/` is a local Netlify build plugin,
wired in after `@netlify/plugin-nextjs` in `netlify.toml`, that copies
`live-static/*` into the publish directory the official plugin just built.
It is additive except for one deliberate overwrite:

- `index.html` — the real site home has always been the static marketing
  page, not this app's own placeholder route. This is the one path both
  sides produce, so the plugin replaces it on purpose.
- Everything else is new: `learn/`, `assets/`, `campaign/`, the top-level
  marketing css/js files, and the legacy `_next/static/*` chunk files don't
  exist anywhere in this repo's own build output, so there is nothing to
  collide with.

## Why this had to exist before promoting Mockup/Glyph to production

The live published deploy (`6ac00bee…`, "Luma visual-world workshops with
exact editable continuation") has ~1,100 files this repo does not produce.
A plain `netlify deploy --build` from this repo — even with Mockup and Glyph
included — would have silently dropped all of it: the real homepage, every
workshop, the campaign page, and the other products' pages hosted on this
same domain. This overlay is what makes a repo-driven deploy safe to
publish without that regression. See `WAVE2.md` for the before/after
verification and the rollback deploy id.

## Keeping this current

These files will go stale the next time the separate marketing/learning
pipeline publishes new content directly (as it has roughly daily). There is
no automation tying the two together — re-run the capture process above
(diff the live deploy's file manifest against a Next-only build's manifest,
download and sha1-verify anything new) before the next promotion if it has
been more than a few days, or confirm with whoever owns that pipeline.

## 2026-10-06 (Wave 4) — previous app build's chunks carried forward

Publishing `wave4/luma-suite` replaces the app build that went live as deploy
`6ac515315dc9673521b09163` ("Mockup preview recovery…"). A full manifest
diff against that deploy showed 21 live-only paths, all of them that build's
hashed `/_next/static` files (3 build-manifest files under
`17yerx9wbocjj3wchczbw/`, 18 chunks/CSS). They are now in `live-static/`
(sha1-verified against the deploy manifest, 0 mismatches, 1.27 MB) so a tab
still running the previous `/studio` can lazily load its own chunks after
the new deploy goes live, instead of hitting 404s. Everything else live was
already covered by the snapshot.

Same again for the short-lived Wave 4 deploy `6ac56dc71801b94db5089256`
(published, then superseded the same afternoon by a one-line fix): its 8
hashed `/_next/static` files (plus its CSS chunk, which differs between builds
because Tailwind also scans `live-static/`) are in `live-static/` too
(sha1-verified).

## Production promotion guard

Repository merges build deploy previews without automatically replacing production
or branch deployments. The Netlify ignore command requires
`LUMA_PRODUCTION_BUILDS=on` for those deployments. Set this only after refreshing
the overlay against the current live manifest and verifying existing functions,
redirects, headers and runtime behavior. This guard does not qualify direct CLI
deploys; apply the same checks before publishing those.
