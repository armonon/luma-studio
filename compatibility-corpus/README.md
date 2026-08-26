# Luma compatibility corpus

This directory is intentionally manifest-only. Real client PSD, PSB, and RAW files must not be committed unless their license and consent are documented.

Copy `manifest.example.json` to `manifest.json`, place approved files beneath this directory, and run:

```sh
npm run corpus:check
```

For a private local corpus that must remain in place, set `sourceRoot` in the ignored `manifest.json` and keep every case path relative to that explicit root. Absolute case paths and `..` traversal are rejected. Corpus source files and the private manifest are ignored by Git.

The RC1 gate requires at least 50 cases and coverage of PSD, PSB, and RAW. Every successful case declares dimensions, a peak-RAM ceiling, and a duration ceiling. Photoshop cases must also declare the source layer count and either an editable minimum layer count or an explicit flattened fallback. Declared flattened fallbacks remain useful safety evidence, but do not satisfy the editable-compatibility RC gate. PSD/PSB cases run open → bounded edit → `.luma` save/reopen → PSD/PSB export/reopen. A Photoshop-rendered `referencePng` is required for final RC evidence; self-roundtrip previews alone are reported honestly as such. Sensor RAW cases run develop → nondestructive redevelop → `.luma` save/reopen → PNG export. Preview-only RAW support must be declared explicitly. Malformed cases pass only when they are rejected with the expected error.

Use ugly, representative files: old Photoshop versions, 16-bit documents, smart objects, masks, layer effects, unusual profiles, very deep stacks, panoramas, each supported camera family, and deliberately corrupt/truncated inputs. Keep the case-specific visual tolerance as low as the source permits; warning limits make known fidelity gaps visible instead of silently accepted.

The generated JSON report belongs in `artifacts/compatibility-corpus-report.json` and should be attached to every RC build.

During triage, run one case or a comma-separated subset without weakening the
release gate itself:

```sh
npx tsx build/run-compatibility-corpus.ts --minimum 1 --require-kinds psd --case photoshop-layered-rgb8,photoshop-large-document
```

Every result records and enforces elapsed wall time and the Node process peak
resident set, so compatibility cannot stay green while memory silently grows.
