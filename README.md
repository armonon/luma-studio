# vinext-starter

A clean full-stack starter running on
[vinext](https://github.com/cloudflare/vinext), with optional Cloudflare D1 and
Drizzle support.

## Prerequisites

- Node.js `>=22.13.0`

## Quick Start

```bash
npm install
npm run dev
npm run build
```

This starter does not use `wrangler.jsonc`.

## Included Shape

- edit site code under `app/`
- `.openai/hosting.json` declares optional Sites D1 and R2 bindings
- `vite.config.ts` simulates declared bindings for local development
- `db/schema.ts` starts intentionally empty
- `examples/d1/` contains an optional D1 example surface
- `drizzle.config.ts` supports local migration generation when needed

## Workspace Auth Headers

OpenAI workspace sites can read the current user's email from
`oai-authenticated-user-email`.

SIWC-authenticated workspace sites may also receive
`oai-authenticated-user-full-name` when the user's SIWC profile has a non-empty
`name` claim. The full-name value is percent-encoded UTF-8 and is accompanied by
`oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`.

Treat the full name as optional and fall back to email when it is absent:

```tsx
import { headers } from "next/headers";

export default async function Home() {
  const requestHeaders = await headers();
  const email = requestHeaders.get("oai-authenticated-user-email");
  const encodedFullName = requestHeaders.get("oai-authenticated-user-full-name");
  const fullName =
    encodedFullName &&
    requestHeaders.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
      ? decodeURIComponent(encodedFullName)
      : null;

  const displayName = fullName ?? email;
  // ...
}
```

## Optional Dispatch-Owned ChatGPT Sign-In

Import the ready-to-use helpers from `app/chatgpt-auth.ts` when the site needs
optional or required ChatGPT sign-in:

- Use `getChatGPTUser()` for optional signed-in UI.
- Use `requireChatGPTUser(returnTo)` for server-rendered pages that should send
  anonymous visitors through Sign in with ChatGPT.
- Use `chatGPTSignInPath(returnTo)` and `chatGPTSignOutPath(returnTo)` for
  browser links or actions.
- Pass a same-origin relative `returnTo` path for the destination after sign-in
  or sign-out. The helper validates and safely encodes it.
- Mark protected pages with `export const dynamic = "force-dynamic"` because
  they depend on per-request identity headers.

Dispatch owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, `/callback`, the
OAuth cookies, and identity header injection. Do not implement app routes for
those reserved paths. Routes that do not import and call the helper remain
anonymous-compatible.

SIWC establishes identity only; it does not prove workspace membership. Use the
Sites hosting platform's access policy controls for workspace-wide restrictions,
or enforce explicit server-side membership or allowlist checks.

Use SIWC for account pages, user-specific dashboards, saved records, and write
actions tied to the current ChatGPT user. Leave public content anonymous.

## Useful Commands

- `npm run dev`: start local development
- `npm run build`: verify the vinext build output
- `npm test`: build the starter and verify its rendered loading skeleton
- `npm run db:generate`: generate Drizzle migrations after schema changes

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)

## Scripting surface

Luma exposes a scripting hook on `window.luma` for automating the editor from
the devtools console. It is an **internal tool, not a third-party extension
point**: `activate(studio)` receives the whole `Studio`, with no capability
scoping or sandboxing. Only run scripts you trust.

Because it grants full document access plus `export()`, it is enabled in
development builds only. To turn it on in a production build:

```js
localStorage.setItem("luma.scripting", "on"); // then reload
```

### Example

```js
luma.version;                 // "0.3" — the API version
luma.layers();                // Layer[]
luma.active();                // the selected layer, or null
luma.engine();                // renderer / memory / plugin telemetry
await luma.export("image/png");
```

### Plugins

```js
luma.registerPlugin({
  id: "auto-contrast",
  name: "Auto Contrast",
  version: "1.0.0",
  apiVersion: "0.3",          // checked against LUMA_API_VERSION
  activate(studio) {
    const layer = studio.doc.layers[0];
    if (layer) studio.addLevelsLayer();
    return () => { /* optional teardown */ };
  },
});
```

`registerPlugin` returns an unregister function. `apiVersion` is optional; when
present it must match the running build's `LUMA_API_VERSION` on major.minor
(pre-1.0, the minor is the breaking-change axis) or registration throws.

A plugin's teardown is run defensively — a handler that throws is logged and
skipped, and cannot abort Studio teardown or strand other plugins.

### Limitations

- Plugins are session-only. They are not persisted in `.luma` projects and must
  be re-registered after reload.
- There is no lifecycle hook for document switching. `switchDocument` swaps the
  active document underneath a plugin; hold ids, not layer references.

## Editions

One engine, two products. Everything ships from `app/engine`, which is
DOM-optional — document, history, selection, blend and plugin work run
headlessly, and only rendering/export need a canvas.

| | **web** | **pro** |
|---|---|---|
| Runs | Browser tab | Packaged desktop build |
| Files | Picker only | Native filesystem *(planned)* |
| Document size | Browser canvas ceiling (~64MP) | Larger *(planned)* |
| RAW | DNG sensor decode; other RAW → embedded JPEG | Native RAW library *(planned)* |
| GPU export | RGBA16F | RGBA16F |
| On-device models | Yes | Yes |
| Plugins | Scripting console | Install from disk *(planned)* |

