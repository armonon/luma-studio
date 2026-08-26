# Luma Studio desktop feature matrix

Audit date: 2026-08-25  
Baseline: `main` at `3abd794`, plus the fixes documented below  
Target: native desktop production build (`vite.desktop.config.ts` / Tauri)

## Status rules

| Status | Meaning |
| --- | --- |
| Working | The surface is reachable and its core operation passed a live desktop check, an end-to-end engine test, or both. |
| Partial | The surface is reachable, but professional scope, fidelity, an external dependency, or this run's end-to-end evidence is incomplete. |
| Inaccessible | Implemented code has no usable desktop route. |
| Broken | A supported path reproducibly fails or modifies the wrong state. |

This matrix separates UI reachability from professional compatibility. A tool can be Working while a PSD round-trip involving that tool is Partial.

## Executive result

| Surface | Result |
| --- | --- |
| Tool library | 56/56 entries activated live with the correct active-tool identity and contextual toolbar; 55 Working, 1 Partial |
| Contextual panels | 17/18 exercised live; 14 Working, 4 Partial; RAW needs representative camera files |
| Native commands | 24 command ids structurally matched across TypeScript and Rust; 20 Working, 4 Partial |
| Space tool features | Paint, retouch/tone, selection, mask, vector, transform, radial warp and measure decks exercised live; all passed |
| Raster export | PNG, JPEG and WebP produced valid encoded bytes |
| Photoshop export | PSD and PSB encode/decode pass synthetic fidelity tests; real-project corpus remains Partial |
| Console | No warnings or errors after the final live sweep |
| Remaining Broken / Inaccessible | 0 in the tested matrix after the audit fixes |

## Tools

Every row below was activated through the real All Tools surface. “Gesture/engine” means the operation is also covered by the canvas-gesture or focused engine suites.

| Workspace | Tool | Shortcut | Status | Evidence / prerequisite |
| --- | --- | --- | --- | --- |
| Edit | Move | V | Working | Live activation; hit target is locked from pointer-down |
| Edit | Brush | B | Working | Live activation, Space controls, brush engine |
| Edit | Capture Brush | C | Working | Live activation; capture and project-asset tests |
| Edit | Pencil | N | Working | Live activation and paint engine |
| Edit | Mixer Brush | X | Working | Live activation and retouch engine |
| Edit | Erase | E | Working | Live activation and paint engine |
| Edit | Gradient | G | Working | Live activation, Space controls, gesture/engine |
| Edit | Pattern | P | Working | Live activation and fill engine |
| Edit | Fill | F | Working | Live activation; opacity pixel/action regression |
| Retouch | Clone Stamp | S | Working | Live activation; Alt-click source required |
| Retouch | Healing Brush | J | Working | Live activation; Alt-click source required |
| Retouch | Spot Healing | Q | Working | Live activation and retouch engine |
| Retouch | Patch | A | Working | Live activation; source/selection prerequisite |
| Retouch | Remove | R | Working | Live activation and retouch engine |
| Retouch | Dodge | O | Working | Live activation and retouch engine |
| Retouch | Burn | U | Working | Live activation and retouch engine |
| Retouch | Blur | L | Working | Live activation and retouch engine |
| Retouch | Sharpen | H | Working | Live activation and retouch engine |
| Retouch | Smudge | M | Working | Live activation and retouch engine |
| Retouch | Sponge | D | Working | Live activation and retouch engine |
| Retouch | Liquify | Y | Working | Live activation and bounded brush warp |
| Select | Rect Marquee | M | Working | Live activation, Space controls, sparse selection tests |
| Select | Ellipse Marquee | N | Working | Live activation and gesture/engine |
| Select | Lasso | L | Working | Live activation, Space controls, gesture/engine |
| Select | Polygonal Lasso | P | Working | Live activation; Enter commits draft |
| Select | Magnetic Lasso | G | Working | Live activation and edge-snapping selection path |
| Select | Quick Selection | Q | Working | Live activation and color-selection engine |
| Select | Magic Wand | W | Working | Live activation and color-selection engine |
| Select | SAM Click-select | K | Partial | UI and local model/fallback route work; model availability and real-image corpus remain external |
| Mask | Reveal | B | Working | Live activation, Space controls, 50K sparse-mask paint/undo |
| Mask | Hide | E | Working | Live activation and sparse-mask engine |
| Develop | Tone | T | Working | Live activation, Space controls, nondestructive tone layer |
| Type | Text | T | Working | Live activation, Space controls, editable text engine |
| Type | Paragraph Text | A | Working | Live activation and paragraph-box gesture |
| Type | Vertical Text | V | Working | Live activation and type engine |
| Type | Type on Path | Y | Working | Live activation; active path required |
| Type | Type Mask | M | Working | Live activation and selection-mask generation |
| Type | Rectangle | R | Working | Live activation and vector engine |
| Type | Ellipse | O | Working | Live activation and vector engine |
| Type | Triangle | I | Working | Live activation and vector engine |
| Type | Polygon | G | Working | Live activation and vector engine |
| Type | Line | L | Working | Live activation and vector engine |
| Type | Custom Shape | C | Working | Live activation and vector engine |
| Type | Frame | F | Working | Live activation and frame gesture |
| Type | Pen | P | Working | Live activation; Enter commits path |
| Type | Path Selection | S | Working | Live activation; active path required |
| Type | Direct Selection | D | Working | Live activation; active anchor/path required |
| Transform | Crop | C | Working | Live activation, Space controls, normalized crop gesture |
| Transform | Perspective Crop | K | Working | Live activation and four-corner transform |
| Transform | Straighten | S | Working | Live activation and angle regression |
| Transform | Content-aware Move | M | Working | Live activation; selection required; bounded patch history tests |
| Transform | Perspective Warp | W | Working | Live activation and quad warp engine |
| Transform | Radial Warp | P | Working | Live activation, Space controls, warp engine |
| Measure | Eyedropper | I | Working | Live activation and transformed-pixel sampling |
| Measure | Color Sampler | S | Working | Live activation and persistent sample state |
| Measure | Ruler | R | Working | Live activation, Space controls, measurement gesture |

