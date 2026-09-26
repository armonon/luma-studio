# Professional trust — untouched text delivery

## Completed and root cause

An opacity-only edit previously regenerated every imported text layer's pixels
through Luma's font/layout renderer. This could replace an unavailable font and
change line placement even though the original editable text descriptor survived.
The writer also always discarded the original global Photoshop text-engine data.

The supported RGB8 same-container path now reuses original compressed text pixel
channels when text/transform/effects are unchanged and no unsupported mask,
filter, spatial or adjustment combination is present. Channels are views into
the retained immutable source, not a second decoded image. Native save/reopen
restores those views without allocating another image canvas. Empty previews
and PSD↔PSB changes continue through the disclosed regeneration path.

The global text engine is retained only when the entire original layer/index
mapping, text-layer identity, parent mapping, document settings and text preview
eligibility are intact. Text edits, rasterization, stack changes and blend-pass
expansion cannot retain stale global text data. Editable text is not rasterized
as a substitute for delivery.

## Reproduction and automated validation

New PSD and PSB regression fixtures failed before the fix: the original 8×8
preview at (2,3) became a 26×8 substitute at (2,4). They now preserve exact
pixels/bounds through opacity edit → native save/reopen → Photoshop export.
The tests also check source-buffer sharing and that actual text edits retain
their new contents and regeneration warning.

Final source fingerprint:
`e871083739bb8facffd4aef14e611b31c69440cdc10cbecdbe8fed2b975e1ba0`.

- 1,162 engine tests pass.
- Types, lint, 12 native-bridge and 9 native-core tests pass.
- Desktop and web production builds pass; existing bundle/HarfBuzz warnings remain.
- Source-bound receipt: `artifacts/local-hardening-report.json` (unchanged source).
- Adjacent coverage includes high-depth, source-backed surfaces, masks, project
  preservation, smart objects, export approvals and trailing text paragraphs.
- The full timed eight-project rerun refused admission at load 12.30 on eight
  logical CPUs (limit 1.5 per CPU). `artifacts/trust-pass2-corpus.json` records
  the blocked attempt. It is not counted as a pass; the threshold was not raised.

## Independent Photoshop result

Final-source evidence: `artifacts/photoshop-external-TIeLWM/report.json`.
Photoshop 27.10.0 successfully reopened `private-ndw` after the opacity edit and
native save/reopen. The expected Photoshop edit and exported/reopened image
have **zero maximum pixel delta**, including alpha, and no compared structural
differences at the declared 512-pixel preview resolution. Previously the
external alpha MAE was 0.4322/255 with a maximum delta of 81.

This is not a full case pass. Import-preview alpha MAE remains 1.7037/255,
above the unchanged threshold of 1. Native save/reopen itself has zero delta.
The full case remains FAIL. No full-resolution, mask-plane, character-style,
installed-app or print-fidelity certification is implied.

## PSB reopen investigation: still blocked

`artifacts/photoshop-external-UjImIn/report.json` retains the PSB pilot failure.
Photoshop again reported layer-reading program error `f376f9.870`. Continuing
with possible layer loss was canceled. A normal Photoshop restart with no open
documents did not resolve the same artifact's failure. An independent PackBits
row-length scan found zero errors in all 56 source/output channels; that narrows
the investigation but does not establish valid PSD/PSB interchange.

Photoshop displayed a scratch-disk warning after restart: 38 GB available versus
100 GB recommended. macOS reported approximately 30 GiB available. This is a
qualification-environment risk, not an established explanation for the file
error. No files were deleted, no scratch settings changed, no user original was
saved, and no other applications were stopped. Photoshop test imports were
canceled rather than accepted with layer loss.

## Performance and score

The supported delivery path avoids text rerasterization and shares compressed
source bytes. Tests prove that ownership behavior; they do not establish a
process-RAM ceiling or a Photoshop speed advantage. Timing parity is not claimed.

Overall assessment remains approximately **6.5/10**. A single externally exact
delivery preview does not justify raising general interchange or release scores.

## Next highest-risk work

1. Isolate the PSB layer-reading failure by independent descriptor/format bisection.
2. Resolve import-preview text/alpha differences against native runtime references.
3. Extend independently verified delivery to full-resolution, masks and text runs.
4. Continue vector-mask delivery, large-document and distribution qualification.

No installed-app replacement, release, deployment or commit was performed.
