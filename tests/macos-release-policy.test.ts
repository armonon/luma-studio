import assert from "node:assert/strict";
import test from "node:test";
import { validateMacosCandidate, notarizationMatchesCandidate } from "../build/macos-release-policy.mjs";

const input = {
  info: { CFBundleIdentifier: "app.luma.studio", CFBundleShortVersionString: "0.6.0-rc.0" },
  expected: { identifier: "app.luma.studio", version: "0.6.0-rc.0" },
  signature: "Authority=Developer ID Application: Armon Nasiri (NJBZDU7XZX)\nTeamIdentifier=NJBZDU7XZX\nTimestamp=Sep 28, 2026\nflags=0x10000(runtime)",
  sourceSha256: "a".repeat(64), executableSha256: "b".repeat(64), appPath: "/tmp/Luma Studio.app",
  build: { sourceSha256: "a".repeat(64), executableSha256: "b".repeat(64), appPath: "/tmp/Luma Studio.app" },
};
test("only the exact current-source main bundle can produce release evidence", () => {
  assert.doesNotThrow(() => validateMacosCandidate(input));
  assert.throws(() => validateMacosCandidate({ ...input, sourceSha256: "c".repeat(64) }), /receipt/);
  assert.throws(() => validateMacosCandidate({ ...input, executableSha256: "c".repeat(64) }), /receipt/);
  assert.throws(() => validateMacosCandidate({ ...input, info: { ...input.info, CFBundleIdentifier: "app.luma.studio.review" } }), /identity/);
  assert.throws(() => validateMacosCandidate({ ...input, signature: input.signature.replaceAll("NJBZDU7XZX", "OTHERTEAM1") }), /Developer ID/);
  assert.throws(() => validateMacosCandidate({ ...input, signature: input.signature.replace("Timestamp=", "Signed Time=") }), /timestamped/);
});

test("a same-source rebuild cannot inherit an older notarization report", () => {
  const report = { ...input.build, bundleId: input.expected.identifier, version: input.expected.version,
    teamId: "NJBZDU7XZX", status: "Accepted", gatekeeperAccepted: true, stapledTicket: true, hardenedRuntime: true };
  assert.equal(notarizationMatchesCandidate({ ...input, report }), true);
  assert.equal(notarizationMatchesCandidate({ ...input, report, executableSha256: "c".repeat(64) }), false);
  assert.equal(notarizationMatchesCandidate({ ...input, report: { ...report, teamId: "OTHERTEAM1" } }), false);
  assert.equal(notarizationMatchesCandidate({ ...input, report: { ...report, version: "0.5.0" } }), false);
  assert.equal(notarizationMatchesCandidate({ ...input, report, build: null }), false);
});
