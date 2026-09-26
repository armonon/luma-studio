# GIMP / Luma matched-workflow qualification

## Scope

This campaign proves supported jobs rather than adding tools or assigning a product score.
Local engine regressions are not native GUI benchmarks. Synthetic fixtures are not a
representative professional corpus. An uninstalled competitor has no result—not a zero.

## Changes in this pass

- `npm run benchmark:matched -- luma.json competitor.json` accepts retained GUI evidence
  for GIMP, Affinity or Adobe Photoshop using `build/matched-workflow-evidence.ts`.
  The older `benchmark:compare` Affinity v1 checker remains a legacy diagnostic;
  it is not the new qualification standard.
- Identify both application builds, Luma's source fingerprint, exact input, exact job
  protocol, independent reference, machine, display and acceleration settings.
- Declare at least one warmup and five planned measured runs. Each successful run must
  include at least three native save/reopen cycles, stage timings, peak process RSS,
  and passing visual/editable-structure checks. Retain separate per-run timing, memory,
  native project, reopened project, export and fidelity artifacts. Hash the files.
- Failed and incomplete runs remain visible. They produce no performance ratios.
  Never drop a failed run to improve a median. Missing capability is a job failure,
  not permission to substitute a flattened result.
- Evidence ingestion streams regular files, bounds manifest reads, checks hashes,
  rejects directory escapes/symlinks outside the evidence directory and rejects
  different roles aliasing the same file. Hashes prove byte identity, not authenticity
  of the timing or visual judgment; retain independent review.
- The corpus runner now records load and memory observations throughout each worker.
  It refuses timing qualification when either one-minute or five-minute load exceeds
  1.5 per logical CPU. The threshold is campaign admission, NOT a process-RAM ceiling.
  It does not stop other processes or raise existing workflow limits. Windows load
  probing is unsupported and must not be represented as measured zero load.
- Reports now bind the exact manifest and actual input-file hashes. Old reports without
  these and host observations cannot qualify the new gate. Interrupted/changed/partial
  results continue to fail closed.
- Added six repeated source-backed edit/save/reopen cycles across tile seams and image
  edges, restored undo/redo, decoded recovery content, shared-source preservation,
  alternating PSD/PSB export, corrupt-open protection and unsupported-export rollback checks.

## Matched job protocol

Use user-approved retained projects, not generated triangles, for the four main jobs.
Do not overwrite originals. Give each application its own output directory.
Hash the detailed protocol and independent reference alongside the input.

| Job | Required work | Fidelity evidence |
| --- | --- | --- |
| Photo composite | Open layered input; select/refine an object; masked paint; move a layer; adjust color; undo/redo; three save/close/reopen cycles; export | Layer hierarchy, alpha edges, masks, color profile, edited pixels and independent rendered comparison |
| Poster | Mixed-script text, fonts, editable text effects, images and shapes; transform; undo/redo; native cycles; raster/PDF delivery | Glyph joining/order, font identity/substitution, text editability, geometry and output appearance |
| Illustration | Paths, compound geometry, fill/stroke, transforms and reusable objects; native cycles; SVG/PDF delivery | Editable structure and fill rules; list unsupported operations without silently rasterizing |
| Panorama | Real dense 10K/25K/50K inputs where admitted; local selection/mask/paint; zoom/pan; native cycles; export | Peak process RSS, input-to-present latency, seams, image dimensions, pixels and safe refusal outside supported bounds |

For each: one warmup then five measured GUI runs, identical machine/display/power
settings and inputs. Record open-to-usable, move-to-present, undo, save, reopen and
export timing separately. Define whether the save/reopen metric is the first cycle
or the total of three in the shared protocol; never mix definitions. Keep cold startup
separate. Observe the whole relevant process tree, not only accounted engine tiles.

Capture host samples during each run, not just before launching. Do not infer p95/p99
from five runs; the checker reports medians and observed maxima. For latency tails,
retain a separate adequately sampled input-to-present trace.

## Additional qualification, not competitor timing

1. Complete the retained eight-case PSD/PSB campaign on a quiet host without changing
   its 3072 MiB / 120-second limits. Then expand to 50–100 independent real projects,
   including RAW cameras and external reference renders.
2. Finish the native feature/visual matrix, tablet strokes and long sessions. Headless
   save/reopen tests do not prove the packaged app's canvas or dialogs behave correctly.
3. Exercise signed upgrade, interrupted upgrade, invalid signature, offline retry,
   consented remote crash receipt/symbolication and two clean-machine installs.
4. Keep print output NOT_CERTIFIED until a printer/RIP, ICC and PDF/X specification
   and independent preflight/proof evidence exist.

## External prerequisites

GIMP was not found in `/Applications` at the start of this pass. Installation approval
has been requested; no competitor measurements have been generated. Camera projects,
independent reference renders, production updater/crash configuration, Apple release
credentials and clean test machines remain prerequisites for their respective gates.

No GIMP performance victory, certified print delivery or production-ready release is
established by this implementation. See the turn's final verification results and the
source-matched JSON reports for what actually ran.

## Verification in this pass

Source fingerprint: `9f577d806d6ebf7648932aff1ab4ec414e8fa55beacb20df7f0ea5d81eabcdc2`.

- `npm run qualify:local`: 1,013 application tests, 10 native-bridge tests and
  9 native-core tests passed; TypeScript and ESLint passed; source unchanged.
  Receipt: `artifacts/local-hardening-report.json`.
- `npm run desktop:build`: passed. Existing browser-externalization, ineffective
  dynamic-import and large-chunk warnings remain. This is a frontend build, not a
  signed/notarized installed-app qualification.
- `git diff --check`: passed.
- Retained eight-case campaign attempted with unchanged 3072 MiB / 120-second
  workflow ceilings: **blocked before any worker ran**. The host probe reported a
  maximum short/medium load of 40.63 across eight logical CPUs. Receipt:
  `artifacts/gimp-qualification-corpus.json`. The previous primary compatibility
  report was preserved. This attempt is neither eight passes nor eight failures.
- Release checker: 4/10 gates; compatibility, updater configuration/failure testing,
  notarization, remote crash collection and clean-machine installation remain unqualified.
- No competitor app was installed, user project replaced, commit pushed or release
  deployed. The new tests/checkers do not establish a speed improvement in the engine.
