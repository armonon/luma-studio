# Shipping runbook — closing the release evidence gates

`npm run release:status` reports 1 of 10 gates passing. This is the order to
close them in, and the two facts that make the order matter.

## Read this first: evidence is bound to the source, and it is bound tightly

`build/release-source-id.mjs` hashes **every** source file — tracked and
untracked — under `app/`, `build/`, `tests/`, `public/`, `src-tauri/`,
`crates/`, `package.json`, `package-lock.json` and the config files. Each
evidence report records that hash, and `check-release-evidence.mjs` accepts a
report only when the hash still matches.

Two consequences:

1. **Any source edit invalidates every gate that was passing.** Three gates
   currently read `FAIL … fresh local qualification required` for exactly this
   reason: the code moved after the last qualification run. They are stale, not
   broken.
2. **Generate evidence last.** Editing a script to produce evidence changes the
   fingerprint that the evidence you just produced was stamped with. Land every
   source change, then run the evidence commands in one pass without touching
   the tree in between.

## What each gate actually needs

| Gate | Blocked on | Yours or ours |
| --- | --- | --- |
| P0 checkpoint | — | passing |
| Sparse selections / sparse masks / recovery | `npm run qualify:local` after the tree settles | ours |
| Real compatibility corpus | 50 real projects, Photoshop goldens, `--minimum 50` | needs your files and a Photoshop licence |
| Updater configured | a minisign keypair and an HTTPS manifest host | your secret, your host |
| Updater failure campaign | two signed versions, then the upgrade/interrupt/invalid-signature/offline runs | after the above |
| Apple signing and notarization | `notarytool` credentials; the certificate is already here | your Apple ID password |
| Remote crash reporting | the crash route deployed at an HTTPS origin | your host |
| Clean-machine installation | two Macs without a development environment | yours |

## The signing certificate is already in place

```
Developer ID Application: Armon Nasiri (NJBZDU7XZX)
```

That is the right certificate type for distribution outside the App Store, so
notarization is not blocked on an account or a purchase. It is blocked on one
credential that cannot come from anywhere but your Apple ID:

```bash
xcrun notarytool store-credentials luma-notary \
  --apple-id <your-apple-id> --team-id NJBZDU7XZX --password <app-specific-password>
```

Create the app-specific password at appleid.apple.com → Sign-In and Security →
App-Specific Passwords. It is not your Apple ID password.

## The updater keypair is yours to generate

The private key signs every future update. If it leaks, anything signed with it
is accepted by every installed copy; if it is lost, no future update is
accepted by them either. Generate it yourself, choose the password yourself,
and back it up somewhere you would trust with a code-signing secret:

```bash
npx tauri signer generate -w ~/.luma/updater.key
```

Then export the public half, plus the hosts, before configuring a release:

```bash
export LUMA_UPDATER_PUBKEY="$(base64 < ~/.luma/updater.key.pub)"
export LUMA_UPDATER_ENDPOINT="https://<your-host>/luma/{{target}}/{{arch}}/{{current_version}}"
export NEXT_PUBLIC_LUMA_CRASH_ENDPOINT="https://<your-host>/api/diagnostics/crash"
export APPLE_SIGNING_IDENTITY="Developer ID Application: Armon Nasiri (NJBZDU7XZX)"
```

`build/generate-tauri-release-config.mjs` validates all four and refuses
placeholders, a non-HTTPS endpoint, a key that only looks like minisign, and a
signing identity without a 10-character team id. It writes
`src-tauri/tauri.release.conf.json` at mode 600; that file is gitignored and
must stay that way.

## The sequence

```bash
# 1. Build a signed release bundle.
npm run pro:release

# 2. Audit it locally, then notarize, staple and check Gatekeeper.
node build/audit-desktop-bundle.mjs --launch
npm run pro:notarize

# 3. Prove the deployed crash collector really received a scrubbed report.
LUMA_CRASH_ENDPOINT="$NEXT_PUBLIC_LUMA_CRASH_ENDPOINT" npm run crash:verify

# 4. Re-qualify last, once nothing else will touch the tree.
npm run qualify:local
npm run release:status
```

Step 2 produces `artifacts/notarization-report.json` from measured values only:
the team id and hardened-runtime flag are read back out of the signature, the
notary verdict is Apple's own JSON, the stapled ticket is re-validated rather
than assumed, and Gatekeeper is asked the question a user's download asks. If
any of those falls short the script throws and writes no report, because a
report that overstates what it checked is worse than a missing gate.

## What this sequence still will not give you

Two gates cannot be closed on one machine, by design:

- **Clean-machine installation** needs two Macs that have never had Xcode or a
  development build on them. The local audit says so itself.
- **The compatibility corpus** needs real projects and Photoshop-rendered
  golden references. Synthetic fidelity tests prove the encoder agrees with the
  decoder; they cannot prove either agrees with Photoshop.

The corpus is the one gate that no amount of infrastructure work closes, and it
is the one the phrase "Photoshop rival" actually rests on.
