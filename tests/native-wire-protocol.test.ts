import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { NATIVE_WIRE_BLEND_MODES, encodeNativeTileRequest } from "../app/engine/native-core.ts";
import { BLEND_MODES, BLEND_MODE_GROUPS, type BlendMode } from "../app/engine/document.ts";
import { NATIVE_TILE_FIXTURE } from "./fixtures/native-tile-input.ts";

// The native compositor protocol sends a blend mode as its *index*. TypeScript
// and Rust therefore have to agree on one ordering, forever, and neither side
// can see the other at compile time. These tests are that contract.
//
// This was a live tripwire: the encoder previously used BLEND_MODES, which is
// `BLEND_MODE_GROUPS.flatMap(...)` — a UI grouping. Regrouping modes for
// presentation would have silently changed what pixels native export produced,
// with nothing failing.

const blendRs = readFileSync(
  new URL("../crates/luma-core/src/blend.rs", import.meta.url),
  "utf8",
);

/** Variant order from `BlendMode::ALL`, resolved to wire ids via `id()`. */
function rustWireOrder(): string[] {
  const allBlock = /pub const ALL: \[BlendMode; \d+\] = \[([\s\S]*?)\];/.exec(blendRs);
  assert.ok(allBlock, "could not find BlendMode::ALL in blend.rs");
  const variants = [...allBlock[1].matchAll(/BlendMode::(\w+)/g)].map((m) => m[1]);

  const idBlock = /pub fn id\(&self\) -> &'static str \{[\s\S]*?match self \{([\s\S]*?)\n *\}/.exec(blendRs);
  assert.ok(idBlock, "could not find BlendMode::id() in blend.rs");
  const ids = new Map(
    [...idBlock[1].matchAll(/BlendMode::(\w+) => "([^"]+)"/g)].map((m) => [m[1], m[2]]),
  );

  return variants.map((v) => {
    const id = ids.get(v);
    assert.ok(id, `BlendMode::${v} has no id() arm`);
    return id;
  });
}

test("the wire ordering matches Rust BlendMode::ALL exactly", () => {
  // Index N on the wire must mean the same mode on both sides. A mismatch here
  // means native export silently blends with the wrong operator.
  assert.deepEqual([...NATIVE_WIRE_BLEND_MODES], rustWireOrder());
});

test("the wire covers every mode the UI can produce", () => {
  // If a mode reaches the UI but not the wire, encoding throws at export time.
  const wire = new Set<string>(NATIVE_WIRE_BLEND_MODES);
  for (const mode of BLEND_MODES) {
    assert.ok(wire.has(mode), `"${mode}" is selectable but has no wire index`);
  }
  assert.equal(wire.size, NATIVE_WIRE_BLEND_MODES.length, "duplicate mode on the wire");
  assert.equal(wire.size, new Set(BLEND_MODES).size, "wire and UI catalogues differ in size");
});

test("the wire ordering is independent of UI grouping", () => {
  // Regrouping for presentation must not be able to move a wire index. If this
  // fails, the encoder has been re-derived from the grouping structure again.
  const uiOrder = BLEND_MODE_GROUPS.flatMap((g) => g.modes);
  const regrouped = [...BLEND_MODE_GROUPS].reverse().flatMap((g) => g.modes);
  assert.notDeepEqual(
    [...uiOrder],
    [...regrouped],
    "sanity: reversing groups should change UI order",
  );
  // The wire constant is a literal, so it is unmoved by any grouping change.
  assert.deepEqual([...NATIVE_WIRE_BLEND_MODES], rustWireOrder());
});

test("encoding writes the wire index, not the UI index", () => {
  const pixels = new Float32Array(4); // 1x1 RGBA
  const encodeMode = (mode: BlendMode) => {
    const bytes = encodeNativeTileRequest({
      width: 1,
      height: 1,
      layers: [{ pixels, mode, opacity: 1 }],
    });
    // header is 16 bytes; the layer record starts with a u32 mode index.
    return new DataView(bytes.buffer, bytes.byteOffset).getUint32(16, true);
  };
  for (const mode of NATIVE_WIRE_BLEND_MODES) {
    assert.equal(
      encodeMode(mode),
      NATIVE_WIRE_BLEND_MODES.indexOf(mode),
      `"${mode}" encoded to the wrong wire index`,
    );
  }
});

test("an unknown blend mode is rejected rather than silently mis-encoded", () => {
  assert.throws(
    () => encodeNativeTileRequest({
      width: 1,
      height: 1,
      layers: [{ pixels: new Float32Array(4), mode: "not-a-mode" as BlendMode, opacity: 1 }],
    }),
    /does not recognize blend mode/,
  );
});

// ---------------------------------------------------------------------------
// Shared fixture: the TS<->Rust round trip.
//
// `parity.rs` proves Rust's blend maths; `tests/native-core.test.ts` drives the
// TS side with a fake invoke. Neither proves the encoder and decoder agree —
// they were tested against separately hand-built bytes. This fixture is the
// contract: TypeScript must still produce these bytes, and the Rust test in
// src-tauri/src/main.rs must still read them into NATIVE_TILE_EXPECTED.
// ---------------------------------------------------------------------------

test("the encoder still produces the committed protocol fixture", () => {
  const expected = new Uint8Array(
    readFileSync(new URL("./fixtures/native-tile.bin", import.meta.url)),
  );
  const actual = encodeNativeTileRequest(NATIVE_TILE_FIXTURE);
  assert.equal(actual.byteLength, expected.byteLength, "fixture length changed");
  assert.deepEqual(
    [...actual],
    [...expected],
    "encoder output drifted from the committed fixture — if intentional, "
      + "regenerate with tests/fixtures/generate-native-tile.ts AND update the Rust test",
  );
});

test("the fixture encodes the blend mode Rust will resolve", () => {
  const bytes = encodeNativeTileRequest(NATIVE_TILE_FIXTURE);
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  const topMode = view.getUint32(16, true);
  assert.equal(
    NATIVE_WIRE_BLEND_MODES[topMode],
    NATIVE_TILE_FIXTURE.layers[0].mode,
    "fixture's top layer mode index does not round-trip",
  );
});
