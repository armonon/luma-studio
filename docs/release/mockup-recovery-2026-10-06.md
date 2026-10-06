# Mockup preview recovery

Fresh production checks rendered all six scenes and exported nonblank PNGs;
the earlier blank-preview observation was not consistently reproducible.
This change closes concrete recovery gaps rather than claiming a confirmed
cause for that earlier observation.

- Keep loading feedback visible until preview pixels are painted.
- Ignore late artwork decoding after another upload or dialog close.
- Bound worker requests, settle failures, validate returned pixel dimensions,
  and expose a retry action that creates a fresh renderer.
- Repaint a restored canvas context.
- Keep scene labels inside their buttons and let the phone inspector scroll
  with the preview instead of collapsing into a narrow nested scroll area.

Verification: 15 focused tests; Next production build and scoped ESLint;
Chrome canvas-pixel checks across all six scenes, three dialog opens, and PNG
exports; injected worker-load failure followed by successful retry; canvas
restoration. Phone-width browser checks are not physical iPhone/Safari tests.

Deployment must run `netlify deploy` with the build enabled so the Next
runtime's generated headers, routes and static output are included. Review
the draft and compare live marketing/learning asset hashes before promotion.