## Contextual panels

| Panel | Status | Evidence / limitation |
| --- | --- | --- |
| Document & color | Working | Live route; dimensions, resolution, working space, bit depth, proofing and guides mount |
| Channels | Partial | Live route works; current channels are view controls, not full editable/spot-channel interchange |
| Comps & artboards | Working | Live route plus layer-comp/artboard engine tests |
| Plugins & assets | Partial | Live route; captured brushes and declarative plugins work, but this is not an arbitrary native plugin SDK |
| Selection | Working | Live manual and automatic routes; blank-panel bug fixed in this audit |
| Mask | Working | Live automatic route and sparse-alpha operations |
| RAW Develop | Partial | DNG/local TIFF-CFA/macOS routes exist; no representative camera corpus was available in this run |
| Curves | Working | Created live from command palette; correct editor mounted |
| Levels | Working | Created live from command palette; correct editor mounted |
| HSL | Working | Added to command palette/native Layer menu; correct editor mounted live |
| Professional adjustment | Working | Black & White selected live and mounted its own editor rather than generic Tone |
| Tone | Working | Existing Tone layer selected live and mounted Tone controls |
| Paint | Working | Raster selection and Edit/Retouch routing verified live |
| Vector | Working | Type/vector tool routing verified live |
| Transform | Working | Crop/warp routing verified live |
| Measure | Working | Ruler routing verified live |
| Neural Lab | Partial | Panel and local semantic route mount; generative operations need a configured authenticated endpoint |
| Actions | Working | Panel mounts; recording/replay and batch isolation are engine-tested |

## Editing feature families

