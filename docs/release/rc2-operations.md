# RC2 distribution operations

These gates require real release infrastructure. The scripts below fail closed:
missing keys, placeholder keys, HTTP endpoints, ad-hoc signatures, unstapled
apps, and same-machine launch tests cannot become RC2 evidence.

## 1. Signed updater configuration

Generate and retain the updater private key outside the repository. Use a
password and keep both the key and password in the release secret store:

```bash
npx tauri signer generate -w /secure/location/luma-updater.key
```

The updater public-key value is the base64 encoding of the generated `.pub`
file. Provide it, an HTTPS release endpoint, and the Developer ID identity to
the release job:

```bash
export LUMA_UPDATER_PUBKEY="..."
export LUMA_UPDATER_ENDPOINT="https://updates.example.com/luma/{{target}}/{{arch}}/{{current_version}}"
export APPLE_SIGNING_IDENTITY="Developer ID Application: Company (TEAMID1234)"
export NEXT_PUBLIC_LUMA_CRASH_ENDPOINT="https://luma.example/api/diagnostics/crash"
export TAURI_SIGNING_PRIVATE_KEY="/secure/location/luma-updater.key"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="..."
npm run pro:release
```

The generated `src-tauri/tauri.release.conf.json` is mode 0600 and ignored by
Git. The normal development config contains no production endpoint or public
key. The desktop menu remains safe in that state and reports that automatic
updates require a signed release build.

Run the failure campaign with two signed versions before recording
`artifacts/updater-report.json`:

- previous release discovers, downloads, verifies, installs, and relaunches the new release;
- an artifact signed by a different key is rejected and leaves the installed app unchanged;
- a terminated/interrupted download resumes or restarts without damaging the installed app;
- an offline or 5xx endpoint remains non-fatal and a later retry succeeds.

The report must set `signatureVerified`, `previousVersionUpgrade`,
`interruptedUpdateRecovered`, `invalidSignatureRejected`, and
`offlineRetryRecovered` to true; provide distinct `fromVersion` / `toVersion`
values; and include the tested artifact's SHA-256 as `artifactSha256`. Unit
tests alone are not this evidence.

## 2. Developer ID and notarization

Let Tauri sign and submit with Apple credentials supplied by the release
environment. Verify the final `.app`, not an intermediate bundle:

```bash
npm run release:verify-macos -- -- "/absolute/path/Luma Studio.app"
```

The verifier requires a Developer ID Application authority, a 10-character
Team ID, hardened runtime, Gatekeeper acceptance, and a valid stapled ticket.
Only then does it write `artifacts/notarization-report.json`.

## 3. Remote crash receipt and symbolication

Deploy the website with server-only `LUMA_CRASH_WEBHOOK_URL` and optional
`LUMA_CRASH_WEBHOOK_TOKEN`. Point clients at its HTTPS proxy with
`NEXT_PUBLIC_LUMA_CRASH_ENDPOINT` and stamp the exact source revision in
`NEXT_PUBLIC_LUMA_RELEASE`.

```bash
LUMA_CRASH_ENDPOINT="https://luma.example/api/diagnostics/crash" \
LUMA_RELEASE="v0.6.0-rc2+git.sha" \
npm run crash:verify
```

This produces a receipt and proves the deployed transport accepts a scrubbed
payload. It deliberately leaves `symbolsResolved` false. Trigger one known
release-build crash, locate that receipt in the collector, upload/map the exact
release symbols, and confirm the stack resolves to source before changing that
field to true.

## 4. Local bundle audit and clean machines

Before leaving the build machine:

```bash
npm run bundle:audit -- --launch
```

That checks the sealed app, required file associations, absence of development
paths/URLs, and a six-second launch with isolated HOME, TMPDIR, PATH, and no
development environment variables. It writes `local-bundle-audit.json`, which
is useful but does not satisfy the clean-machine gate.

Install the notarized DMG on at least two independently identified machines
without Node, Rust, the repository, or prior Luma state. Open `.luma`, `.psd`,
`.psb`, and a raster file through Finder, complete an edit/save/reopen/export
workflow, then remove and reinstall. The evidence shape is:

```json
{
  "withoutDevEnvironment": true,
  "results": [
    { "machineId": "lab-mac-a", "installed": true, "launched": true, "fileAssociations": true },
    { "machineId": "lab-mac-b", "installed": true, "launched": true, "fileAssociations": true }
  ]
}
```

Machine IDs should be test-station identifiers, not serial numbers or personal
device data. Store the final file as `artifacts/clean-install-report.json`.

## 5. Final gate

Run `npm run rc2:check`. RC2 is shippable only when the compatibility corpus,
updater campaign, notarization, crash symbolication, and both clean machines all
pass in the same release candidate.
