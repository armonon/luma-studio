# Native clipboard and selection qualification — 2026-09-23

## Status

Native image exchange is implemented and partially qualified across real applications. **Photoshop-level selection accuracy is not established.** Do not promote the pilot numbers below as an accuracy or parity claim.

## Implemented

- macOS NSPasteboard bridge: write PNG plus a private origin marker in one pasteboard item; read PNG/TIFF and normalize to 8-bit RGBA PNG over binary IPC.
- 16-megapixel / 16,384-edge image limit; 32 MiB encoded input/output limit; 128 MiB decoder allocation limit; one native decode at a time. Incoming native transfers reserve 512 MiB against the engine's existing 1 GiB **known-allocation** admission ceiling before decoding. This is conservative admission, not a measurement of total process RSS.
- Reject corrupt/unsupported input without editing the document. Refuse stale clipboard revisions instead of replacing newer clipboard contents.
- Copy waits for WKWebView's DOM clipboard event to finish before reading the native clipboard revision. Real-app testing exposed this ordering bug; an ordinary mocked bridge test did not.
- Foreign clipboard images take precedence over old internal Luma pixels. An external text clipboard cannot silently paste an old image. Newer Luma copies supersede pending writes.
- Native menu/keyboard/pixel controls share command routing; the Focus paste action now uses that same command. Editable text fields retain normal OS clipboard behavior.
- Async native paste checks document identity/revision and releases its reservation after success or failure.
- Neural loader only enables browser caching when that API exists; SAM precision is explicitly q8 on all runtimes.

## Real-app checks

| Workflow | Evidence |
| --- | --- |
| Luma → Preview | Passed: Copy from Luma, New from Clipboard in Preview displayed the Dunes image. |
| Preview → Luma | Passed: Preview Select All/Copy produced a new `Pasted Layer` in Luma. |
| Luma → Photoshop 27.10.0 | Passed: Paste created a new Photoshop raster layer with the copied 2200 × 1467 dimensions; test insertion subsequently undone. |
| Photoshop → Luma | **Not qualified.** Photoshop Copy/Copy Merged did not visibly replace the system image during this automated session. Preview also received the previous image, despite Photoshop's Export Clipboard preference being enabled. Do not mark this direction passed or assume a cause. Requires a foreground/manual follow-up. |

Validation used isolated review apps. The installed `/Applications/Luma Studio.app` was not replaced. These ad-hoc signed debug bundles are not distribution-qualified.

Final verification: **887/887 TypeScript tests, 10/10 Rust tests**, TypeScript checking, targeted ESLint and `git diff --check` passed. The final isolated desktop bundle built successfully and its incoming Preview paste path passed with memory admission enabled. Review build: `src-tauri/target/debug/bundle/macos/Luma Clipboard Final Review.app`.

## Actual model/Photoshop pilot

Source: the [SlimSAM model card's public Corgi example](https://huggingface.co/Xenova/slimsam-77-uniform), downloaded for local testing only. No image or Photoshop file is redistributed here.

- Source SHA-256: `385413e29523ac6b777f8f23bcf72696119f9bfa364792036fc008700a1f6811`.
- Photoshop reference SHA-256: `3554ead14bffedfbb73163dc0ef8d86de087d6ed7779db26a93891955ad06002`.
- Neural/proposal source hash recorded by the final runner: `5f8cee1e609f0a3927e4983f22c5b46e5c7bde8900f86bd0e085fae29cbe8776`.
- Dimensions: 614 × 410.
- Luma: actual `samPromptMask` pipeline, `Xenova/slimsam-77-uniform`, q8, positive point (340, 250), no manual refinement.
- Photoshop: installed 27.10.0, Select → Subject, Layer Mask → Reveal Selection, saved PSD. No manual refinement. This uses a different interaction (automatic subject versus a specified point), so it is an agreement pilot, **not a matched interaction-budget competition**.
- Masks compared at identical original dimensions. Photoshop's mask was read from the saved PSD, not estimated from a screenshot.

| Metric | Pilot result |
| --- | ---: |
| Binary mask IoU agreement | 0.975417 |
| Dice agreement | 0.987556 |
| Boundary F1, 2-pixel tolerance | 0.990497 |
| Whole-image alpha MAE, 0–1 scale | 0.002779 |
| Alpha MAE on Photoshop's partially transparent pixels | 0.159703 |
| Photoshop partial-alpha pixels | 4,346 |
| Node process peak RSS | 2,083.8 MiB |

The boundary result is encouraging. The soft-alpha disagreement remains material. Neither Photoshop output nor SAM's predicted IoU score is independent ground truth. One model-card sample is especially unsuitable for a generalization claim. The Node run includes loading/inference and is **not** a WKWebView/native latency or memory benchmark; its high RSS is a warning, not a lightweight-runtime pass.

A repeat through the final runner reproduced the mask metrics exactly (peak RSS 1,897.6 MiB). Neither run qualifies native memory behavior. Local evidence: `/tmp/luma-selection-q8-final-report.json`, `/tmp/luma-selection-q8-final-luma.png`, and `/tmp/luma-selection-corgi.psd`; temporary artifacts may be removed by macOS.

Reproduce locally after supplying the same input and Photoshop reference:

```sh
npx tsx build/run-selection-pilot.ts /tmp/luma-selection-corgi.jpg 340 250 /tmp/luma-selection-q8 /tmp/luma-selection-corgi.psd
```

The runner writes a PNG mask and JSON report. It downloads model weights on first use, runs inference locally, and always identifies this pilot as insufficient for parity qualification.

## Qualification still required

1. At least 50 distinct, licensed real images with independent human-reviewed alpha labels, including at least five each for objects, hair/fur, thin structures, low contrast, transparent objects, and multiple subjects.
2. Capture paired Photoshop references with app version, local/cloud setting, source hash, tool, prompts, refinement steps and timing. Use identical target instructions and interaction budgets. Separate one-click and assisted/refined workflows.
3. Freeze model weights/config hashes and Luma source revision. Keep a held-out set; do not tune the acceptance thresholds after seeing results.
4. Suggested **engineering** acceptance margins to ratify before testing: no more than 0.01 IoU or 0.02 boundary-F1 regression against Photoshop on the same independent labels, no more than 0.01 additional alpha MAE, plus visual review of hair, halos, missing components and transparency. These margins are not an industry certification.
5. Report every failure and per-category distribution, not only aggregate averages. The evidence gate fails closed for missing labels, missing Photoshop pairs, duplicate images, missing categories and failed cases.
6. Measure packaged-app peak RAM, warm/cold latency, model-download failure, cancellation and repeated inference. The current Node memory result is not a pass on the product's memory goals.

## Explicit clipboard boundaries

Raster exchange only, not editable layers/text/vectors. No HDR, high-depth, ICC-preserving or CMYK clipboard fidelity claim. TIFF decoding does not provide a professional color-managed conversion. Inputs with unsupported TIFF encodings fail safely. Web clipboard remains subject to browser permission/API availability. Copy's native publication can fail; existing internal pixels and undo remain available, and the error is shown rather than reported as a successful system copy.