| Family | Included features | Status | Notes |
| --- | --- | --- | --- |
| Blend modes | Normal, Dissolve, Darken, Multiply, Color Burn, Linear Burn, Darker Color, Lighten, Screen, Color Dodge, Linear Dodge, Lighter Color, Overlay, Soft Light, Hard Light, Vivid Light, Linear Light, Pin Light, Hard Mix, Difference, Exclusion, Subtract, Divide, Hue, Saturation, Color, Luminosity | Working | Multiple passes per layer, independent opacity and advanced Blend If are covered |
| Smart Filters | Gaussian Blur, Motion Blur, Surface Blur, Lens Blur, High Pass, Unsharp Mask, Median, Dust & Scratches, Reduce Noise, Displace, Maximum, Minimum, Invert, Desaturate, Hue Rotate | Working | Editable filter stack; selected-region allocation tests are bounded |
| Layer effects | Bevel & Emboss, Stroke, Inner Shadow, Inner Glow, Satin, Color Overlay, Gradient Overlay, Pattern Overlay, Bloom, Relief, Outer Glow, Drop Shadow, Long Shadow, Contact Shadow, Backdrop Blur, Refraction, Reflection | Working | Renderer/editor tests pass; some effects intentionally export to PSD with compatibility notes |
| Core adjustments | Tone, Curves, Levels, HSL | Working | Context-specific editors and undo coalescing covered |
| Pro adjustments | Black & White, Color Balance, Photo Filter, Channel Mixer, Color Lookup, Gradient Map, Relight Field, Threshold, Posterize, Invert | Working | Correct pro editor route verified live |
| History | Linear undo/redo, branches, checkout, branch mix, project persistence | Working | Live shortcut state transition plus nonlinear history tests |
| Large alpha | Sparse selections and sparse layer masks | Working | 50K paint/feather/undo and viewport compositing tests pass |

## Native menu commands

The TypeScript model and Rust menu contain the same 24 ids in the same order. Unknown process-boundary payloads are rejected.

| Menu | Command | Status | Evidence / limitation |
| --- | --- | --- | --- |
| File | Open… | Partial | Native bridge, recent files, cold-start open and associations tested; real OS picker not exercised from localhost |
| File | Save | Partial | Dirty cursor and remembered native path tested; real OS write not exercised from localhost |
| File | Save As… | Partial | New-path behavior tested; real OS picker not exercised from localhost |
| File | Export… | Working | Shortcut opens the live dialog; all choices selectable; encoders tested |
| Edit | Undo | Working | Live state transition and engine history |
| Edit | Redo | Working | Live state transition and engine history |
| Edit | Version History… | Working | Command route and history graph tests |
| Layer | New Layer | Working | Native command mapping and structural history |
| Layer | Group Layer | Working | Native command mapping and group engine tests |
| Layer | Delete Layer | Working | Native command mapping and layer lifecycle tests |
| Layer | Bring Forward | Working | Native command mapping and reorder tests |
| Layer | Send Backward | Working | Native command mapping and reorder tests |
| Layer | Layer Style… | Working | Native command mapping and layer-style editor/renderer suite |
| Layer | New Curves Adjustment | Working | Live command-palette route and native mapping |
| Layer | New Levels Adjustment | Working | Live command-palette route and native mapping |
| Layer | New HSL Adjustment | Working | Added and exercised live in this audit |
| Select | All | Working | Live shortcut and sparse selection engine |
| Select | Deselect | Working | Live shortcut and sparse selection engine |
| Select | Inverse | Working | Native mapping and sparse invert tests |
| Select | Subject | Partial | Command is wired; model/real-image dependency remains |
| View | Zoom In | Working | Live zoom transition and native mapping |
| View | Zoom Out | Working | Live zoom transition and native mapping |
| View | Fit on Screen | Working | Live zoom transition and native mapping |
| View | Actual Size | Working | Live zoom transition and native mapping |

## Keyboard and Space behavior

