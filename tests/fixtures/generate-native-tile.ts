/**
 * Regenerates `native-tile.bin`, the shared TS<->Rust protocol fixture.
 *
 *   npx tsx tests/fixtures/generate-native-tile.ts
 *
 * The committed bytes are the contract: `tests/native-wire-protocol.test.ts`
 * asserts the TypeScript encoder still produces them, and the Rust test in
 * `src-tauri/src/main.rs` asserts its decoder still reads them into the
 * expected pixels. Regenerate only when intentionally changing the protocol,
 * and update both sides together.
 */
import { writeFileSync } from "node:fs";
import { encodeNativeTileRequest } from "../../app/engine/native-core.ts";
import { NATIVE_TILE_FIXTURE } from "./native-tile-input.ts";

const bytes = encodeNativeTileRequest(NATIVE_TILE_FIXTURE);
writeFileSync(new URL("./native-tile.bin", import.meta.url), bytes);
console.log(`wrote native-tile.bin (${bytes.byteLength} bytes)`);
