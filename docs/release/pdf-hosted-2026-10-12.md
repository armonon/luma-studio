# Hosted PDF import release — 2026-10-12

Published at https://luma.thecreatingco.com/studio and /iphone.

Ordinary text PDFs failed when the import dialog defaulted to editable vector paths. Rendered-page import is now the recommended default, preserving visible text and graphics in one flattened layer. The two editable modes remain explicit options with their existing compatibility limits. Existing file-size, page-count, annotation/form, and rendering budgets are unchanged.

Source: `1107f04c5ddb81505ecc9ad098b00a20a852c0fa`, including main `1335994` and the already-live Mockups changes through `ab8ff72`.
Published deploy: `6acd38da5d4e58801bfec1d2`.
Previous deploy: `6acd2c67136e02c1e31defec`.

Validation:

- 37 PDF import/object, print-output, and vector-delivery tests passed with no skips.
- Next production build, TypeScript check, Netlify adapter packaging, and focused ESLint passed.
- Chrome checks passed locally, on the deploy preview, and on production at desktop 1440px and phone 390px. The default import produced a 625 × 417 raster page containing the test text and red graphic, then exported a PNG with matching dimensions. No page errors occurred.
- The exact production function SHA-256 is `86f8232e0a8be881223eecbdbcaf606fc9de277c6d0f2c7783eef12947d260c0`; Node 22 streaming and the static-preferred wildcard route were retained.
- Verified 1,687 retained file hashes and 132 release assets against the deployment manifest. Homepage, studio, phone, tablet, Cutout, workshops, and service-worker routes returned 200. The service worker retains `Cache-Control: no-cache`.
- Invalid AI and crash-report requests on the preview returned 401 and 400 respectively. Nine deploy-scoped page blobs were uploaded before qualification.

A first unpublished preview caught omitted Next.js dependencies caused by a shared dependency-directory symlink. The final build used local dependencies and passed the hosted checks before publication. Publication checked that production still matched the captured previous deploy.

Browser emulation does not establish physical-device or arbitrary-PDF compatibility. Reproduce the browser check with `docs/release/check-pdf-import.mjs`, `LUMA_RELEASE_URL`, and an optional `LUMA_PLAYWRIGHT_MODULE` path.
