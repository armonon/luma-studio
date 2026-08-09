# Luma Studio

Luma Studio is a local-first, nondestructive image editor for the web and a
packaged Tauri desktop edition. The TypeScript editing engine is shared between
both editions; the desktop app adds native filesystem dialogs and a threaded
Rust `f32` compositor.

The product deliberately reports what it can do today. Planned native RAW,
streaming large-document editing, and disk-installed plugins stay unavailable
until their full user-facing paths ship.

## What is implemented

- Raster, text, shape, path, group, adjustment, and smart-object layers.
- All 27 Photoshop layer blend modes, per-pass opacity, multiple blend passes
  per layer, fill opacity, Blend If, clipping masks, layer masks, and effects.
- Nondestructive levels, curves, HSL, tone, editable smart filters, soft proof,
  gamut warnings, 8/16/32-bit precision masters, sRGB, Display P3, and linear
  sRGB working spaces.
- Pressure/tilt-aware brushes, symmetry, paint, erase, mixer, clone, healing,
  removal, dodge/burn, blur/sharpen, smudge, sponge, gradients, and patterns.
- Marquee, lasso, polygonal, magnetic, color, quick, text-mask, and local
  semantic selections with feather, smooth, contrast, and edge shifting.
- Editable text, paragraph and vertical type, cubic-Bezier path type, pen/direct
  selection, shapes, perspective tools, crop, straighten, and transforms.
- DNG sensor decode for uncompressed and lossless-JPEG CFA data, retained sensor
  bytes, repeatable white balance/exposure/highlight development, and `f32`
  precision tiles. Other camera RAW formats use an explicitly labelled embedded
  preview when one exists.
- PSD/PSB preflight, untouched-source byte passthrough, 16-bit source promotion,
  editable adjustment/text/vector metadata, smart-object payload preservation,
  resolution/guides/effects preservation, and explicit warnings for conversions.
- Branching version history, bounded recovery, multi-document tabs, actions,
  batch ZIP export, PNG/JPEG/WebP export, and `.luma` project round trips.
- Local segmentation/matting models plus authenticated GPT Image 2 masked edits,
  bounded parallel variations, provenance metadata, cancellation, validation,
  per-user concurrency limits, and rate limits.

## Run and verify

Requires Node.js `>=22.13.0`.

```bash
npm install
npm run dev
npm test
npx tsc --noEmit
```

Useful commands:

- `npm run build` builds the hosted web edition.
- `npm run desktop:build` builds the static desktop frontend.
- `npm run pro:dev` starts the Tauri desktop development build.
- `npm run pro:build` produces signed-platform-ready desktop bundles.
- `cd src-tauri && cargo test` verifies the Rust compositor and IPC protocol.
- `npm run lint` runs the repository lint rules.

Generative editing requires `OPENAI_API_KEY` on the hosted server. The endpoint
also requires a Sign in with ChatGPT identity and never exposes the API key to
the browser. `AI_IMAGE_MODEL` can pin a deployment-specific model; the default
is `gpt-image-2`.

## Architecture

```text
app/studio/page.tsx        professional editing UI
        │
        ▼
app/engine/               shared document, rendering, color, RAW, PSD, history
        │
        ├── web build      Canvas/WebGL, browser files, hosted AI endpoint
        │
        └── desktop build  static Vite entry + Tauri IPC
                                  │
                                  ▼
                          crates/luma-core (Rust f32 + Rayon)
```

The document remains editable in the shared engine. Raster masters can live in
sparse half/float tiles while canvas bitmaps act as display and compatibility
mirrors. Eligible desktop flattened exports send bounded raw binary tiles to
`luma-core`; unsupported document constructs safely fall back to the shared
compositor.

The native bridge uses a validated binary protocol instead of serializing
millions of floats through JSON. Native file commands cap file size, sanitize
suggested names, and use operating-system Open/Save dialogs for `.luma`, PSD,
PSB, raster, RAW, and export files.

## Editions and honest gating

| Capability | Web | Desktop Pro | Status |
|---|---:|---:|---|
| Browser/local picker | Yes | Yes | Shipped |
| Native Open/Save dialogs | No | Yes | Shipped |
| RGBA16F GPU export | Yes | Yes | Shipped |
| On-device models | Yes | Yes | Shipped |
| Threaded native `f32` flattened export | No | Eligible documents | Shipped |
| DNG sensor development | Yes | Yes | Shipped |
| Non-DNG sensor decode | No | No | Planned |
| Streaming documents beyond canvas limits | No | No | Planned |
| Install plugins from disk | No | No | Planned |

`app/engine/edition.ts` separates permission from implementation:

- `hasCapability(edition, capability)` answers whether an edition may expose it.
- `isAvailable(edition, capability)` is true only when that capability is also
  marked `shipped`.

User interfaces must gate on `isAvailable`; tests pin this behavior.

## Photoshop interchange policy

Luma does not silently call lossy conversion “compatible.” The Document panel
contains a live Photoshop preflight for the selected PSD/PSB output mode.

- An untouched imported PSD/PSB can be returned byte-for-byte.
- Original Photoshop resources and unsupported descriptors are retained where
  possible for round trips.
- Edited 16/32-bit or wide-gamut projects currently export through an 8-bit RGB
  compatibility mirror and show a warning before export.
- Luma smart-filter results remain visible, but are not translated to native
  Photoshop smart-filter descriptors.
- Multi-pass Luma blending expands to ordered Photoshop layers.

Those last two items, full high-depth PSD writing, CMYK/Lab editing, a complete
LUT-based ICC engine, artboards, and parity with Photoshop's entire plugin
ecosystem remain real gaps. They are not advertised as complete.

## Desktop packaging

The desktop build has a dedicated static entry in `desktop/`; Tauri serves
`dist-desktop` with bundling enabled. The content-security policy allows only
the local app, Tauri IPC/assets, development localhost, and the configured Luma
host. System dialogs come from the official Tauri dialog plugin.

```bash
npm run desktop:build
cd src-tauri && cargo test
npm run pro:build
```

`pro:build` can take several minutes because it compiles the Rust release binary
and platform installer. Signing and notarization credentials remain a release
operations concern and are not committed to the repository.

## Scripting and plugins

Development builds expose `window.luma` for trusted automation. It is an
internal, unsandboxed surface, not a third-party security boundary. Production
users must explicitly opt in:

```js
localStorage.setItem("luma.scripting", "on");
location.reload();
```

Examples:

```js
luma.version;
luma.layers();
luma.active();
luma.engine();
await luma.export("image/png");

luma.registerPlugin({
  id: "auto-contrast",
  name: "Auto Contrast",
  version: "1.0.0",
  apiVersion: "0.3",
  activate(studio) {
    studio.addLevelsLayer();
    return () => {};
  },
});
```

Plugins are session-only, receive full document access, and must be registered
again after reload. Import public APIs from `@/app/engine`; that entry point is
the supported contract.

## Quality bar

The test suite covers blend reference formulas, CPU/GPU catalog parity,
compositing, groups, masks, brush determinism, transformed-coordinate editing,
filters, retouching, selection refinement, color transforms, ICC parsing,
proofing, DNG decoding/development, PSD/PSB preservation, project/history
round trips, sparse tiles, virtual viewport planning, native IPC, file packets,
AI validation/limits, and rendered routes.

Before a release, run the web build, TypeScript check, full tests, desktop static
build, Rust tests, and the platform Tauri bundle. Passing tests are necessary;
large real-world PSD/RAW corpora, long-session memory profiling, color-chart
validation, signed installers, and assistive-technology audits are still
required before claiming Photoshop-level production parity.
