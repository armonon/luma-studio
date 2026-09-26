# Editable 3D objects and archive hardening

This completes a bounded, source-backed **3D lettering smart-object workflow**, not the entire professional-creator roadmap or a release certification.

## Implemented

- Type → 3D & Form → Add editable 3D layer stores text, positioned HarfBuzz outlines, extrusion, bevel, materials and a versioned camera/render recipe together with a 1600 × 1200 committed render. The original text is retained hidden; adding the object is one undo operation.
- Selecting the object routes through the existing contextual registry to Edit 3D source. Preview edits are explicit drafts. Apply replaces source, geometry and pixels atomically; failure leaves the committed layer untouched. No continuous render loop is used.
- Saved geometry can reopen without re-shaping the original text. Changing text or font generates new positioned outlines. Material/camera edits reuse geometry.
- Undo/redo, structural copies and `.luma` history deep-copy source metadata; retained geometry is included in history byte accounting. Project format is now v8; versions 1–7 remain readable, and older readers refuse v8 rather than silently stripping editing semantics.
- The committed render goes through existing compositing, transform, mask, filter and raster-export paths. Merely opening or exporting a project does not need to regenerate WebGL geometry.
- Ordinary image replacement, direct painting, generated fills, pixel warps and content moves cannot overwrite a 3D object's source-backed content. Masks remain separately editable. Document resizing scales its transform instead of resampling the committed render. Generic spatial controls cannot apply a second conflicting projection.
- Project PNG assets are dimension-checked before the browser image decoder runs. 3D assets additionally require exact render dimensions and validated, bounded source geometry. Invalid/missing renders, malformed coordinates, unsafe dimensions and invalid camera/material data are rejected.
- Optional docked editors now have a local error boundary. A panel render/chunk-loading failure no longer needs to unmount the document shell. The fallback asks the user to save before restarting; it never automatically reloads or resets documents. React event-handler failures are not covered by render error boundaries.

## Validation

- Full final engine suite: **823 passed, zero failures/skips** (`/tmp/luma-3d-verified-tests.log`). TypeScript, focused ESLint, web production build and desktop frontend production build passed.
- Tests include corrupt project data, mismatched PNG dimensions, memory-admission failure, stale edit targets, lock protection, deep-copy isolation, dirty-state restoration, resize, destructive-tool refusal and persisted history.
- Older archive tests now use real lossless PNG fixtures rather than JSON pretending to be PNG, without removing pixel-level assertions.
- Compiled desktop frontend: created a 4,740-triangle Lato Bold object; edited it to an 8,764-triangle object; applied camera/material/source updates; tested undo and redo; saved `Editable-3D-QA.luma`; reopened through Cmd+O; reopened the 3D editor with the saved text/camera/geometry; then undid after reopening and verified restoration of both text and camera.
- Error-boundary fallback and wiring have focused tests; an injected missing-chunk browser campaign has not been run.
- Native build completed successfully: `src-tauri/target/debug/bundle/macos/Luma Studio RC Review.app`. This is a separate local review bundle with an ad-hoc signature, not a Developer ID/notarized release. Native launch/interaction verification was blocked by the locked Mac; no unlock was attempted outside the computer-use tool.

## Boundaries and remaining work

- This is explicit Apply-based 3D **lettering**, not arbitrary imported 3D scenes, continuous cross-application live sync, or an editable Photoshop 3D layer. Existing single-style, bundled-font, left-to-right point-text limits remain. The render is 1600 × 1200; enlarging its layer does not create additional pixel detail.
- The 2 MiB source, 12,000 outline-command and 300,000 mesh-vertex limits are per object. They do not constitute a measured global process-memory ceiling. Existing tile/history budgets still govern retained editing state.
- Full paragraph/Bidi/font-fallback typography, general editable PDF import, certified print delivery and matched Affinity benchmarks remain unfinished. These have not been relabeled complete.
- GLB includes source metadata and geometry, but a bidirectional editable Form Studio round trip is not yet validated.
- Release evidence checker still reports **4/10 gates passing**. The real-world corpus, production updater configuration/failure campaign, Apple signing/notarization, remote crash collection and clean-machine installation evidence remain missing. Passing engine tests does not override these gates.
- No installed application or remote repository is changed by this source pass. The review bundle is in the repository build directory; native interaction verification still requires the Mac to be unlocked.

The application-shell skill kept integration in the existing context/command/dock systems; no workspace redesign or shell-wide visual-regression claim is implied.
