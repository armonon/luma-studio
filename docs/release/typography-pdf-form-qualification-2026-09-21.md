# Typography, PDF and Form qualification — 2026-09-21

Follow-up: see [the expansion report](typography-pdf-form-expansion-2026-09-21.md)
for mixed-style point lettering, real Form glyph exchange and rendered PDF import.
The results below describe the earlier checkpoint, not the final feature boundary.

This is a bounded engineering increment, not completion of professional typography,
general PDF editing, full Form scene round trips, print certification or Affinity parity.

## Implemented

- Shaped single-style, LTR paragraph lettering: word wrapping using HarfBuzz advances,
  document-anchor alignment, inter-word justification, paragraph spacing and explicit
  overflow/overlong-word refusal. Available through the existing Outline Text and 3D
  lettering editors. The 160-character/12,000-command geometry budget remains.
  Selecting Frame now initializes the actual dimensions shown by the controls;
  the previous UI displayed defaults without storing them in the document.
- Editable PDF page import through Open, native picker and document drop. A modal
  page chooser explains the limits. PDF.js parsing and vector conversion use disposable
  workers in production; all validation completes before installing a new document.
- PDF limits: 8 MiB source, 64 pages, one import at a time, 12-second parse/conversion
  deadline, 50,000 operators, 512 paths, 20,000 path commands, 32 graphics-state levels.
  Solid RGB fills, supported round strokes, curves, even-odd fills and safe form/group
  boundaries are handled. Unsupported text/images/clips/paint state/annotations refuse
  the whole import. Source colors become RGB; there is no CMYK editing promise.
- Form Studio now exposes **Export → Return Luma text source** for one selected
  imported Luma text object. Source text/styles and current local rotation/side material
  return in `.lumaformtext`. Luma Open imports this into a separate editable document,
  never overwriting a newer original. Source links no longer promise automatic updates.
- Form desktop return uses a dedicated native Save command with a 4 MiB admission
  limit, extension checking, temporary-file/rename write and uniquely named prior-file
  backup. Browser builds retain download export. Installed binaries were not replaced.
- Form input admission checks byte size before reading. Luma validates typography,
  font dimensions, runs, appearance entries, material/rotation and frame bounds before
  installation. The accepted return subset is smaller than the transport envelope:
  32,768 characters, 256 runs, 16 fills/strokes. Unsupported paragraph overrides/path
  text are refused, not stripped. Older source files without placement use defaults.
- Reproducible qualification generator: `npx tsx build/qualify-vector-delivery.ts`.
  Writes hashed sparse 10K/25K/50K SVG fixtures, an RGB PDF proof, Form source fixture,
  per-run local SVG timings, machine metadata and explicit missing-certification gates.

## Verification

- Final Luma regression suite: **832/832 passed**, no skipped or failed tests
  (62.75 seconds). This includes the PDF deadline and admission regressions.
- Final focused PDF, paragraph and Form tests: 24/24 passed, including a deterministic
  deadline/admission/document-safety test. Node's fake-worker dependency is warmed
  outside the parser unit-test deadline; production keeps the 12-second deadline and
  was separately tested with actual cold browser workers. An overloaded full rerun
  reached 830/831, failing only the then-unwarmed PDF dependency startup test.
- Form bridge focused suite: 5/5 passed, including return rotation/material and scale refusal.
- Cross-project check passed using Form Studio's actual parser and proxy constructor:
  Luma text → Form → rotation change → source return → editable Luma text → save/reopen,
  including stable exchange identity. Reproduce with
  `npx tsx build/verify-form-roundtrip.ts /absolute/path/to/sculptor-studio`.
- Production browser: Open → PDF page chooser → import → ten editable path layers;
  existing documents stayed open. Imported geometry visually agrees with the independent
  Poppler render of the generated proof (not a numerical color certification).
- Initial desktop frontend build passed; PDF parser/worker code is lazy-loaded.
- Subsequent production-browser check passed with both PDF parsing and geometry
  conversion in workers, without console errors. Form source Open produced a text layer.
- Native Rust admission test passed for SVG, PDF and Form source byte limits.
- Form's isolated native return module compiles against the project's real Rust
  dependencies; both admission and atomic replacement/backup tests passed (2/2).
  The complete Form binary and native Save dialog have not been exercised this pass.
- An overloaded-host qualification rerun hit the 12-second deadline and failed safely.
  This is recorded as a refusal, not a successful performance measurement.
- The final qualification rerun passed on the quieter host and refreshed
  `artifacts/vector-qualification/report.json`, including generated fixture hashes,
  local engine timings and independent PDF proof rendering. Print certification and
  the matched Affinity comparison remain explicitly unpassed gates in that report.
- Final source TypeScript and focused lint pass. The two build scripts are excluded
  by the repository's lint configuration; TypeScript covers them.
- Final desktop frontend build passed (2.13 seconds on the now-quieter host).
- Corrected web production build passed after removing a Node-only graphics fallback
  from the server-rendered dependency graph. Desktop frontend build passed.

## Unfinished boundaries

**Typography:** mixed-style HarfBuzz shaping, Bidi/script itemization, advanced line
breaking/hyphenation and one authoritative shaping engine for all 2D canvas/PDF text
remain. The ordinary text renderer has not been replaced by this outline workflow.

**PDF:** arbitrary editable PDF text/images/clipping, preservation of document tags,
annotations/profiles and high-complexity professional files remain. Input/time/operator
limits are not a proven process-RAM ceiling for hostile compressed PDFs: PDF.js can
allocate during parsing before an operator list is available. Fuzz and memory-pressure
qualification remain required before broad untrusted-PDF claims.

**Form:** the return workflow is source exchange, not arbitrary scene/mesh import.
Scene placement, scaling, mesh topology edits, multipass relighting and live conflict-
resolved synchronization are not included. Form's current display object remains a
textured proxy. A full typecheck earlier in this pass reported unrelated errors in `animated-cloth.ts`
(`sampleBonePose` import) and `cad-workspace.tsx` (`parseProject`); no full Form release
build is claimed. Another Form release build was already running; it was left intact.

**Print:** the generated proof has no output intent. Current export is DeviceRGB,
not PDF/X. Select the printer, PDF/X variant and ICC profile, implement that output
pipeline, run independent preflight and the appropriate reference corpus, then obtain
RIP/proof approval. Adding metadata alone would not establish certification.
The [Ghent Workgroup preflight programme](https://gwg.org/ghent-pdf-preflight-compliancy/)
describes an external test programme; this project has not passed it.

**Affinity:** no installation found in `/Applications` or the user's Applications
folder. Local engine timings are not matched GUI benchmarks. Follow
`affinity-matched-protocol.md` with an installed/licensed identified edition and real
professional projects. Do not claim a competitive speed win from these sparse fixtures.

**Security:** npm audit currently reports 20 findings (1 critical, 13 high, 6 moderate).
No finding is attributed to the new `pdfjs-dist` package in that report. The broader
dependency backlog still requires separate triage before distribution.

The application-shell skill kept integration in the shared Open workflow, contextual
editors and existing command guards; no duplicate workspace or broad visual rewrite.
