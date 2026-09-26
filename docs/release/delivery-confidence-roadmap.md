# Luma delivery-confidence roadmap

## Acceptance contract

The September 25 brief is the governing sequence: delivery trust, external fidelity, five professional jobs, measured performance, distribution, then differentiation. No feature-count race, broad redesign, relaxed tolerances, or implied competitor parity. Create → revise → save → close → reopen → exchange → deliver → verify.

**Current overall assessment remains approximately 6.5/10, not independently recertified.** Area scores below are deliberately unassigned: the necessary professional acceptance jobs have not passed. A new unit test or synthetic fixture does not raise a score.

## Live gap-to-10 table

| Area | Validated score | Acceptance project | Current failure / gap to 10 |
|---|---|---|---|
| Compositing | Unrated | A: photo composite | Complex independent blend/effect comparisons and complete job outstanding |
| Masks | Unrated | A + difficult-edge corpus | Bounded sparse/legacy soft-mask SVG/PDF delivery implemented; masked editable reimport and difficult-edge professional corpus remain |
| Save/recovery/history | Unrated | Long-session recovery | Prior local atomic-save/recovery proof is useful; real storage-fault and multi-hour installed-app campaigns remain |
| Designer workflows | Unrated | B: brand campaign | Full create/revise/variant/deliver job not independently qualified |
| Painting | Unrated | D: painted artwork | Real artist/tablet sessions and sustained input-to-render timing absent |
| Selections | Unrated | Difficult-edge corpus | Hair/glass/fur/shadow corpus and end-to-end compositing acceptance required |
| Typography | Unrated | Independent exact-font corpus | Character-width geometry and tracked alignment corrected with 48 browser comparisons; independent exact-font paragraph visual failure remains |
| Vector editing | Unrated | C: vector illustration | Nested SVG groups, opacity and object titles now reimport; gradients, richer paints and mask/clip reimport remain restricted |
| Editable export | Unrated | Preflight + B/C | Bounded soft masks and multi-member vector-alpha clipping implemented; raster/group clipping bases, text and localized effects conversion incomplete |
| PSD | Unrated | Photoshop reference → edit → export → Photoshop | Current-source 512px external pilot remains 0/3 complete passes; export structure preserved but import/edit rendering fails |
| PSB | Unrated | Production/stress reference round trips | Independent high-depth/large/long-stack coverage insufficient |
| High depth | Unrated | 16-bit lifecycle | Existing bounded paths do not establish full edit/effect/mask/type/output continuity |
| RAW | Unrated | A: representative cameras | Camera corpus and nondestructive lifecycle qualification outstanding |
| Color | Unrated | Reference profiles/charts | Accuracy and conversion intent require independent numerical proof |
| Print | Unrated | E: printer-inspected delivery | CMYK path remains flattened and bounded; no PDF/X or printer certification |
| 2D/3D | Unrated | Luma → Form → Luma repeated edits | Bounded exchange exists; general identity/material/text preservation not qualified |
| Performance | Unrated | 4K–32K/large sparse/long-stack jobs | Process/native/GPU and sustained latency evidence outstanding |
| Desktop UI | Unrated | Observed professional workflows | Existing shell screenshots are useful but not complete usability acceptance |
| Installed reliability | Unrated | 2–4-hour sessions/faults | Need current-artifact native workflows, actual quit paths and storage failures |
| Distribution | Unrated | Clean Mac install/update/recovery | Notarization, production updater/crash receipts, clean-machine qualification incomplete |

## Phase status

1. **Delivery trust — in progress.** Groups, vector masks and bounded pixel/soft masks now have shared admission and SVG/PDF writers. Multi-member vector-alpha clipping preserves separate Fill/master opacity and clip-group semantics. SVG groups, group opacity and object titles reimport editably. Preflight exposes implementation limitations, reimport boundaries and affected-object navigation. Raster/group clipping bases, masked reimport, predictable text conversion and localized rasterization remain.
2. **External fidelity — failed pilot, in progress.** The last complete retained Photoshop pilot, at source `50773024c54e3d0f0ccef9567cb9b388d72efa9475b60481695ad29dd9681ecc`, remains 0/3 complete passes (`artifacts/photoshop-external-E1mjAl/report.json`). Save/reopen and compared external structures survive; import/edit appearance does not meet thresholds. Pass12's subsequent exact-font WebKit preview repeat remains 1/3, not a full external edit/export cycle. Full-resolution/corpus expansion and exact-font fidelity remain. Do not label self-round-trips external qualification.
3. **Five real projects — pending.** A photo composite; B brand campaign; C vector illustration; D painted artwork; E print job. Every job must include undo/redo, save/close/reopen, export, a failure case and independent verification. Synthetic grouped-shape fixtures are regression evidence, not these projects.
4. **Performance — pending.** Fixed fixtures, native artifact hashes, sustained sessions; p50/p95/worst-case and process/native/JS/GPU/temp/cache observations. Geometry-sized 50K SVG output is not proof of arbitrary 50K editing.
5. **Distribution — pending external setup/evidence.** Signing is not notarization. Preserve explicit failed/not-qualified status for production endpoints, signing credentials, clean-machine checks, updater recovery and crash receipt collection.
6. **Differentiation — deferred.** Safe variations, semantic recolor, Space, Form and automation should not displace unresolved delivery failures.

Pass12 adds geometric text-width/spacing correctness and render-dependent font admission for flattened delivery. Missing fonts on genuinely unused hidden layers no longer block image/artboard/print export; hidden clipping dependencies and layered PSD checks remain protected. This is not a typography-parity or release sign-off. The first full candidate suite timed out during severe host overload; see `professional-trust-pass12.md` for partial and final-source focused receipts. No performance score or complete-suite pass is inferred from that run.

## Restriction classification and choices

- **A: target format limitation.** Explain what the target cannot retain; offer an explicit delivery copy. PDF/X certification is a separate qualification, never inferred from PDF syntax.
- **B: Luma implementation limitation.** Groups, vector masks, bounded pixel masks and vector-base clipping alpha are addressed in the writers. Raster/group clipping bases, masked editable import, text export and localized raster effects still belong here: SVG/PDF capabilities must not be misrepresented as format limitations.
- **C: semantic mismatch.** Creative recipes, Luma history, hidden editing alternatives and format-specific organization may not transfer directly. The UI must distinguish editable geometry from a complete editable Luma document.

No writer may silently omit a visible unsupported object. Until localized conversion is implemented and independently validated, block with a named object and actionable explanation. Never replace that safeguard with whole-document flattening by default.
