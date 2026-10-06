# Luma bundled font library

These are unmodified font files from the Google Fonts repository, pinned to revision `e44c4b011a820c2cbe2fd2cfa8052037d7edb571`.

12 families, 28 static faces: Lato, Arvo, Abel, Anton, Lobster, Pacifico, Space Mono, Bangers, Righteous, Rajdhani, Amatic SC, and Great Vibes.

Each family's copyright notice and SIL Open Font License 1.1 is retained in its adjacent `*-OFL.txt`. The fonts retain their original names and licenses; no endorsement by their authors is implied. These files are bundled with Luma, not sold separately. See `manifest.json` for exact sources, sizes, and SHA-256 hashes.

Fonts are loaded from the application itself, on demand. No external font service is contacted. The desktop bundle works offline; the web edition serves these files from its own origin. Other system-font suggestions in the font picker are not bundled and may fall back on machines without them.

For maintainers: `build/vendor-fonts.ts` is the explicit asset-update command. Normal builds use these checked-in files and do not fetch fonts.
