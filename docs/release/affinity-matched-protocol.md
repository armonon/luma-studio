# Matched Affinity acceptance protocol

Generate the shared SVG fixtures and RGB PDF proof with `npx tsx build/qualify-vector-delivery.ts`.
Outputs live under `artifacts/vector-qualification/`. SHA-256 identifies each exact input.
These are sparse vector fixtures, not 50K photographic workloads or a complete illustration corpus.

For each installed, licensed app, record version/build, OS, CPU/GPU/RAM, display scale,
power mode, viewport dimensions, acceleration preferences and source revision.
Use the same machine with other workloads stopped. Perform one warm-up and five measured runs.
Keep cold-start measurements separate. Never compare engine timing against GUI elapsed time.

1. Open the exact SVG. Confirm dimensions, 100 objects, fill colors and stacking.
2. Fit view, select one triangle, move 40 px horizontally, rotate 15°, undo twice.
3. Save to the app's native format; close and reopen; verify editability.
4. Export SVG and PDF. Compare structure and independent rendered images at the same resolution.
5. Record open-to-usable, move-to-present, undo, save/reopen/export times and peak process RAM.
6. Retain screenshots, exports, measurement method, per-run samples and failures, not only averages.

Run separate, real-project campaigns for a poster with mixed typography, an illustration with
compound shapes/appearance stacks, a dense photo composite and a large panorama. Do not mark
these complete using the synthetic triangles. A faster result that changes appearance or loses
editing structure is a failure, not a speed win.

Current status: no matched Affinity results. Installation/licensing and the target edition/version
must be supplied. No claim of outperforming Affinity is supported by the local engine baseline.

## Evidence ingestion

Record each application's results in the `WorkflowMeasurement` schema in
`build/affinity-evidence.ts`, with artifact paths relative to the manifest and SHA-256
hashes of retained recordings, screenshots and output comparisons. Then run:

`npm run benchmark:compare -- /absolute/path/luma.json /absolute/path/affinity.json`

The checker verifies artifact hashes, matching fixture/environment/run counts,
one warmup, at least five complete GUI runs and passing visual/structural fidelity.
It rejects engine-only timing, absent evidence, or failed fidelity. The output reports
per-stage medians and peak memory for that fixture only. It does not authenticate
third-party claims or substitute for independent review of the supplied artifacts.