| Shortcut family | Status | Evidence |
| --- | --- | --- |
| Cmd/Ctrl+E and Escape | Working | Export opens and dismisses live |
| Cmd/Ctrl+K and Escape | Working | All Tools opens and dismisses live |
| Cmd/Ctrl+A, Cmd/Ctrl+D, Cmd/Ctrl+Shift+I | Working | Selection routes and engine operations |
| Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z | Working | Live selection-state undo/redo transition |
| Cmd/Ctrl+O, Cmd/Ctrl+S, Cmd/Ctrl+Shift+S | Partial | Native command/bridge tests; OS dialogs not invoked in localhost harness |
| Cmd/Ctrl+Shift+N, Cmd/Ctrl+G, Cmd/Ctrl+[ and Cmd/Ctrl+] | Working | Native mapping; modifier fall-through into tools/brush size fixed and live-regressed |
| Cmd/Ctrl+Plus, Cmd/Ctrl+Minus, Cmd/Ctrl+0, Cmd/Ctrl+1 | Working | Native mapping; equivalent live view transitions verified |
| Bare 0, 1, +, - | Working | Live 155% → 100% → 120% → 100% transitions |
| [ and ] | Working | Tool-dependent brush/capture radius path |
| Workspace letter shortcuts | Working | All 56 tools expose their resolved workspace shortcut; conflicts are workspace-scoped/customizable |
| Space tap / hold / pin | Working | Representative tool decks, pan handoff, pin/close and 1–4 commands verified |
| Escape in Filters and Batch | Working | Missing handlers found and fixed in this audit; Batch stays protected while a job is running |

## Import matrix

| Input | Status | Evidence / limitation |
| --- | --- | --- |
| `.luma` | Working | v1 compatibility and v4 document/assets/precision/history round trips |
| PSD | Partial | 6/6 local real projects pass open → edit → native reopen → PSD reopen with zero preview drift; 50-file RC corpus is still incomplete |
| PSB | Partial | 2/2 local real projects pass the same workflow, including layered and bounded-composite modes; broad corpus remains incomplete |
| PNG | Working | Bounded header preflight and raster engine paths |
| JPEG/JPG | Working | Bounded header preflight and raster engine paths |
| WebP | Working | Bounded header/export encoding and raster engine paths |
| GIF, BMP, TIFF | Partial | Accepted for layers/brush capture with bounded header support; platform decoder corpus not run |
| DNG | Partial | Real sensor decode path exists for supported TIFF/DNG CFA layouts; camera corpus incomplete |
| CR2, NEF, NRW, ARW, ORF, RW2, PEF | Partial | Local TIFF-CFA attempt, then macOS camera codec or clearly tagged embedded preview |
| CR3, RAF | Partial | macOS camera codec or clearly tagged embedded preview; no general local sensor decoder |
| `.luma-plugin` | Working | Bounded declarative package parser, install/uninstall and malformed-input tests |
| Clipboard image | Partial | Import route exists; depends on OS permission and was not exercised in localhost |
| Canvas drag-and-drop | Working | Documents replace the document; images become fitted layers |
| Batch drag-and-drop | Working | Routes to the Batch queue and filters to PNG/JPEG/WebP |

## Export matrix

| Output | Status | Evidence / limitation |
| --- | --- | --- |
| `.luma` project | Working | Document, assets, precision surfaces and nonlinear history reopen |
| PNG | Working | Real signature/bytes; streamed large-document PNG covered |
| JPEG | Working | Real signature/bytes; intentionally refused past the safe canvas ceiling |
| WebP | Working | Real RIFF/WEBP bytes; intentionally refused past the safe canvas ceiling |
| PSD | Partial | Editable adjustments/text/vector/smart-object metadata and narrow native 16-bit path tested; known compatibility notes remain |
| PSB | Partial | Explicit container and narrow native 16-bit path tested; real-project corpus remains incomplete |
| Batch ZIP | Working | Per-file isolation, success/failure report and worker disposal tested |
| Artboard raster | Working | PNG/JPEG/WebP path and large-artboard safe refusal rules tested |

## Failure-path matrix

