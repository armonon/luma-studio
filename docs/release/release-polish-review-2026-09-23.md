# Release-candidate critical review and polish — 2026-09-23

## Verdict

**Hold a public production release.** This pass fixes reproducible safety and usability
defects; it does not certify every tool, external format, camera, tablet, or installed
Mac configuration. Review and tests were performed against the existing, substantially
modified working tree. Pre-existing changes were preserved; nothing was committed,
pushed, deployed, or installed over the user's application.

## Findings addressed

| Priority | Finding and evidence | Change |
| --- | --- | --- |
| P1 | Closing an inactive or nonexistent document cancelled the active document's paint gesture; reproduced before the fix | Validate the close target first; discard active gestures only when closing their owning tab. Regression exercises stroke completion, undo and redo. |
| P1 | Switching/opening documents during a live opacity edit kept the preview value but erased its undo baseline; reproduced with opacity 1 → .2 → switch → .4 → undo returning .2 | Cancel unfinished property previews before leaving their owner, including global-light preview state. Preserve normal committed edits and dirty-state accounting. |
| P1 | Vector export lacked the raster path's asynchronous document-ownership guard | Engine-owned SVG/PDF export checks the active document/revision before and after asynchronous preparation; concurrent edits cause rejection, not a stale download. |
| P1 | A small Frame allocated a document-sized placeholder and published structure before surface preparation | Use local frame pixels and translated geometry, reserve memory before allocation, prepare the surface before commit, release admission on failure. Tests cover an 8K canvas, negative extents, undo/redo, excessive allocation refusal and injected preparation failure. Existing canvas-size restrictions remain. |
| P1 | Optional lazy shell chunks were outside error boundaries. The existing development preview was blank with a failed tool-rail dynamic import | Isolate tool rail, options, title/status controls and optional dialogs below the Studio owner. Offer save/close rather than reloading the workspace. Cancelling a failed PDF import dialog resolves its pending import choice. The observed stale development-module failure is not proof of an identical packaged-runtime defect. |
| P2 | Title said “Saved locally” while the document tab was dirty | Distinguish recovery updates, project saving, unsaved changes and clean state. Recovery is not represented as an explicit project save. |
| P2 | Export claimed “Editable fidelity check passed” before the export ran | Replace this with a statement that compatibility is checked during export. Keep explicit RGB/vector/PDF-X limitations. |
| P2 | Export appeared as a bright white, tiny-text dialog inside the dark editor | Use workspace tokens, readable type, bounded scrolling, keyboard focus containment and Escape dismissal. Block underlying document commands while export is open. |
| P2 | Keyboard tool activation bypassed the shared activation route; Brush's visible B shortcut did nothing from the Transform workspace in live UI testing | Route shortcuts through the same activation function as pointer selection. Desktop resolution can reach tools across workspaces, respects hidden/customized tools, and retains current-workspace priority for shared letters. |
| P1 | Website production SSR attempted to bundle Paper.js's Node-only jsdom/canvas adapter and failed | Honor package browser exclusions for the Worker SSR target. The website production build and all four rendered-route/auth/CORS smoke tests then pass. No vector functionality was stubbed out. |

The Photoshop-class app-shell skill guided failure isolation and shared tool routing;
this was not a redesign of the imaging engine or a replacement of the working shell.

## Dependency security

The initial production dependency audit reported six affected package entries, including
critical Next.js advisories and high-severity image/AI dependency advisories. Next.js and
its ESLint configuration were updated from 16.3.0 to 16.3.6; compatible dependency updates
resolved Transformers 4.3.0, ONNX Runtime Node 1.30.0, adm-zip 0.6.1 and sharp 0.35.4.
Cloudflare tooling and its matching Workers types were updated together; image-size
is constrained to patched 2.0.4. No forced dependency downgrade was accepted.

