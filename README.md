# Luma Studio

Luma Studio is a local-first, nondestructive image editor for the web and a
packaged Tauri desktop edition. The TypeScript editing engine is shared between
both editions; the desktop app adds native filesystem dialogs and a threaded
Rust `f32` compositor.

The product deliberately reports what it can do today. Unsupported device-link,
CMYK/N-channel color transforms and codecs absent from the installed operating
system remain explicit fallbacks instead of being advertised as native support.

## What is implemented

- Raster, text, shape, path, group, adjustment, and smart-object layers.
- All 27 Photoshop layer blend modes, per-pass opacity, multiple blend passes
  per layer, fill opacity, Blend If, clipping masks, layer masks, and effects.
- Nondestructive levels, curves, HSL, tone, editable smart filters, soft proof,
  gamut warnings, 8/16/32-bit precision masters, sRGB, Display P3, and linear
  sRGB working spaces. ICC v2/v4 RGB matrix/TRC profiles, classic `mft1`/
  `mft2` tables, and strict 3-channel XYZ/Lab-PCS `mAB`/`mBA` curves, matrices,
  offsets, and 8/16-bit 3D LUTs run in the local color engine.
- Pressure/tilt-aware brushes, full-color captured image tips with canvas and
  upload sampling, tint/stencil modes, symmetry, paint, erase, mixer, clone,
  healing, removal, dodge/burn, blur/sharpen, smudge, sponge, gradients, and
  patterns. Captured-brush libraries round-trip inside `.luma` projects.
- Marquee, lasso, polygonal, magnetic, color, quick, text-mask, and local
  semantic selections with feather, smooth, contrast, and edge shifting.
- Editable text, paragraph and vertical type, cubic-Bezier path type, pen/direct
  selection, shapes, perspective tools, crop, straighten, and transforms.
- DNG sensor decode for uncompressed and lossless-JPEG CFA data, retained sensor
  bytes, repeatable white balance/exposure/highlight development, and `f32`
  precision tiles. Desktop Pro develops CR3, NEF, ARW, RAF and other supported
  camera files through the installed macOS ImageIO codecs at full resolution;
  an explicitly labelled embedded preview remains the fallback for unsupported cameras.
- PSD/PSB preflight, untouched-source byte passthrough, 16-bit source promotion,
  editable adjustment/text/vector metadata, smart-object payload preservation,
  resolution/guides/effects preservation, and explicit warnings for conversions.
- Branching version history, bounded recovery, multi-document tabs, actions,
  batch ZIP export, named layer comps, channel inspection, named artboard-region
  export, customizable workspaces/shortcuts, contextual properties,
  PNG/JPEG/WebP export, and `.luma` project round trips.
- Local segmentation/matting models plus authenticated GPT Image 2 masked edits,
  selection-aware bounded work regions for huge documents, parallel variations,
  provenance metadata, cancellation, validation, per-user concurrency limits,
  and rate limits.
- Safe persistent `.luma-plugin` packages that contribute validated Actions
  without arbitrary code execution, plus privacy-sanitized local crash records,
  exported diagnostics, and an emergency recovery checkpoint on fatal errors.

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
- `npm run bundle:check` builds and enforces the initial-route size and request
  budgets.
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
mirrors. The interactive viewport recomposes only dirty screen tiles, records
frame/tile telemetry, adapts preview resolution under load, and uses bounded
CPU, GPU, viewport, and scratch caches. Selection-scoped filters, refinement,
feathering, and content moves allocate scratch work and history around their
affected regions. The selection and layer-mask backing canvases themselves are
still document-sized, so workflows past the single-canvas ceiling are guarded
instead of advertised as complete until sparse alpha tiles replace them. Eligible desktop flattened
exports send bounded raw binary tiles to `luma-core`; unsupported document
constructs safely fall back to the shared compositor.

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
| Non-DNG sensor development | No | macOS codec fallback | Partial; not a complete nondestructive RAW workflow |
| Documents beyond canvas limits | No | Tiled viewport + precision paint | Partial; selections/masks/transforms remain guarded |
| Install declarative plugins from disk | No | Declarative Actions only | Limited plugin surface |

`app/engine/edition.ts` separates permission from implementation:

- `hasCapability(edition, capability)` answers whether an edition may expose it.
- `isAvailable(edition, capability)` is true only when that capability is also
  marked `shipped`.

User interfaces must gate on `isAvailable`; tests pin this behavior.

### Declarative plugin package

Desktop Pro installs a data-only `.luma-plugin` file from the Assets panel. A
package can add replayable Actions but cannot execute JavaScript or request
filesystem/network privileges:

```json
{
  "schema": "luma-plugin/1",
  "manifest": {
    "id": "example.editorial-detail",
    "name": "Editorial Detail",
    "version": "1.0.0",
    "apiVersion": "0.3"
  },
  "actions": [{
    "name": "Editorial Detail",
    "steps": [
      { "op": "convertSmartObject" },
      { "op": "addSmartFilter", "kind": "high-pass", "params": { "radius": 3 } }
    ]
  }]
}
```

## Photoshop interchange policy

Luma does not silently call lossy conversion “compatible.” The Document panel
contains a live Photoshop preflight for the selected PSD/PSB output mode.

- An untouched imported PSD/PSB can be returned byte-for-byte.
- Original Photoshop resources and unsupported descriptors are retained where
  possible for round trips.
- An edited 16-bit document can write native planar 16-bit PSD/PSB data when it
  is exactly one opaque, untransformed sRGB precision raster with normal 100%
  blending and no masks, filters, effects, or out-of-range samples.
- Other 16-bit documents, 32-bit documents, and wide-gamut projects export
  through an 8-bit RGB compatibility mirror and show a warning before export.
- Luma smart-filter results remain visible, but are not translated to native
  Photoshop smart-filter descriptors.
- Multi-pass Luma blending expands to ordered Photoshop layers.

Those last two items, general multilayer high-depth PSD writing, CMYK/Lab
editing, ICC device-link and arbitrary multi-process execution,
Photoshop-native artboard/layer-comp interchange, and parity with Photoshop's
entire plugin ecosystem remain real gaps. They are not advertised as complete.

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
operations concern and are not committed to the repository. Release builds also
remap the build machine's home path out of Rust panic/location strings. Tauri's
localhost development URL and CSP live only in `tauri.dev.conf.json`, so they
cannot leak into a packaged app.

Release builds use a separate ignored Tauri overlay so updater keys and signing
identity cannot be replaced by checked-in placeholders. Set
`LUMA_UPDATER_PUBKEY`, `LUMA_UPDATER_ENDPOINT`, and `APPLE_SIGNING_IDENTITY`,
then run `npm run pro:release`. Tauri consumes the signing/notarization secrets
from the release environment. After building, `npm run release:verify-macos --
-- /absolute/path/to/Luma\ Studio.app` records evidence only when Developer ID,
hardened runtime, Gatekeeper, and the stapled notarization ticket all verify.

`npm run bundle:audit -- --launch` is safe to run on local ad-hoc builds. It
checks the sealed bundle, associations, development-path leaks, and a launch
with an isolated HOME/PATH. Its report is deliberately not treated as
clean-machine evidence.

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

Declarative packages are persisted by Desktop Pro and may install replayable
Actions only. The opt-in developer scripting API can register JavaScript
plugins for the current session; those receive full document access and are
not a production sandbox. Import public APIs from `@/app/engine`; that entry
point is the supported contract.

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
