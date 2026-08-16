# Luma Studio — handoff

## What this is

A Photoshop rival. One imaging engine, two editions; **the desktop (pro) edition
is the only one being worked on** as of 2026-08-12. The web build still exists
and still has to keep building — it has not been deprecated, and nothing should
break it — but no new effort goes there.

~31,300 lines of app code, ~10,200 lines of tests across 62 test files.
518 tests, all green. Typecheck, ESLint (`--max-warnings 0`), `cargo test` and
`cargo clippy -D warnings` for both Rust crates, and three build targets all
clean on `main` at `a2c98f7`.

```bash
npm test                      # builds first, then the whole suite
npx tsc --noEmit && npx eslint app tests --max-warnings 0
npm run desktop:build         # vite -> dist-desktop (the Tauri frontend)
npm run pro:dev               # NEXT_PUBLIC_LUMA_EDITION=pro tauri dev
cd src-tauri && cargo test && cargo clippy -- -D warnings
```

## How this codebase expects to be worked on

These are not style preferences. Each one exists because something shipped
broken without it, and the commit messages say which.

**Write the test, implement, then mutation-test.** Break the code deliberately
and confirm the suite fails. This has repeatedly caught hollow tests: a
source-text GL guard that survived deleting the guard, a Create Layers test that
only counted layers, compound effect fields that masked their sub-fields, and
three PNG offset mutations that survived a whole-file comparison because all
three produce a correctly *sized* image with the artwork in the wrong place.
When a mutation survives, decide honestly whether it is a test gap or genuinely
equivalent behaviour, and say which.

**Prefer behavioural assertions to structural ones.** A regex over source is
occasionally the right tool — for asserting two files agree on a constant, say —
but it cannot tell a moved guard from a deleted one. A structural test that
broke during a legitimate refactor is in `tests/marketing-claims.test.ts`; it
was rewritten to check behaviour instead.

**Never advertise what is not built.** `app/engine/edition.ts` splits
"permitted" (`hasCapability`) from "built" (`CAPABILITY_STATUS`), and
`tests/marketing-claims.test.ts` pins the marketing page to the engine. A menu
item that reaches nothing, a capability flag nothing consults, and a claim the
code cannot back are all the same defect.

**One source of truth per behaviour.** The effect pipeline is shared between the
CPU, GPU and native paths deliberately — `composeLayerWithEffects` in
`app/engine/layer-effects.ts` — so they cannot diverge. Where duplication is
forced by a language boundary (the menu exists in TypeScript and in Rust), a
test asserts the two agree.

**Comments explain why, not what.** Especially the non-obvious constraints:
premultiplied canvas blend semantics, sampling reach versus painting reach,
which of two plausible orderings is correct and how the wrong one looked.

## Architecture, briefly

- `app/engine/` — the engine. DOM-optional; `Studio` constructs headlessly.
  - `document.ts` (1,900) — the model. 17 `LayerEffectKind`s, 27 blend modes,
    text with tracking/justification, blending options.
  - `studio.ts` (4,000) — the controller. History, layers, export, native path.
  - `renderer.ts` — the CPU compositor. Tiled viewport, dirty regions. **This is
    the reference implementation; the other two back ends match it.**
  - `layer-effects.ts` — the one effect pipeline, shared by all three back ends.
  - `gl-renderer.ts` + `gl-shaders.ts` — WebGL2 RGBA16F. Export only.
  - `native-flatten.ts` + `crates/luma-core` + `src-tauri` — the Rust f32 path.
  - `psd.ts` (1,850) — PSD/PSB, byte-for-byte passthrough for untouched files.
- `app/studio/` — the UI. `page.tsx` is 3,933 lines and has **no test file**.
- `app/desktop/` — menu model, native menu bridge, recent files.
- `src-tauri/` — the shell: menu, file associations, IPC, window state.

## Where the three compositors stand

All three agree with each other; that agreement is tested and was hard-won.