| Failure path | Status | Expected behavior / evidence |
| --- | --- | --- |
| Hostile `.luma` path, oversized entry or expansion bomb | Working | Rejected before decode/allocation |
| Corrupt recovery snapshot | Working | Import rejects without replacing or damaging the open document |
| Oversized or malformed raster | Working | Header dimensions rejected before browser pixel allocation |
| Malformed PSD/PSB sections | Working | Bounded parser rejects before `ag-psd` |
| PSD/PSB layered decode estimate above 2 GiB | Working | Opens the bounded document composite when that fits; otherwise refuses before codec allocation. Untouched source bytes remain available for exact passthrough |
| Unsupported RAW without a readable preview | Working | Explicit decode error; no false “developed RAW” claim |
| RAW with only embedded preview | Working | Opens with preview provenance and typed sensor-decode failure |
| Unsafe/malformed plugin package | Working | Bounded parser rejects it; partial registration is rolled back |
| One failed Batch file | Working | Remaining files continue and failure is reported |
| AI authentication, network failure or cancellation | Working | Typed failures and abort behavior are tested |
| Sparse-alpha memory ceiling | Working | Fails before crossing the ceiling; bounded tile diffs protect undo |
| Large JPEG/WebP export | Working | Explicit safe refusal; streamed PNG remains available |
| Unsaved tab/document close | Working | Dirty documents require Save / Don’t Save / Cancel |
| Unsaved native window quit | Partial | Native close interception is implemented/tested; clean installed-app campaign remains pending |
| Unsaved update/restart | Working | Update refuses dirty tabs, re-checks after network I/O, checkpoints the workspace, then locks editing before install |

## Defects found and fixed in this audit

| Defect | Before | Resolution |
| --- | --- | --- |
| Manual Selection panel | Inspector resolved to `selection`, but the section was gated by the Select workspace and rendered blank elsewhere | Mount from `contextualPanel === "selection"`; live and regression-tested |
| HSL desktop access | Real HSL editor existed, but its only entry point was a compressed Layers-header icon | Added HSL to the All Tools command surface and native Layer menu; live route verified |
| Native accelerator fall-through | Cmd/Ctrl menu chords could also activate a letter tool or change brush size | Modifier chords now stop before canvas/tool-only shortcuts; live and structural regression |
| Filters/Batch Escape | Filters advertised `esc`, but neither Filters nor Batch had a matching dismissal branch | Added safe Escape dismissal; Batch remains non-dismissible while processing |
| Demanding PSD/PSB import | Valid real projects with 5–11.5 GiB layered-decode estimates were rejected even though their composites fit safely | Added an automatic composite-only decode plan under the same 2 GiB ceiling, explicit preview-only warnings, and exact untouched-source passthrough |
| Short-window inspector | A 720px-high desktop window let Layers and Properties consume nearly the whole rail | Rebalanced the final desktop media rule so contextual editors retain useful space; verified in the rebuilt 1280×720 workspace |
| Icon-only command names | Layer creation/reordering, Focus pins, Actions and two reset controls had weak or unstable assistive names | Added explicit, stable accessible labels and a source regression test |
| Local updater startup abort | Registering the updater plugin without a config object caused the packaged app to abort during native startup | Local builds now carry an explicitly empty inert config; the validated release overlay replaces it with the real HTTPS endpoint/key |
| Release build leaked development metadata | Localhost CSP/dev URL and absolute build-home paths were embedded in the packaged executable | Development Tauri config is isolated; release builds remap the build home and the bundle audit rejects either leak |
| Update could restart over unsaved work | A naive updater install could bypass the close-confirmation path | The UI refuses dirty work before and after the check, checkpoints all documents, and blocks edits during verified installation |

## Remaining release gaps

`npm run release:status` currently passes 4 of 10 evidence gates:

- Passed: P0 checkpoint, sparse selections, sparse masks, recovery/destructive tests.
- Failing: the required 50-project PSD/PSB/RAW corpus (local evidence is now 6/6 PSD and 2/2 PSB), production updater endpoint/key and its failure campaign, Apple signing/notarization report, production crash receipt/symbolication, and clean-machine installation. Updater runtime and crash ingestion are implemented; infrastructure evidence is not.
- Large-document and native-RAW capabilities remain intentionally marked `planned` in the edition registry. Sparse alpha is complete, but all supported workflows must stay inside defined ceilings before either claim changes to shipped.
- The 23.6 MB ONNX Runtime WASM and 550 KB Transformers chunk remain lazy rather than startup-loaded, but they are still a meaningful installed-size cost for local neural features.

## RC decision

The tested desktop surface has no remaining Broken or Inaccessible entry after these fixes. It is not yet an external Release Candidate because the Partial rows are concentrated in the highest-risk professional boundaries: real PSD/PSB/RAW projects and native distribution. The next work should remain validation-only: build the compatibility corpus, finish updater/signing/crash evidence, and run clean-machine destructive/recovery sessions.