Select the edition at build time:

```bash
NEXT_PUBLIC_LUMA_EDITION=pro npm run build
```

### Gating features honestly

`app/engine/edition.ts` separates two different questions, because conflating
them is how products end up advertising things they cannot do:

- `hasCapability(edition, cap)` — is this edition *permitted* to do it?
- `isAvailable(edition, cap)` — is it permitted **and actually built**?

UI must gate on `isAvailable`. Capabilities marked `planned` in
`CAPABILITY_STATUS` return `false` from `isAvailable` in every edition, and a
test enforces it. Promote a capability to `shipped` only when a user can
really use it.

### Public API

Import from `@/app/engine`, never from individual modules — internals are free
to move, the entry point is the contract:

```ts
import { Studio, currentEdition, isAvailable } from "@/app/engine";
```

`tests/engine-api.test.ts` pins that surface, including a headless undo/redo
round-trip, so breaking the desktop edition fails CI.

## Pro edition (desktop)

The desktop build is a [Tauri](https://tauri.app) shell around the same
`app/engine`. The Rust process owns only the window; all editing runs in the
shared engine, so there is no second implementation to keep in sync.

```bash
npm run pro:dev      # desktop shell against the dev server
npm run pro:build    # packaged build (see Packaging status below)
```

Both set `NEXT_PUBLIC_LUMA_EDITION=pro`, which is what flips the capability
matrix in `app/engine/edition.ts`.

### The pro edition is not the web build in a window

The desktop edition exists because the browser engine is structurally capped,
not because a native window is nicer. `app/engine` stores every layer as a
`Uint8ClampedArray` behind an `HTMLCanvasElement`, composites on the main
thread, and uses no workers and no SIMD. Wrapping that in Tauri inherits every
one of those limits.

`crates/luma-core` is the native imaging core that removes them:

| | web engine | luma-core |
|---|---|---|
| Precision | 8-bit, clipped every stage | `f32`, unclamped at rest |
| Threading | main thread only | rayon, all cores |
| Blend space | gamma-encoded sRGB | sRGB or linear light |
| Headroom | none | HDR values survive the pipeline |

Measured on this machine (8 threads, 2048x1536, 8 layers, `cargo run --release
--example bench -- <mode>`):

| blend mode | web engine | luma-core | speedup |
|---|---|---|---|
| `multiply` (native canvas operator) | 49 ms | 26 ms | 1.7x |
| `subtract` (no native operator) | **5891 ms** | **25 ms** | **220x** |

The gap is not uniform, and the reason matters. For `multiply` the browser
hands off to Skia's optimised compositor, so the honest win is modest — and
luma-core is doing 4x the precision work while achieving it. For `subtract`
there is no native operator, so the web engine round-trips through
`getImageData` and does the maths in JavaScript on one thread. **11 of the 27
blend modes have no native operator**, which makes more than a third of the
catalogue unusable at real resolutions in the browser.

Blend maths is kept in lockstep between the two: `crates/luma-core/tests/
parity.rs` asserts against the *same* hand-derived W3C reference values as
`tests/blend-golden.test.ts`, so "one engine, two editions" is enforced rather
than hoped for.

**Status:** the core is a tested, benchmarked library and is linked into the
desktop binary. It does **not** yet back the editing UI — that bridge is the
next increment, and until it lands the desktop build still renders through the
web path.

### Why Tauri over Electron

| | Tauri | Electron |
|---|---|---|
| Bundle | ~3–10 MB | ~120–150 MB |
| Engine | OS webview (WebKit/WebView2) | Bundled Chromium |
| Backend | Rust | Node |
| Memory | Materially lower | Chromium per app |
| Rendering | Varies by OS webview | Identical everywhere |

Tauri wins on size and memory, which matters for a tool users install
alongside a full creative suite. The real cost is that the OS webview is not
Chromium — on macOS it is WebKit, so **WebGL2 float support and canvas
`colorSpace` behaviour must be verified per platform**, not assumed. Both
already have runtime fallbacks (`isGLSupported`, `getDisplayCtx`), so a
missing capability degrades rather than breaks.

Electron would be the right call if we needed guaranteed Chromium parity — a
reasonable future reason to switch, not a reason to start there.

### Packaging status

`npm run pro:dev` works today: it points the webview at the dev server.

Packaging is **not** finished, and the blocker is architectural rather than
cosmetic. `npm run build` emits `dist/server` + `dist/client` for a Worker
runtime — there is no static `index.html` for a webview to load. Three ways
forward:

1. **Static studio entry (recommended).** `/studio` is already `"use client"`,
   so a small Vite entry can mount it and produce a real static bundle. Keeps
   Tauri's size advantage.
2. **Ship Node and run the server in-process.** Works, but bundles a runtime
   and erases most of the size win.
3. **Point at a hosted URL.** Not meaningfully a download.

`bundle.active` is `false` in `src-tauri/tauri.conf.json` until (1) lands:
without a `frontendDist`, a production build has no frontend to serve. The
Rust shell itself compiles clean (`cd src-tauri && cargo check`), and the icon
set in `src-tauri/icons/` is generated from `public/favicon.svg`.