- **CPU** — reference. Everything works. 8-bit throughout (canvas 2D).
- **GPU** — export only. Accepts every effect now; reads the composite back for
  the backdrop-sampling ones. Still declines adjustment layers with custom
  blend passes. `linearCompositing` is **off** and the default is load-bearing:
  the CPU path is sRGB with no linear mode, so turning it on makes GPU export
  disagree with CPU export about what the image looks like (64 vs 137 for a 25%
  white panel over black).
- **Native (Rust)** — export only. Now accepts transforms, filters,
  self-contained effects, clipping, vector masks, fill opacity and multi-pass
  blending. `nativeFlattenRefusal` names what is still refused and why: groups,
  adjustment layers, knockout, Blend If, channel masks, backdrop effects,
  clipped-as-group, non-sRGB.

**Verifying the GPU path:** node has no WebGL2. Parity was measured in a real
browser by driving `window.luma` with scripting enabled
(`localStorage.setItem("luma.scripting", "on")`) against `npm run dev`. All 17
effects individually and stacked agree with the CPU renderer within 1/255. Redo
that if you touch the GL renderer; `tests/gl-compositing.test.ts` explains how.

## What I would do next, in order

1. **`app/studio/page.tsx` — 3,933 lines, zero tests.** Every user interaction
   lands here. Two pieces have been extracted and tested
   (`app/studio/canvas-geometry.ts`); roughly 37 handlers remain. Extract pure
   logic and test it, the way `history-payload.ts`, `mask-ops.ts` and
   `canvas-geometry.ts` were. `layer-style-dialog.tsx` is another 757 untested
   lines.

2. **Four untested I/O modules.** `png-stream.ts` now has coverage;
   `lossless-jpeg.ts` (203), `tile-backing.ts` (173), `ag-psd-io.ts` (147) and
   `precision-renderer.ts` (101) do not. These are the ones that corrupt a
   user's file when they break — the only defect class here that loses work.

3. **Route the viewport through the GPU.** The editing surface is still the
   8-bit CPU compositor; the float path is export-only, so the precision is
   real but invisible while you work. The bounded optimisation waiting here is
   reading back only the sub-rectangle a layer's effects can reach rather than
   the whole canvas (Reflection excepted — it mirrors across the layer and can
   reach the far side). At 13ms per readback that does not matter for export;
   it will matter at 60fps.

4. **The two remaining planned pro capabilities.** `native-raw` (sensor decode
   for non-DNG cameras; needs a real RAW library) and `plugin-install` (load
   plugins from disk rather than only via the scripting console). Both are
   marked `planned` in `edition.ts` and correctly advertise as unavailable.

5. **Naming honesty.** The `puppet-warp` tool is labelled "Puppet warp" but
   calls `radialWarp` — a single-point radial push, not pin-based mesh
   deformation. Same species of claim as the native-compositor copy that was
   corrected earlier. Either build it or rename it.

## Traps worth knowing before you touch the compositors

- **The working space is linear light.** `tileToWorkingFloat32` returns linear
  values; `tileToFloat32Display` returns display sRGB. Feeding the former to
  something that writes into an 8-bit canvas makes everything too dark — that
  was a live bug in the native path.
- **Canvas blends are premultiplied.** Where the destination is transparent or
  partial, a separable blend lets the source through un-blended in proportion.
  This has caused two separate bugs; both are documented at the call sites.
- **`getImageData` past a canvas edge is not uniform.** It pads on some edges
  and throws on others in `@napi-rs/canvas`. Do not rely on either; clamp.
- **Masks are applied before effects by default.** "Layer Mask Hides Effects" is
  off by default, so the mask shapes the pixels and the shadow still falls
  outside it. `rasterizeLayer` does this now and neither accelerated back end
  may mask again.
- **Sampling reach is not painting reach.** An effect clipped to its layer still
  *samples* outside it; `layerEffectReach` covers both, and getting it wrong
  shows up as tile seams in the editor but never in export.

## Open questions for the user

- The web build (Cloudflare + Netlify + the marketing page at `/`) is still
  wired and still in CI. "Desktop only" was read as where effort goes, not as a
  request to delete anything. Ask before removing it.
- `flattenNative` and `renderGL` are both export-only by design. Making either
  drive the viewport is a real change in behaviour and should be a decision,
  not a side effect.
