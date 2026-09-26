# Vector creator foundation — first implementation increment

This is a bounded first increment toward the requested professional vector,
typography, 3D and production workflows. It is **not Illustrator/Affinity parity**.

## Implemented

- A path can contain multiple closed/open contours. Non-zero and even-odd fill
  rules drive the canvas renderer, vector-mask rasterization and SVG output.
- Control-hull bounds include handles and secondary contours. GPU cache keys no
  longer round away small path edits or omit compound contours.
- Unite, subtract, intersect and exclude use Paper.js curve booleans in a lazy
  worker. There is at most one active worker and a five-second deadline. Inputs
  have a 512-anchor combined budget; output is limited to 4,096 anchors/256
  contours. These are complexity/time limits, **not a measured hard worker-RAM cap**.
- New construction retains the two source layers, hides them, and inserts the
  result in one undo operation. Inputs must be unlocked, ungrouped vector layers
  without strokes or non-unit layer opacity. Results use the first operand's paint.
- Saved recipes retain operand geometry and fill rules. Users can change the
  operation or expand to ordinary contours. Recipes are snapshots: editing the
  original hidden layers does **not** automatically update the result. There is
  no operand-node editor inside the recipe yet.
- Direct selection can edit anchors in secondary contours after expansion.
  Locked paths and unexpanded boolean recipes refuse anchor editing.
- The registered vector panel contains construction, fill-rule, fill/stroke and
  selected-vector SVG export controls. Menus use the same export implementation.
- Geometry and recipe storage are billed conservatively to the history budget.
- Project format advances to v6. The reader still accepts v1–v5. Older apps reject
  v6 rather than quietly opening a compound shape with missing contours.

## Delivery boundaries

SVG export preserves cubic paths, holes, layer ordering, affine transforms,
solid fills/strokes and opacity. It supports sRGB/8-bit source documents only.
Every visible layer is checked. Raster/text/group layers, clipping, masks,
effects, advanced blending and spatial presentation block whole-document export.
Selected-vector export is explicit and does not claim to include other layers.
Rounded rectangles are currently refused; ordinary rectangles and cubic ellipse
approximations are supported. This is not arbitrary SVG import or AI interchange.

PDF export is lazy-loaded and writes actual vector operators. It uses document
PPI for physical dimensions, caps pages at 200 inches and payloads at 10,000
anchors, and currently accepts opaque hex colors/unit layer opacity only. It is
DeviceRGB output without an embedded output profile: **not PDF/X, CMYK, spot-color,
press-certified output, or a round-trip Luma project**. Unsupported cases fail
before a file is handed to the save dialog.

PSD vector masks now carry all result contours and fill rules; the existing
PSD regression suite passes. This does not certify Photoshop corpus fidelity.
Form spatial export refuses compound contours until the receiving application
supports them, instead of exporting a misleading first-contour-only object.

## Evidence

- Full existing + new suite: 788 tests passed, zero failed (92.5 seconds). Later
  focused additions extend coverage for geometry history accounting, non-zero
  winding and a seeded rectangle corpus. Independent PDF pixel testing needs
  Poppler; the test explicitly skips when it is unavailable rather than
  misrepresenting same-library parsing as independent rendering.
- Final focused vector/history/path run: 32 passed, zero failed/skipped, including
  Poppler. TypeScript, targeted ESLint and diff-whitespace checks passed.
- Independent SVG rasterization through the canvas harness checks holes and
  transformed strokes. Poppler rasterization of generated PDF checks an opaque
  region and hole, plus PDF reparsing/physical page dimensions.
- In the running localhost desktop-shell preview, drew two paths, selected the
  second operand, ran subtraction through the worker, observed a six-anchor
  result and retained hidden originals, then verified Undo and Redo via UI.
- Desktop frontend and Sites/SSR builds passed. This does not mean the installed
  macOS bundle has been rebuilt, signed, installed or notarized.
- Broad three-size visual regression and native packaged UI verification are
  still pending. The new panel was inspected in the current narrow preview.
- Dependency installation reports 20 audit findings (6 moderate, 13 high,
  1 critical). This pass does not remediate or waive those release risks; no
  blanket/force dependency updates were applied.

## Synthetic performance baseline

`npx tsx build/benchmark-vector-workflows.ts` creates 100 local vector objects
(6,400 anchors), runs ten 128-anchor boolean unions, and serializes SVG. It does
not allocate a canvas matching document dimensions.

| Canvas | Median union | SVG export | Process peak RSS |
| --- | ---: | ---: | ---: |
| 10K square | 4.91 ms | 13.60 ms | 96.84 MiB |
| 25K square | 3.07 ms | 11.30 ms | 116.42 MiB |
| 50K square | 2.11 ms | 9.01 ms | 119.13 MiB |

One sequential, warmed process; RSS is cumulative process high-water mark, not
per-operation memory. Outputs were about 1.40 MB. This is **not a dense-image,
GUI-latency, real-project, Affinity or Illustrator benchmark**.

## Remaining requested program

| Campaign | Remaining acceptance work |
| --- | --- |
| Vector construction | Offsets, joins/caps UI, editable operand nodes, shape-builder interaction, robust import corpus, precision snapping coverage |
| Reusable appearance | Vector fill/stroke stacks, styles, symbols/instances, patterns and editable blends |
| Typography | Unified shaping/OpenType pipeline, complex scripts, outlined export fidelity, reusable paragraph/character styles |
| Live 3D | Real scene-layer rendering/cache, persistent camera and geometry source, edit/reopen/export parity, Form round-trip protocol |
| Interchange | SVG/PDF import preserving editable structure; richer export without silent loss; external application corpus |
| Print/color | ICC-tagged delivery, CMYK/spot workflows, PDF/X and independent preflight/reference charts |
| Reliability | Real illustration/poster/composite jobs, measured peak allocations, matched-hardware Affinity benchmark, crash/reopen tests |

No score or parity claim should increase solely because these controls exist.
Each campaign needs its own correctness and resource-bound acceptance evidence.
