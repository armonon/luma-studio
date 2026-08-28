# RC hardening report — 2026-08-28

This campaign followed the `v0.6.0-rc0-shell` checkpoint. It records locally reproducible evidence and leaves credentialed or multi-machine release work explicitly failing.

## Shell and desktop feature matrix

- Froze the Photoshop-class shell at commit `30ee233` and annotated tag `v0.6.0-rc0-shell`.
- Re-ran 64 shell, panel, command, shortcut, accessibility, persistence, and native-menu checks: 64/64 passed.
- Extracted Layers, Properties, Neural Lab, Document & Color, Channels, Actions, Measure, Layer Comps/Artboards, and Assets from `page.tsx` into dedicated panel modules.
- Kept imaging mutations in `Studio`; extracted panels receive callbacks and do not own docking or document state.
- Updated accessibility source coverage to follow registered panel components instead of assuming every command lives in `page.tsx`.

## Real project compatibility

- Re-ran all eight locally available private Photoshop projects: 8/8 passed.
- Coverage: six PSD and two PSB projects.
- Two projects retained editable layered imports; one source without layer records used its composite; five demanding projects used their explicitly declared bounded composite fallback.
- Peak RSS ranged from 1,092.5 MiB to 1,854.7 MiB, below each case's 3,072 MiB ceiling.
- The campaign found and fixed an evidence-policy defect: a declared `minimumLayers` floor was ignored when the PSD/PSB source contained extra bookkeeping layer records. The policy now has focused tests and reports numeric layer counts.
- The RC1 corpus gate remains closed: the local corpus has 8 rather than 50 projects, no RAW camera cases, and no Photoshop-rendered golden references.

## Destructive and memory-pressure campaign

The focused campaign passed 129/129 tests, including:

- 10K, 25K, and 50K sparse selection creation, refinement, feathering, and transforms;
- 50K sparse mask paint, feather, viewport composition, undo/redo, and project reopen;
- corrupt recovery rejection, all-tab crash recovery, and bounded long-session history;
- hostile raster and PSD/PSB preflight, compressed-bomb refusal, and bounded Photoshop fallback planning;
- shared resident-memory ceilings across pixel, selection, and mask tiles;
- dirty-region rendering, terapixel viewport planning, cache eviction, and scheduler cancellation;
- oversized streamed document and artboard PNG export;
- local and remote crash-report scrubbing, authentication, deduplication, retry, and receipt persistence.

## Native distribution

- `npm run pro:build` produced `Luma Studio.app` and an arm64 DMG.
- Local bundle audit passed: strict deep signature validation, bundle id `app.luma.studio`, required file associations, no development URL/home-path leakage, and a six-second isolated-environment launch.
- Installed app size: 12.73 MiB.
- Native Rust tests passed 5/5.
- Developer ID/notarization verification correctly rejected the ad-hoc bundle.
- Release configuration correctly rejected the missing real updater public key.
- Crash receipt verification correctly rejected the missing deployed HTTPS endpoint.

## External blockers

The following require user-owned files, credentials, infrastructure, or independent machines and were not fabricated:

1. Expand the compatibility corpus to at least 50 PSD/PSB/RAW projects and add Photoshop-rendered golden references.
2. Supply a production minisign updater key and HTTPS update endpoint, then run upgrade/interruption/invalid-signature/offline campaigns across two signed versions.
3. Sign with an Apple Developer ID Application certificate, notarize, staple, and pass Gatekeeper.
4. Deploy the crash collector, prove receipt, and symbolicate one known release-build crash with exact symbols.
5. Install and exercise the notarized DMG on two independently identified Macs without the development environment.

Until those are complete, `npm run release:status` must remain below RC2 even though the local application and safety gates are green.
