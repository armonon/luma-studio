/**
 * Notarize a signed desktop bundle and record what Apple actually said.
 *
 * Every field in the report is measured from the bundle or from a tool's
 * output. Nothing is asserted: `check-release-evidence.mjs` requires
 * `status === "Accepted"`, a stapled ticket, hardened runtime, a real team id
 * and a matching source fingerprint, and the only honest way to produce those
 * is to have actually notarized this build. A failure here must leave no
 * report behind rather than a report claiming less than it checked.
 *
 * Credentials are the operator's, never this script's. Store them once with
 *   xcrun notarytool store-credentials luma-notary \
 *     --apple-id <id> --team-id <team> --password <app-specific-password>
 * and pass `--keychain-profile luma-notary` (the default).
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { releaseSourceId } from "./release-source-id.mjs";

const appPath = resolve(process.argv.find((arg) => arg.endsWith(".app")) ?? "src-tauri/target/release/bundle/macos/Luma Studio.app");
const profileIndex = process.argv.indexOf("--keychain-profile");
const profile = profileIndex > 0 ? process.argv[profileIndex + 1] : "luma-notary";

function run(command, args, { allowFailure = false } = {}) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (!allowFailure && result.status !== 0) throw new Error(`${command} ${args[0]} failed:\n${output.trim()}`);
  return { status: result.status, output };
}

function plist(path) {
  return JSON.parse(spawnSync("plutil", ["-convert", "json", "-o", "-", path], { encoding: "utf8" }).stdout);
}

if (!(await stat(appPath).catch(() => null))?.isDirectory()) throw new Error(`App bundle not found: ${appPath}`);
const info = plist(join(appPath, "Contents/Info.plist"));
const executable = join(appPath, "Contents/MacOS", info.CFBundleExecutable);

// A Developer ID signature with the hardened runtime is a precondition, not an
// outcome: the notary service rejects anything else, and reading the flags here
// gives a clearer failure than a rejection ticket would.
const signature = run("codesign", ["-dv", "--verbose=4", appPath]).output;
const teamId = signature.match(/^TeamIdentifier=([A-Z0-9]{10})$/m)?.[1];
const hardenedRuntime = /flags=0x[0-9a-f]*\(.*\bruntime\b.*\)/.test(signature);
const authority = signature.match(/^Authority=(Developer ID Application: .+)$/m)?.[1];
if (!teamId) throw new Error("Bundle is not signed with a Developer ID team identifier (an ad-hoc signature cannot be notarized). Set bundle.macOS.signingIdentity in src-tauri/tauri.release.conf.json and rebuild.");
if (!authority) throw new Error("Bundle is not signed by a Developer ID Application certificate.");
if (!hardenedRuntime) throw new Error("Bundle is not signed with the hardened runtime, which notarization requires.");

// notarytool takes an archive, not a directory.
const zipPath = `${appPath}.notarize.zip`;
run("ditto", ["-c", "-k", "--keepParent", appPath, zipPath]);

const submission = run("xcrun", ["notarytool", "submit", zipPath, "--keychain-profile", profile, "--wait", "--output-format", "json"], { allowFailure: true });
let verdict;
try { verdict = JSON.parse(submission.output.slice(submission.output.indexOf("{"))); }
catch { throw new Error(`notarytool did not return JSON. Store credentials first with 'xcrun notarytool store-credentials ${profile}'.\n${submission.output.trim()}`); }
if (verdict.status !== "Accepted") {
  throw new Error(`Notarization was ${verdict.status ?? "not completed"} (id ${verdict.id ?? "unknown"}). Run 'xcrun notarytool log ${verdict.id} --keychain-profile ${profile}' for the reasons.`);
}

run("xcrun", ["stapler", "staple", appPath]);
// Read the ticket back rather than trusting that stapling reported success.
const stapledTicket = run("xcrun", ["stapler", "validate", appPath], { allowFailure: true }).status === 0;
// The question Gatekeeper answers for a user opening a download.
const assessment = run("spctl", ["--assess", "--type", "install", "-vvv", appPath], { allowFailure: true });
const gatekeeperAccepted = assessment.status === 0 && /accepted/i.test(assessment.output);

const report = {
  generatedAt: new Date().toISOString(),
  sourceSha256: releaseSourceId(),
  appPath,
  bundleId: info.CFBundleIdentifier,
  version: info.CFBundleShortVersionString,
  status: verdict.status,
  submissionId: verdict.id,
  teamId,
  authority,
  hardenedRuntime,
  stapledTicket,
  gatekeeperAccepted,
  gatekeeperAssessment: assessment.output.trim(),
  executableSha256: createHash("sha256").update(await readFile(executable)).digest("hex"),
};
if (!stapledTicket || !gatekeeperAccepted) {
  throw new Error(`Notarization succeeded but the bundle is not yet accepted locally: ${JSON.stringify({ stapledTicket, gatekeeperAccepted }, null, 2)}`);
}
await mkdir("artifacts", { recursive: true });
await writeFile("artifacts/notarization-report.json", `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
