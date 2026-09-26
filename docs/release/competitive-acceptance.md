# Competitive acceptance: evidence before parity claims

This is an execution checklist, not a statement that Luma surpasses Photoshop.
The baseline is the current Luma source and an identified Photoshop release on
the same Mac. Record OS, CPU/GPU, RAM, app versions, fixture hashes, preferences,
warm/cold state and background load. Never compare Luma unit-test timings with
Photoshop GUI timings, or sparse empty canvases with dense photographic projects.

## Acceptance by product area

| Area | Required evidence before claiming superiority |
| --- | --- |
| Compositing | Reference images for every blend/effect path, alpha edge cases, groups, masks and high depth; blind visual review plus numerical tolerances; a completed blend-stack job requiring fewer actions without loss of editability. |
| Painting and selections | Matched tablet strokes, pressure/tilt behavior and event-to-present p50/p95/p99; difficult hair/transparency/low-contrast selection corpus; seam-free masked painting; undo fidelity. |
| Transform | Pixel-scale view, stable anchors, gesture cancellation, one-step undo; matched text/vector/masked/high-depth jobs; nondestructive perspective/warp remains a gap beyond current bounded raster Distort. |
| Workspace | Menu/shortcut/control equivalence; per-document state; focus and keyboard access; docking/reload matrices at 1920×1080, 1440×900, 1280×800; timed user tasks, not screenshot resemblance. |
| History and safety | Open/edit/save/reopen/export; repeated crash recovery without duplication or loss; delayed-save/tab-switch races; failed writes; disk-full handling; long sessions and branch restoration. |
| Large documents | 10K/25K/50K dense and sparse fixtures; every supported operation measured separately for wall time, peak process RAM and output correctness; refusal before mutation when limits are exceeded. |
| Photoshop interchange | 50–100 real PSD/PSB projects with reference renders and structural expectations; editable round trips through both apps; fonts, smart objects, masks, profiles and large layer stacks; explicit unsupported-feature reports. |
| RAW and color | Representative Canon/Nikon/Sony/Fuji/Panasonic files; reference camera/color-chart results, high depth and print/proof workflows; profile/intent validation; no conflation of RGB output with full CMYK/Lab editing. |
| AI | Configured real services/models, consistent operation semantics and output dimensions; matched quality/latency/cost tests; cancellation, offline/auth errors and provenance; user-owned imagery must not be uploaded without authority. |
| Spatial/Form | Actual editable geometry and multipass return, revisions/conflicts, missing links and restoration; distinguish the existing lightweight 2.5D preview/contracts from unfinished live 3D round trips. |
| Plugins and distribution | Versioned plugin capabilities and isolation tests; Developer ID/notarization, signed updates with interruption recovery, consented crash reporting and clean-machine installations. |

## Current engineering slice

- Actual Size now means one document pixel per CSS pixel. Menus, number shortcuts,
  wheel zoom and Space sliders use actual scale; zoom preserves its anchor.
- Viewport outputs honor pixel/dimension limits even for extreme-aspect stages
  and sub-quarter render scales. Tests include million-pixel document dimensions;
  this is viewport planning evidence, not a claim that every million-pixel operation works.
- Finder/Open Recent and native-picker requests share a bounded FIFO. Requests
  wait for startup recovery/save/dialog completion and cannot open concurrently.
  A failed request does not strand later files; active reads are invalidated on unmount.
- Recovery restores stable checkpoint identities. Repeated restarts no longer
  manufacture fresh checkpoint IDs; recovered empty documents are preserved.
  Autosave waits for startup recovery. Existing duplicate tabs are not deleted.
- TypeScript excludes generated Rust/build output from source discovery. Real
  source and test directories remain checked.

## Verification record

- Initial focused campaign: 53/53 tests passed (menu, queue, save, recovery, viewport).
- After recovery identity changes: 23/23 targeted tests passed, including five
  consecutive restore/checkpoint cycles and duplicate-ID refusal.
- Updated desktop Vite frontend build passed, with existing large-chunk warnings.
- Live preview inspection succeeded, revealing many repeated Dunes tabs. A later
  Actual Size interaction timed out: it is not counted as a live pass.
- Native app packaging, final TypeScript/lint and clean interactive validation:
  pending at this checkpoint. Consult the task handoff for subsequent results.

No Photoshop performance victory, full compatibility, signing or distribution
readiness is established by this slice. External reference projects, service
configuration and distribution credentials remain separate requirements.
