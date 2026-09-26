# Luma Studio versus Photoshop — September 23, 2026

## Verdict and scope

Luma is a capable RGB image-editor alpha with substantial implemented tools and
some distinctive workflows. It is not yet a general professional Photoshop
replacement. The central gap is the depth, interoperability, and qualification of
whole workflows—not the number of named controls.

My qualitative assessment is roughly **5/10 as a full Photoshop replacement**,
and **6–7/10 for selected RGB compositing/design workflows**. These are editorial
assessments, not measured feature-coverage percentages or performance benchmarks.
The narrower score assumes a supported document, locally available resources, and
an ordinary raster delivery target. Neither rating certifies production use.

This review maps the major capability families in Adobe's current desktop help,
Camera Raw documentation, developer documentation, and dated product updates. It
does not claim that every parameter, third-party plugin, beta, historical feature,
or operating-system combination has been exercised. Photoshop desktop is the
primary comparison; cloud, mobile, and ecosystem capabilities are identified
separately. Adobe's beta/discontinued capabilities are not counted as stable
desktop features.

Luma evidence: direct inspection of registries, implementation boundaries and
tests in the current working tree, plus source-matching qualification reports.
Source fingerprint: `47112c06a12b2d767869ac6468b5c551b7a07f05e44c09d7fb47b9ae5189d20b`.
No application changes or new exhaustive GUI campaign were performed for this
comparison. The shell skill was used to distinguish registry presence from
verified native interaction.

Status language:

- **Implemented:** meaningful implementation and local regression evidence;
  not a claim of Photoshop equivalence.
- **Partial:** concrete scope/control/format limits remain.
- **Unproven:** implementation exists but the necessary comparative or external
  validation is absent.
- **Not found:** no corresponding complete workflow was located in the inspected
  source; this is not a claim that an equivalent result cannot be made manually.

## Inventory: count like with like

| Luma inventory | Count / scope |
| --- | --- |
| Registered tools | 56 |
| Tool workspace categories | 8 |
| Registered dock/context panels | 21 |
| Layer blend operators | 27 |
| Blend passes per layer | Up to 8, independently enabled and weighted |
| Layer-effect types | 17 |
| Smart-filter types | 15 |
| Adjustment families | Tone, Curves, Levels, HSL, plus 10 pro-adjustment kinds |
| Bundled fonts | 14 families / 30 declared faces, plus installed-font discovery |

Sources: `app/studio/tool-registry.ts`, `panel-registry.tsx`,
`app/engine/document.ts`, `filters.ts`, `pro-adjustments.ts`, and
`bundled-fonts.ts`.

