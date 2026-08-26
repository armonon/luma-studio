# RC hardening report — 2026-08-25

This report records locally reproducible release-candidate evidence. It does not convert missing external evidence into a pass.

## Product changes

- Added an automatic PSD/PSB import planner under the existing 2 GiB process ceiling.
- Files whose editable layer planes fit continue to open layered.
- Files whose layer planes do not fit, but whose document composite does, open as one clearly identified editable Background preview.
- Composite fallback skips layer pixels and linked payloads, retains the original source bytes, and returns the exact original PSD/PSB when exported unchanged in source mode.
- `.luma` projects persist the chosen Photoshop import representation, so save/reopen reconstructs the same composite preview and retains exact untouched-source passthrough.
- Files whose flattened estimate also exceeds the ceiling still fail before codec allocation.
- Added stable accessible names to icon-only layer, Focus, Actions, history, selection, and reset controls.
- Rebalanced the 720px-high desktop layout so Layers and Properties cannot crowd the contextual editor out of the right rail.

## Real project compatibility

Private source files remain outside Git. The local ignored manifest points to the owner's files and the generated reports stay in `artifacts/`.

| Corpus | Result | Scope | Peak RSS |
| --- | --- | --- | --- |
| PSD | 6/6 pass | 3,600×3,600 and 4,800×6,000; layered plus 9–24-layer bounded-composite fallbacks | 1,116.5–1,655.5 MiB |
| PSB | 2/2 pass | 3,000×2,400 10-layer import and 2,550×3,300 bounded-composite fallback | 965.5–1,527.8 MiB |

Every case completed open → bounded edit → `.luma` save/reopen → PSD/PSB export/reopen. Native preview mean error and Photoshop preview mean error were both zero for all eight projects.

This is useful compatibility evidence, but it is not the RC1 corpus gate. That gate still requires at least 50 real projects spanning PSD, PSB, and representative RAW cameras.

## Extreme-document and failure campaign

The focused campaign passed 64/64 tests:

- 10K, 25K, and 50K selection creation, lasso/ellipse composition, refinement, and feathering;
- 50K Magic Wand tile caching;
- 50K mask paint, feather, undo/redo, viewport composition, and project reopen;
- sparse transforms at a deliberately extreme 300,000-pixel edge;
- transactional memory-ceiling refusal with no leaked partial tiles;
- bounded content-aware move and tile-diff history;
- streamed oversized document and artboard PNG exports;
- corrupt recovery rejection, all-tab recovery, and bounded long-session history;
- dirty-region rendering, renderer cache ceilings, and native float-tile checks;
- HTTPS-only, scrubbed, credential-free crash-report transport behavior.

## UI and build evidence

- The production desktop build completed successfully.
- The Tauri release build produced `Luma Studio.app` and a 7.5 MB arm64 DMG.
- Local bundles now use Tauri's explicit `-` identity: strict deep code-sign verification passes with a sealed ad-hoc signature and hardened runtime.
- The DMG checksum verified, mounted read-only, contained the Applications shortcut and `Luma Studio.app`, and the app inside the image passed strict deep signature verification with bundle id `app.luma.studio`.
- The packaged `.app` launched as a standalone process outside the development server, remained stable at idle, accepted a normal application quit, and exited cleanly.
- Gatekeeper still rejects the bundle because it has no Apple Team ID, Developer ID signature, or notarization ticket; that remains an external RC2 blocker.
- The rebuilt app was inspected at 1280×720 in the in-app browser.
- Contextual controls remained visible below the compact layer rail.
- The accessibility tree exposed explicit command names for the changed icon-only controls.
- Focused PSD/input/UI tests passed 8/8.
- TypeScript completed with no errors.
- Targeted ESLint completed with no errors; the corpus runner is intentionally ignored by the project lint pattern.
- Full ESLint completed with no errors.
- The production web build, 4 rendered-page/API checks, and all 635 TypeScript regressions passed on the final tree.
- Native Rust tests passed 5/5.
- The initial static bundle budget passed at 1,017,370 bytes raw / 281,927 gzip / 265,853 Brotli with a 371,468-byte studio entry.

## Release operations added after the local campaign

- The native Application menu now contains a wired Check for Updates flow.
- The Rust updater checks the signed endpoint, re-checks the exact accepted
  version before install, lets Tauri verify the artifact signature, and
  relaunches only after installation succeeds.
- Release-only updater configuration is generated from validated environment
  inputs and ignored by Git; placeholders and HTTP endpoints do not satisfy the
  release gate.
- `/api/diagnostics/crash` now provides a bounded, rate-limited, CORS-scoped,
  server-side scrubber/proxy to an authenticated HTTPS collector.
- Automated local-bundle and final Developer ID/notarization verifiers were
  added. The former cannot impersonate clean-machine evidence, and the latter
  refuses ad-hoc or unstapled bundles.
- The verifier caught and drove fixes for an updater-plugin startup abort,
  release-binary localhost metadata, and absolute build-home source paths.
- The final local `0.6.0-rc.0` app is 12.72 MiB, passes strict deep signature
  validation, contains the required associations, contains neither development
  URL nor build-home path, and remained alive for the six-second isolated launch
  probe. Its signature is still ad-hoc, so this is not notarization evidence.

## Honest remaining blockers

- No local camera RAW files were available for the representative RAW corpus.
- The real compatibility report is below the required 50 projects.
- Updater runtime and signed-artifact generation are wired, but a production
  public key and HTTPS release endpoint must be supplied by release operations.
- Apple Developer ID signing and notarization require release credentials and Apple service evidence.
- Remote crash ingestion is deployable, but receipt and symbolication still
  need the production collector and exact release symbols.
- Clean-machine installation and upgrade testing needs at least two machines without the development environment.

Those items must remain failing in `npm run release:status` until real evidence is supplied.
