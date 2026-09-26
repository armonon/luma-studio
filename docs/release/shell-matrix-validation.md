# Desktop-shell visual qualification

Start an isolated desktop Vite server on 127.0.0.1:4183, then run:

```sh
node docs/release/check-shell-matrix.mjs
```

If Playwright is supplied by the host runtime, set `LUMA_PLAYWRIGHT_MODULE` to
its absolute module path. `LUMA_UI_URL` may override the local URL, but the
harness deliberately refuses a remote hostname. No user profile is loaded.

The script acquires the qualification lock and records exact source and harness
hashes. Do not edit source during a campaign. Each run creates a new private
`artifacts/shell-matrix-*` directory and persistent WebKit profile. The profile
is necessary because ephemeral WebKit Blob storage is unavailable on this host.
Real recovery remains enabled. The script edits only its generated documents.

Seven states are captured at three viewports. All captures remain `reviewed:
false`; a passing comparison never automatically replaces a reference. Initial
references were inspected individually and are catalogued in
`tests/visual-regression/shell-matrix.json` with provenance and limitations.

The pixel comparison reports mean absolute RGBA delta and the fraction of
pixels with a channel delta above 8. The limits are respectively 0.25/255 and
0.001. Only the save-status label plus a small horizontal allowance is excluded
because recovery timing is asynchronous. The status must not report an error,
and actual checkpoint/reload assertions remain separate. Do not broaden masks
or thresholds to conceal a changed control, canvas, dock or document identity.

On failure, inspect `failure.png`, the comparison metrics and actual captured
PNG. Fix a regression or document/approve an intentional change before updating
references. Source hashes will change when references change: run local
qualification again afterward.

This covers the desktop webview shell, not native menus, window decorations,
file dialogs, clipboard, signing, updater replacement, or clean-machine behavior.
`requiredInstalledMacStates` in the older manifest remains unqualified. Initial
reference presence is not evidence that every professional workflow works.