There is no useful single Photoshop count to compare with 56: toolbar variants,
commands, filter families, presets, camera profiles and plugins are different
units. Photoshop's layer-effect reference lists ten primary effect families;
Luma having seventeen names does not establish greater parameter depth or better
rendering. Photoshop also has context-specific blending behavior, so 27 Luma
operators must not be advertised as all blending behavior in every Photoshop
context. [Adobe layer effects](https://helpx.adobe.com/photoshop/desktop/create-manage-layers/apply-layer-effects/layer-style-effects-and-options-overview.html)

### Every registered Luma tool

| Group | Tools |
| --- | --- |
| Edit (9) | Move, Brush, Capture Brush, Pencil, Mixer brush, Erase, Gradient, Pattern, Fill |
| Retouch (12) | Clone stamp, Healing brush, Spot healing, Patch, Remove, Dodge, Burn, Blur, Sharpen, Smudge, Sponge, Liquify |
| Select (8) | Rect marquee, Ellipse marquee, Lasso, Polygonal lasso, Magnetic lasso, Quick selection, Magic wand, SAM click-select |
| Mask (2) | Reveal, Hide |
| Develop (1) | Tone |
| Type/vector (15) | Text, Paragraph text, Vertical text, Type on path, Type mask, Rect, Ellipse, Triangle, Polygon, Line, Custom shape, Frame, Pen, Path selection, Direct selection |
| Transform (6) | Crop, Perspective crop, Straighten, Content-aware move, Perspective warp, Radial warp |
| Measure (3) | Eyedropper, Color sampler, Ruler |

Pan/zoom and other commands need not be separate registered tool IDs. Conversely,
a registered ID is not proof of a fully qualified native workflow.

## 1. Workspace, documents and everyday editing

Photoshop provides configurable workspaces, panels, contextual controls, document
arrangement, shortcuts, history and tool presets. These are systems, not isolated
buttons. [Adobe desktop feature index](https://helpx.adobe.com/photoshop/desktop.html)

| Capability | Luma assessment |
| --- | --- |
| Docked/floating panels, grouping, layout persistence | Implemented infrastructure; sampled UI evidence, not comprehensive native/multi-monitor qualification |
| Contextual properties and tool options | Implemented, including adjustment-specific routing and the Space deck; recent routing fixes are regression-covered |
| Menus, command palette, shortcuts | Central registries and dispatch tests; not all commands freshly exercised in installed WebKit |
| Document tabs, per-document view/selection/history | Implemented with ownership guards and regression coverage |
| Save, Save As, native paths, dirty close/quit | Implemented/hardened; not proven lossless under every disk-full, crash and OS event sequence |
| Undo, redo, snapshots/branches | Implemented nonlinear history and branch mixing; professional-session endurance remains unproven |
| Cut/copy/paste, cross-app images | Engine and native bridge/failure tests exist; full app-to-app clipboard matrix remains incomplete |
| Accessibility, HiDPI, multiple monitors, localization | Partial/unqualified at product scope; three visual references do not establish complete UI quality |
| Independent native document windows | No qualified Photoshop-style multi-window arrangement workflow found |

Important retained gap: `tests/visual-regression/manifest.json` still lists seven
future reference states: empty, multiple documents, floating panel, collapsed
rail, brush, text and active transform.

## 2. Layers, blending, masks, channels and Smart Objects

Photoshop distinguishes editable embedded/linked source content from a transformed
rendered layer. It also exposes independently editable alpha/spot channels and
cross-channel calculations. [Smart Objects](https://helpx.adobe.com/photoshop/desktop/create-manage-layers/smart-objects/smart-objects-overview-and-benefits.html),
[channels](https://helpx.adobe.com/photoshop/using/channel-basics.html),
[Apply Image and Calculations](https://helpx.adobe.com/photoshop/using/channel-calculations.html).

| Capability | Luma assessment |
| --- | --- |
| Raster/vector/text/adjustment layers, hierarchy, multiselect, grouping and merging | Implemented; group and transactional failure regressions exist |
| Opacity, fill opacity, Blend If, clipping, knockout, channel restrictions | Broad implementation; exhaustive Photoshop golden-image equivalence is unproven |
| Multiple blend passes on one layer | Distinctive direct workflow; similar outputs can often be constructed with multiple Photoshop layers |
| Raster and vector masks, feather/invert/paint | Implemented sparse-alpha infrastructure; imported source-backed Photoshop masks remain a separate qualification gap |
| Layer styles | Broad implementation with 17 effect types; export of Luma-specific effects can require compatibility treatment |
| Layer comps/artboards/frames | Implemented narrower workflows; Luma caps comps at 64 and artboards at 128; do not assume equivalent semantics or export behavior |
| Smart filters | Editable stack exists, but the available filter catalogue is much smaller |
| Smart Object content editing/replacement | Partial: replacement is limited to 4 MP, 8-bit, non-RAW, raster-backed Luma objects; Photoshop embedded/linked content is preserved, not rewritten |
| Linked asset update/relink/package workflows | No full qualified Photoshop-equivalent source-asset lifecycle found |
| Channels panel | Preview-only RGB/R/G/B/alpha selector, not an editable channel document model |
| Named alpha/spot channel workflows, Apply Image, Calculations | No complete equivalent located |

Key evidence: `smart-object-content.ts:10`, `panels/operational-panels.tsx:9`,
`psd.ts:1299`, and `document.ts`.

## 3. Selections, extraction and retouching

Photoshop's selection surface includes object/subject tools, one-pixel marquees,
color selections, refinement and person-part selection. Select People distinguishes
features such as skin, hair and eyebrows. [Selection tools](https://helpx.adobe.com/photoshop/desktop/make-selections/get-started-selections/selection-tools-overview.html),
[Select People](https://helpx.adobe.com/photoshop/desktop/make-selections/automatic-color-based-selections/make-precise-selections-using-select-people.html).

| Capability | Luma assessment |
| --- | --- |
| Marquee/lasso/polygon/magnetic/wand/quick selection | Implemented; exact Photoshop interaction and edge-result parity unproven |
| Sparse combination, inverse, feather, selection-to-mask and pixel edits | Implemented with regression coverage |
| Subject/background matting and SAM click selection | Local model infrastructure exists; model availability, native cold start and real-image accuracy require qualification |
| Select People/body-part labeling, automatic mask-all-objects | No complete equivalent located |
| Difficult hair, translucent fabric, glass and low-contrast extraction | No sufficiently broad matched ground-truth/Photoshop evidence; cannot call Smart Select perfect |
| Clone/heal/spot heal/patch/remove/dodge/burn/sponge | Implemented algorithms; quality parity on varied real photographs remains unproven |
| Content-aware move | Implemented bounded workflow; not proof of Photoshop-quality fill/reconstruction |
| Dedicated Content-Aware Fill sampling workspace, automatic wire/distraction removal | No comparable complete workflow located |
| Red-eye, Background Eraser, Magic Eraser, History Brush, Art History Brush | No dedicated registered tools/equivalent complete workflows found |
| Vanishing Point perspective-plane painting/cloning | Perspective warping is not equivalent; no matching editing workspace found |

Photoshop's Vanishing Point explicitly makes paint/clone/paste operations conform
to planes; that is more than a quad warp.
[Adobe Vanishing Point](https://helpx.adobe.com/photoshop/using/vanishing-point.html).

`tests/selection-accuracy.test.ts` tests metrics and evidence policy. It is not a
large real-image accuracy campaign.

The inspected float retouch replay makes the depth gap particularly concrete:
local Remove/Spot Heal use neighborhood averaging; Heal/Patch apply a luminance
correction to the sampled source; Liquify uses displaced sampling. These are not
the same algorithmic scope as context-aware reconstruction or Photoshop's full
Liquify workspace. This describes `retouch.ts`, not the separate remote generative
Remove operation.

## 4. Painting and brushes

Photoshop supports detailed brush dynamics and a Mixer Brush reservoir/pickup
model. Its image sampling means an image-derived brush is not, by itself, a new
industry invention. [Brush dynamics](https://helpx.adobe.com/photoshop/using/adding-dynamic-elements-brushes.html),
[Mixer Brush](https://helpx.adobe.com/in/photoshop/using/painting-mixer-brush.html).

Luma implements pressure curves, tilt influence, smoothing, spacing, scatter,
roundness, angle, texture, flow/build-up, symmetry, captured tips and tile replay.
Captured tips support color/tint/stencil/material modes. This is substantial.

However, `BrushBlendMode` contains only normal/multiply/screen/overlay. Layer
blending breadth does not imply painting-mode breadth. Photoshop-style dual/bristle
brush depth, ABR import fidelity, broader dynamic controls, mixer behavior, and
actual tablet latency/tilt qualification are not established. Captured tips are
bounded to a 512-pixel edge and 32 document assets.
The float Mixer replay blends toward the brush color; it does not implement the
reservoir/pickup state described in Adobe's Mixer Brush documentation.

## 5. Adjustments, filters and effects

Luma's core adjustment families are Tone, Curves, Levels and HSL. Its additional
kinds are Black & White, Color Balance, Photo Filter, Channel Mixer, Color Lookup,
Gradient Map, Relight Field, Threshold, Posterize and Invert.

Matching labels conceal concrete differences:

- Black & White exposes amount/tint/tintAmount rather than Photoshop's
  color-dependent grayscale mixing.
- HSL's core model is global hue/saturation/lightness, not a full targeted color
  range editor.
- Color Lookup is four coded looks, not general creative LUT-file loading.
  This is separate from Luma's ICC LUT parser.
- Gradient Map exposes two endpoint colors, reverse and smoothness, rather than
  the full arbitrary-stop creative gradient workflow.
- Relight Field is a spatial adjustment, not evidence of scene-aware lighting.
- Selective Color, Match Color and broad Photoshop adjustment-preset equivalence
  were not found as complete workflows.

[Adobe Black & White](https://helpx.adobe.com/au/photoshop/desktop/adjust-color/color-effects-techniques/convert-a-color-image-to-black-and-white.html),
[Color Lookup](https://helpx.adobe.com/ph_fil/photoshop/how-to/edit-photo-color-lookup-adjustment.html),
[LUT output](https://helpx.adobe.com/ca/photoshop/using/export-color-lookup-tables.html),
[Selective Color](https://helpx.adobe.com/in/photoshop/using/mix-colors.html).

**All 15 Luma smart filters:** Gaussian Blur, Motion Blur, Surface Blur, Unsharp
Mask, High Pass, Median, Dust & Scratches, Reduce Noise, Lens Blur, Displace,
Maximum, Minimum, Invert, Desaturate and Hue Rotate. Displace is a procedural wave
implementation, not arbitrary external PSD displacement-map support.

**All 17 Luma layer effects:** Bevel & Emboss, Stroke, Inner Shadow, Inner Glow,
Satin, Color Overlay, Gradient Overlay, Pattern Overlay, Bloom, Relief, Outer Glow,
Drop Shadow, Long Shadow, Contact Shadow, Backdrop Blur, Refraction and Reflection.

Photoshop's filter range also covers Artistic, Brush Strokes, Sketch, Texture,
Pixelate, Render and Stylize families, plus more advanced blur/sharpen/distortion
workspaces. Missing or materially incomplete equivalents include Blur Gallery,
Smart Sharpen, Camera Raw Filter, full Liquify/reconstruction/freezing, Puppet
Warp, and the broader Filter Gallery. Neural Lab does not establish equivalence
to Photoshop's Neural Filters catalogue.
[Filter reference](https://helpx.adobe.com/photoshop/using/filter-effects-reference.html),
[Filter Gallery](https://helpx.adobe.com/photoshop/desktop/effects-filters/get-started-with-filters/filter-gallery.html),
[Neural Filters](https://helpx.adobe.com/photoshop/desktop/effects-filters/neural-filters/overview-of-neural-filters.html).

## 6. Transforms, vector construction, layout and measurement

| Capability | Luma assessment |
| --- | --- |
| Move/rotate/scale/skew/distort, snapping and handles | Implemented; recent ownership/coordinate/transaction tests are meaningful |
| Crop, perspective crop, straighten, perspective/radial warp | Implemented bounded operations; not arbitrary-large-document certification |
| Puppet pins, split/cylindrical warp, full perspective-plane editing | No full equivalent found; a tool named Warp does not cover these |
| Pen, nodes/handles, path selection, shapes/custom shapes | Implemented |
| Freeform Pen / Curvature Pen interaction variants | No dedicated equivalents found; ordinary Bezier/node editing is not the same interaction |
| Compound geometry, booleans and offsets | Implemented bounded operations; boolean construction rejects non-opaque/stroked inputs outside its supported subset |
| Appearance stacks/reusable objects | Infrastructure exists; not blanket Illustrator-class functionality or interchange |
| Rulers, guides, snapping, color/length/angle sampling | Implemented |
| Scientific measurement logs, Count tool, DICOM workflows | No full equivalent found |
| Slice-based legacy web delivery | No corresponding complete workflow found |

Photoshop is itself not Illustrator; full Illustrator vector capability should not
be silently added to the Photoshop parity target. Conversely, Photoshop does
document specialized measurements and counting beyond ordinary rulers.
[Adobe Count](https://helpx.adobe.com/photoshop/using/counting-objects-image.html).
Adobe also distinguishes Freeform/Curvature Pen and anchor-editing tools;
equivalent node operations need not use separate Luma toolbar buttons.
[Drawing-tool inventory](https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/create-shapes/drawing-tools-overview.html).

## 7. Typography and editable 3D

Photoshop provides paragraph/character formatting, OpenType/variable fonts,
international text, glyph tools, path text and warping. Luma covers many of these
concepts, but coverage and rendering/export consistency remain partial.
[Unified Text Engine](https://helpx.adobe.com/photoshop/desktop/text-typography/international-text-languages/overview-of-unified-text-engine.html).

Luma has five text tool variants, style/run models, installed-font discovery,
14 bundled font families, HarfBuzz outlining, bidi support and editable lettering.
The outline path rejects vertical/path layouts, explicit bidi control characters,
mixed-style paragraph frames, and several decoration/appearance combinations.
Outline font-resource availability is narrower than ordinary system-font drawing.
Do not describe a font selector as proof of identical shaping across screen,
outlines, PSD, PDF and 3D.

Luma's live 3D is a differentiation opportunity, not just an inserted bitmap:
editable text/geometry/material/camera payloads and Form exchange exist. But the
text-mesh editor documents a 160-character limit and 1600×1200 render; mesh exchange
is capped at 8 MiB, 64 parts and 60,000 vertices. Arbitrary scenes, texture maps,
rigs, animation and unconstrained scene interchange are not established.

Importantly, legacy Photoshop 3D was removed in July 2024. The subsequent Substance
3D Viewer beta workflow was also discontinued in October 2025; stale Adobe help
banners still referring to it should not be mistaken for a current shipping
advantage. [Legacy removal notice](https://helpx.adobe.com/photoshop/kb/basic-troubleshooting.html),
[Viewer discontinuation](https://helpx.adobe.com/substance-3d-viewer/desktop/getting-started/substance-3d-viewer-decomission.html).

## 8. RAW photography, color and print

| Capability | Luma assessment |
| --- | --- |
| Bayer DNG/supported TIFF-CFA sensor development | Implemented subset with float master and development settings |
| Broad proprietary camera support | Partial: format acceptance is not sensor decoding; some inputs use embedded previews or native codec fallback |
| Camera/lens profiles, broad denoise and local-mask workflow | Not qualified against a representative camera/lens corpus |
| Panorama, focus stacking/Auto-Blend, HDR merge | No full integrated counterparts found |
| RGB working spaces and high-depth masters | Implemented, but not every operation/output retains the same precision |
| ICC matrix/TRC and supported three-channel LUTs | Implemented subset; device-link and other unsupported transforms are explicit boundaries |
| Accurate all-intent ICC behavior/black-point compensation | Partial; metadata explicitly identifies approximations and heuristic compensation |
| CMYK/Lab/spot/duotone/multichannel production | No equivalent end-to-end editing/output system; a generic CMYK proof is not a CMYK document |
| Monitor/HDR display and printer-specific proofs | Unqualified; no matched calibration/reference campaign |
| Certified print/PDF-X | Not certified; the print inspector explicitly says NOT_CERTIFIED |

Adobe maintains camera-specific support and Camera Raw enhancement workflows;
Photoshop also supports non-RGB document modes. These are substantially beyond an
extension allowlist or RGB soft-proof approximation.
[Camera support](https://helpx.adobe.com/in_hi/camera-raw/desktop/dng-and-file-formats/camera-raw-plug-supported-cameras.html),
[RAW enhancement](https://helpx.adobe.com/in/camera-raw/desktop/edit-and-enhance-images/sharpening-and-noise/enhance.html),
[color modes](https://helpx.adobe.com/photoshop/using/color-modes.html),
[photography automation](https://helpx.adobe.com/photoshop/using/ScriptUI.html).

Evidence: `raw.ts`, `raw-dng.ts`, `icc-profile.ts`, `color-management.ts`,
`vector-pdf.ts`, `print-readiness.ts`.

## 9. File compatibility, delivery and large projects

| Capability | Luma assessment |
| --- | --- |
| Native .luma save/reopen with history/assets | Implemented and hardened; external real-project qualification incomplete |
| PNG/JPEG/WebP export | Exposed in the current export dialog |
| Layered PSD/PSB interchange | Partial: preservation/fallback machinery is not arbitrary editable fidelity |
| 16-bit Photoshop writing | Supported only for eligible documents; otherwise explicit 8-bit conversion |
| 32-bit Photoshop writing | Not supported natively; compatibility export converts to 8-bit |
| SVG/PDF editable import | Strict supported subset; unsupported clipping/paint/operator cases are rejected rather than dropped |
| SVG/vector PDF export | sRGB/8-bit solid paths/shapes; grouped, masked, blended/effected content can be refused; not general document export |
| TIFF/EXR and broad professional format delivery | No equivalent complete exposed delivery set found in the current export UI |
| Asset/artboard/layer export variants and metadata | Partial scope; not all Photoshop delivery/preservation cases qualified |
| Huge sparse documents | Strong infrastructure; not a hard process-RAM ceiling or all-operations support |
| Dense large documents and scratch-disk endurance | Unproven; source-backed import still refuses masked cases and performance evidence is incomplete |

Photoshop's large-document workflow and format support have their own limitations;
supported dimensions are not a promise of instant editing. Likewise, Luma's
ability to create a 50K canvas is not proof it can import, fill, transform and
export any dense 50K composition.
[Adobe large documents](https://helpx.adobe.com/photoshop/desktop/save-and-export/save-files/save-large-documents.html),
[file formats](https://helpx.adobe.com/photoshop/desktop/save-and-export/export-files-to-different-formats/photoshop-file-formats-overview.html),
[performance guidance](https://helpx.adobe.com/photoshop/kb/optimize-photoshop-cc-performance.html).

No matched Photoshop speed benchmark was run. There is no evidence supporting
claims that Luma uses less RAM or outperforms Photoshop overall.

## 10. AI, automation, collaboration and adjacent workflows

| Capability | Luma assessment |
| --- | --- |
| Local subject/SAM model inference | Implemented paths; first-use model delivery/native runtime still need qualification |
| Cloud fill/remove/relight/harmonize | Authenticated integration and variation/provenance plumbing; not a proven live production service in this review |
| AI Upscale / Expand | Names overstate geometry behavior: the inspected path scales the result into the existing work region without resizing the document/canvas |
| Prompt reuse, variations, identity reference | Implemented metadata/control plumbing; identity consistency is not guaranteed |
| AI Assistant/markup editing/complete Neural Filters catalogue | No full matching workflows found |
| Actions, conditions and batch queues | Implemented finite action vocabulary; not all UI operations are recordable |
| Plugins | Installed packages are bounded declarative actions, not arbitrary Photoshop/UXP/native-plugin compatibility |
| Cloud documents, synchronized history, shared review/projects/libraries | No equivalent integrated product ecosystem found |
| Signed Content Credentials | Internal AI hashes/provenance are not a C2PA credential or identity signature |
| Video timeline, animation frames, tweening and video export | No complete equivalents found |
| Adobe Stock/Fonts/Bridge/Lightroom integrations | No corresponding full ecosystem; Luma's own fonts/assets/Form link are different capabilities |
| Cross-platform delivery | Shared web/desktop engine, but no evidence of Photoshop's full platform coverage and distribution qualification |

Adobe's August 27, 2026 announcement includes new lighting controls, masked prompt
editing, markup, dynamic text on shapes/paths and Stock integration. Its separate
AI Assisted Editor is explicitly beta, not stable parity credit. This means
comparison against Photoshop's older feature set would miss current developments.
[Adobe August update](https://blog.adobe.com/en/publish/2026/08/27/new-photoshop-innovations-bring-you-more-choice-control-at-every-stage-of-your-creative-process).

Adobe's extensibility, cloud documents, frame animation and Content Credentials
are documented separately. Credential functionality is itself labeled beta;
do not confuse it with Luma's internal edit log.
[UXP](https://developer.adobe.com/photoshop/uxp/scripting/),
[cloud documents](https://helpx.adobe.com/photoshop/using/manage-cloud-documents-photoshop.html),
[animation](https://helpx.adobe.com/photoshop/desktop/add-video-and-animation/create-animation-frames/create-frame-based-animations.html),
[Content Credentials](https://helpx.adobe.com/photoshop/desktop/save-and-export/metadata-content-credentials/use-content-credentials.html).

## Proof available versus proof missing

The current source matches the preceding green qualification: 1,029 application
tests, 10 native bridge tests, nine native core tests, TypeScript and lint. Those
tests prove their assertions, not 1,048 separately complete features.

The release checklist is still **4/10 evidence gates**, not a 40% feature score.
The latest forced-source-backed diagnostic completed three workflows, refused
two unsupported cases, interrupted another under host overload, and never reached
two PSBs. It is not a passing corpus or valid overall performance campaign.
Photoshop goldens, RAW coverage, clean machines, notarization, real signed update
failure tests and remotely symbolicated crashes remain incomplete.

## Where Luma can differentiate

1. Space-triggered tool controls and a deliberately focused desktop workflow.
2. Direct multi-pass layer blending with independent strengths.
3. Visible branching history and branch mixing.
4. Integrated color/material image-brush capture.
5. Editable 3D lettering and a bounded Form ecosystem.
6. Transparent local processing and explicit operation/resource limits.

These are product opportunities, not proof that Photoshop cannot achieve similar
results or that Luma's implementation is already superior.

## Highest-value parity work

1. Finish real-project interchange and safe large-document masked/source-backed
   workflows; preserve edits across native and external save/reopen cycles.
2. Complete release qualification, including native interaction, clean-machine
   testing, update failures, crash collection and notarization.
3. Build actual editable alpha/spot channels and Smart Object source workflows.
4. Deepen existing controls: targeted HSL/B&W, general LUTs, gradient maps, brush
   dynamics and supported filter parameters—not merely more names.
5. Prove selection/retouch quality against diverse labeled real photographs.
6. Qualify a coherent camera/ICC/print pipeline rather than broad unsupported
   professional-color claims.
7. Make Upscale/Expand perform the promised geometry changes transactionally, or
   keep their user-facing labels explicit about the current limitation.

Video, scientific imaging and the entire Adobe cloud ecosystem are real breadth
gaps, but need not precede a well-scoped, reliable RGB-editor release. A credible
launch can replace selected Photoshop jobs without claiming to replace everything.
