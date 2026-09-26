# Complex typography, PDF objects and Form mesh qualification

Date: 2026-09-21. This is a bounded implementation and validation report, not a claim of complete Photoshop/Illustrator parity.

## Implemented

### Typography

- Added pinned, OFL-licensed Noto Sans Arabic and Noto Sans Hebrew variable fonts. Fourteen local families total; font/license manifest remains checksum-verified and below the existing 9 MiB vendor budget.
- Added paragraph-level bidirectional resolution (bidi-js 1.1.0, Unicode 13 UAX #9), grapheme-safe script/style runs, visual run ordering, HarfBuzz joining/mirroring, direction-aware start/end anchors and context across character-style boundaries.
- Arabic, Hebrew and Devanagari outlines now feed the vector and actual 3D mesh workflows. Variable font weight reaches HarfBuzz. Font faces are shared within a disposable worker request rather than copied repeatedly for paragraph candidates.
- Existing bounds remain: 160 characters, four faces, 32 style runs, 12,000 outline commands, bounded worker concurrency and cancellation. Candidate-line cache retains at most two entries.
- Explicit exclusions: vertical/path outlining, mixed-style paragraph frames, complex-script justification, explicit Bidi embeddings/isolates and missing glyph coverage. This does not replace all Canvas text rendering with HarfBuzz or prove every script/OpenType font.

### Editable PDF reconstruction

- Open now offers **Editable text, images and paths (font mapping)** in addition to strict vector-only and flattened-page modes.
- Text becomes editable text layers; decoded images become separate pixel layers; supported solid paths remain vectors. Paint order, object transforms and supported opacity are retained.
- Users must choose a bundled replacement font and acknowledge substitution. Original embedded fonts, weights, kerning/TJ positioning and exact text widths are **not** preserved. This is reconstruction, not lossless PDF text editing.
- Unsupported clipping, vertical/custom-matrix fonts, stroked/invisible text, invalid Unicode mappings, annotations and unsupported operators stop import instead of disappearing.
- Admission: 8 MiB PDF, 64 pages, 50,000 operations, 512 objects, 10,000 text characters / 2,000 per text object, 4 MP per image / 16 MP total; conversion runs in a terminable worker under the existing deadline. Workspace installation occurs after validation/decoding.
- Embedded-font persistence, arbitrary clipping/transparency, full editable SVG/PDF interchange and real-project corpus qualification remain open work.

### Form mesh exchange

- Added `.lumaformmesh`, independent of the editable-text source format. Static triangle geometry, normals, indices, transforms and solid PBR materials survive exchange. Clearcoat and sheen are retained; reflection winding is corrected.
- Limits: 8 MiB, 64 mesh parts, 60,000 vertices and 180,000 indices. Textures, skinning, morphs, instances, animation and unsupported material effects are refused. This is not unrestricted scene interchange.
- Form imports as a new scene object. Luma imports as a new document containing a source-backed Smart Object, preventing overwrite of newer work. Geometry/materials persist in `.luma` alongside a bounded 1600 × 1200 render.
- Luma contextual controls edit rotation/FOV transactionally and export the committed mesh. History accounts for source memory and clones source data; stale render results cannot overwrite newer edits. Paint, warp, resize and content-replacement guards protect source/render consistency.
- Form exposes import/return commands, native atomic Save with recoverable replacement backups, scene persistence and primary-mesh component/deformation rebuilding. Multi-part exchange does not imply a new all-parts component editor. Full scene cameras, textures, rigs, procedural stacks and animation are not exchanged.

## Evidence

- Luma: **854/854 tests pass**, zero skipped, final full suite after the implementation changes. TypeScript and targeted ESLint checks pass.
- Form: **8/8 exchange tests pass** (text + mesh), TypeScript and targeted ESLint pass. Existing native exchange save tests: **2/2 pass**. Both desktop frontend builds pass.
- Fresh ad-hoc-signed macOS review bundle builds at `src-tauri/target/debug/bundle/macos/Luma Studio Exchange Review.app`. Distinct app identifier isolates review workspace data; the installed `/Applications/Luma Studio.app` was not replaced. Not notarized or production-certified.
- Browser: PDF fixture imported into two text layers and one image layer. Font-mapping consent disabled Import until acknowledged. Edited a text layer to `سلام Luma 123`, chose Noto Sans Arabic, and created actual editable outlines; visually checked the result.
- Browser: edited mesh imported, rendered and rotated in Luma. Form imported the same fixture, changed Y rotation to 25 degrees, exported it, and Luma reopened that actual downloaded file.
- Actual Form download: `/Users/lillypad/Downloads/form-return (1).lumaformmesh`, 118,649 bytes. Identity and material values retained; 845 vertices / 1,536 triangles retained; returned positions reflect the Form edit. Exported mesh is not just an image or text proxy.
- Native: fresh review build launches, File → Open and keyboard Open function. The initial Go To path popover stalled under automation; folder-by-folder native accessibility navigation succeeded. Packaged PDF worker imported the same PDF into three layers; native mesh import rendered successfully and exposed contextual controls.
- Native Save created `artifacts/vector-qualification/native-mesh-exchange-qa-2026-09-21.luma` using the standard macOS Save dialog. Saved document closed without discarding other tabs, then reopened through native Open. This is targeted workflow validation, not exhaustive Mac UI qualification.
- Generated reproducible mesh fixtures: `npx tsx build/qualify-mesh-exchange.ts`.
- Builds retain existing large-chunk/dynamic-import warnings. A stale browser tab encountered an old chunk URL after a rebuild; a fresh review page loaded and completed the mesh workflow. No production deployment occurred.

## External gates still blocked

1. **Print certification:** printer/output process, PDF/X variant, approved ICC profile, bleed/output-condition requirements, independent preflight and proof/RIP approval are still required. Existing structural inspection remains `NOT_CERTIFIED`. No target was invented and no certification claim was added.
2. **Affinity comparison:** no Affinity installation was found in the app inventory or `/Applications`. Need the licensed edition/version and matched real jobs. No comparison timings or superiority claim were fabricated.
3. **Release qualification:** these targeted passes do not substitute for a camera/PSD/PDF corpus, print proofing, full native feature-matrix regression, notarization or clean-machine distribution testing.

The application-shell skill was used to preserve the existing contextual-panel and shared Open/Save routes rather than creating a parallel workspace or import UI.
