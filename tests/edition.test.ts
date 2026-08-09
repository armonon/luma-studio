import assert from "node:assert/strict";
import test from "node:test";
import {
  CAPABILITY_STATUS,
  DEFAULT_EDITION,
  EDITION_CAPABILITIES,
  currentEdition,
  hasCapability,
  isAvailable,
  proOnlyCapabilities,
  type Capability,
} from "../app/engine/edition.ts";

test("web is the default edition and pro is a strict superset", () => {
  assert.equal(DEFAULT_EDITION, "web");
  for (const capability of EDITION_CAPABILITIES.web) {
    assert.ok(
      EDITION_CAPABILITIES.pro.includes(capability),
      `pro must not drop web capability "${capability}"`,
    );
  }
  assert.ok(proOnlyCapabilities().length > 0, "pro should add something");
  for (const capability of proOnlyCapabilities()) {
    assert.equal(hasCapability("web", capability), false);
    assert.equal(hasCapability("pro", capability), true);
  }
});

test("every capability has a declared build status", () => {
  const declared = new Set(Object.keys(CAPABILITY_STATUS));
  const used = new Set<Capability>([...EDITION_CAPABILITIES.web, ...EDITION_CAPABILITIES.pro]);
  for (const capability of used) {
    assert.ok(declared.has(capability), `"${capability}" is missing a status entry`);
  }
  assert.equal(declared.size, used.size, "no orphan status entries");
});

test("isAvailable is false for planned work even when the edition permits it", () => {
  // This is the guard against advertising unbuilt features. Anything marked
  // "planned" must not read as usable, in either edition.
  for (const [capability, status] of Object.entries(CAPABILITY_STATUS)) {
    if (status !== "planned") continue;
    for (const edition of ["web", "pro"] as const) {
      assert.equal(
        isAvailable(edition, capability as Capability),
        false,
        `planned "${capability}" must not report available in ${edition}`,
      );
    }
  }
});

test("shipped capabilities are available in the editions that permit them", () => {
  for (const [capability, status] of Object.entries(CAPABILITY_STATUS)) {
    if (status !== "shipped") continue;
    for (const edition of ["web", "pro"] as const) {
      assert.equal(
        isAvailable(edition, capability as Capability),
        hasCapability(edition, capability as Capability),
        `shipped "${capability}" should track permission in ${edition}`,
      );
    }
  }
});

test("currentEdition reads the build flag and falls back to web", () => {
  assert.equal(currentEdition({}), "web");
  assert.equal(currentEdition({ LUMA_EDITION: "pro" }), "pro");
  assert.equal(currentEdition({ NEXT_PUBLIC_LUMA_EDITION: "pro" }), "pro");
  // NEXT_PUBLIC_ wins so a client build cannot be overridden by a stray server var.
  assert.equal(currentEdition({ NEXT_PUBLIC_LUMA_EDITION: "web", LUMA_EDITION: "pro" }), "web");
  assert.equal(currentEdition({ LUMA_EDITION: "nonsense" }), "web");
});