The Next.js AVIF advisory concerns server image optimization; the Windows advisory
concerns Windows-hosted servers. Neither establishes an exploit in the static macOS
frontend. See the [upstream AVIF advisory](https://github.com/advisories/GHSA-2xp9-vwfh-vxw4)
and [Windows advisory](https://github.com/advisories/GHSA-p293-qw3h-jr36).
Local dependency changes do not patch an already deployed website until redeployed.

After updates, `npm audit --omit=dev` reports **zero known vulnerabilities**. The full
audit retains **four moderate affected entries** in drizzle-kit's development-only
esbuild/loader dependency chain. npm proposes a breaking downgrade of drizzle-kit to
remove that chain; it was not applied. Do not expose that legacy esbuild development
server. This audit does not establish that the application has no security defects.
Retained full audit: `artifacts/release-review-dependency-audit-2026-09-23.json`.

## Coverage and limits

- Registry/source review covers 56 tool identifiers and 71 menu commands. Exhaustive
  dispatch tests and source wiring are not equivalent to exercising all those tools in
  the installed application. No new exhaustive native feature-matrix claim is made.
- The rebuilt desktop frontend was tested in an isolated browser origin, not the user's
  recovery workspace. The original preview and original artwork were not changed.
- Export was visually inspected at 1280×800, 1440×900 and 1920×1080. Tab/Shift-Tab
  wrap inside the dialog and Escape dismisses it. These are fresh manual observations,
  not a complete retained golden-image regression campaign.
- Black & White opens its own Monochrome/Tint controls rather than generic Tone controls;
  changing Monochrome and undoing restored its original value in the UI.
- On the final rebuilt desktop frontend, B switches from Transform to Brush and T then
  activates Text with contextual font controls. The sampled session logged no console
  warnings/errors. This is not an exhaustive shortcut or native WebKit test.
- Shell fallback markup and placement have unit/source assertions. A browser-injected
  chunk-failure campaign and native WebKit failure simulation have not been completed.
- AI upload admission now precedes bounded body parsing in the inspected route. This
  existing fix was inspected and covered by regressions, not a production penetration test.
- Memory admission is not a hard process-RAM ceiling. The frame fix removes one wasteful
  path; it does not certify arbitrary dense 50K edits or unrestricted exports.
- Both frontend builds retain large-chunk warnings and a HarfBuzz browser-externalization
  warning. The desktop entry is about 865 kB minified / 261 kB gzip; the bundled asyncify
  WASM asset is about 26.9 MB before gzip. These are bundle sizes, not measured startup
  latency or resident memory. A cold-start model/typography campaign remains necessary.

## Remaining release gates

| Area | Evidence in this pass | What is not established |
| --- | --- | --- |
| Save/reopen, recovery, undo | Existing ownership/recovery/project regressions plus new cross-document gesture tests | Zero loss across all crashes, disk-full events and installed-app sessions |
| Layers, groups, masks, blending | Engine regressions; live adjustment routing/undo sample | Exhaustive GUI combinations and external-editor fidelity |
| Painting and retouching | Brush, captured-tip, streaming, stroke-target and retouch regressions | Real tablet pressure/tilt, long-stroke latency or Procreate parity |
| Selections and clipboard | Sparse selection, accuracy-pilot and clipboard failure regressions | Diverse Photoshop-matched accuracy and complete cross-app GUI qualification |
| Transforms, vector and shapes | Geometry, boolean/offset, frame and transaction regressions | Arbitrary Illustrator/Affinity interchange |
| Typography, PDF and 3D | Shaping, PDF object, lettering and Form interchange regressions | Universal font/script/PDF fidelity or arbitrary scene round trips |
| Color and RAW | ICC, color, RAW development and malformed-input regressions | Monitor/printer calibration certification and representative camera corpus |
| Actions, batch and plugins | Playback, batch isolation and declarative-plugin regressions | A general native plugin ecosystem or all third-party packages |
| AI and model delivery | Bounded-upload/rate-limit regressions; dependency/runtime import checks | Live paid generation or cold-cache packaged SAM inference after dependency updates |
| UI and commands | Registry/menu agreement, sampled production-frontend interaction, three export viewport checks | All 56 tools and 71 commands freshly exercised in native WebKit |
| Performance and memory | Admission/failure regressions, local frame allocation fix | Controlled native benchmarks or a process-wide RAM ceiling |
| Distribution | Release evidence checker and native bridge/core regressions | Signed/notarized/updatable installation on clean machines |

Tests establish only the assertions they exercise. The remaining work below is release
qualification, not justification for adding more tools.

1. **External compatibility:** a fresh, source-bound 50–100-project PSD/PSB/RAW campaign,
   independent Photoshop visual references, editable-structure assertions and repeated
   save/reopen/export. Historical small-corpus results are not current qualification.
2. **Native workflow coverage:** installed-app tool/panel/shortcut matrix, all required
   workspace visual states, cold-cache model delivery, real tablet strokes and long sessions.
3. **Resource qualification:** controlled-host peak process RAM, sustained brush/transform
   latency, memory-pressure failures and recovery. The host became heavily loaded during
   this pass; test durations must not be presented as product benchmarks.
4. **Distribution:** Developer ID signing/notarization, signed updater configuration and
   interrupted-update testing, symbolicated remote crash receipts, and clean-machine install.
5. **Honest scope:** constrained SVG/PDF interchange, camera-dependent RAW support, limited
   plugin scope, supported Form scene interchange, and uncertified print/color boundaries
   must remain explicit in release and marketing material.

Do not replace these gates with an overall “10/10” score or a test-count milestone.

## Final validation receipt

Final source fingerprint:
`735ec93fa5f250e09266ac7edcca0c49051f71ae63f173a44d468e6043f558bd`.

- `npm run qualify:local`: **1,023 application tests**, **10 native bridge tests** and
  **9 native core tests** pass; TypeScript and ESLint pass; source unchanged. This final
  run happened after regenerating the bundled ONNX runtime to match the updated package.
- `npm run desktop:build`: pass; `npm run build`: pass.
- `node --test tests/rendered-html.test.mjs`: **4/4 pass**, including marketing/editor
  server rendering, unauthenticated AI rejection and desktop-origin CORS checks.
- `git diff --check`: pass. Production dependency audit: zero known findings; full audit:
  four moderate development-chain entries, no high/critical entries.
- Final-source eight-case diagnostic corpus attempt: **blocked before workers ran**.
  Host load was 14.89 on eight logical CPUs, above the campaign admission limit.
  Receipt: `artifacts/release-review-corpus-2026-09-23.json`. Original corpus evidence was
  preserved. This is neither eight failures nor eight passes, and is not a substitute
  for the release gate's required 50+ projects, RAW coverage and external goldens.
- `npm run release:status`: **4/10 gates pass**. The primary compatibility report is
  explicitly stale/incomplete; updater configuration, updater failure evidence,
  notarization, remote crash reporting and clean-machine evidence remain missing.

The authoritative local receipt is `artifacts/local-hardening-report.json`; per-check
logs are under `artifacts/local-qualification/`. Frontend builds and native unit tests
are not notarization or an installed-app workflow qualification. The installed Mac
application and deployed website were not replaced in this pass.
