import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const appPath = resolve(process.argv.find((arg) => arg.endsWith(".app")) ?? "src-tauri/target/release/bundle/macos/Luma Studio.app");
function commandOutput(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${command} failed: ${(result.stderr || result.stdout).trim()}`);
  return `${result.stdout}${result.stderr}`;
}
if (!(await stat(appPath).catch(() => null))?.isDirectory()) throw new Error(`App bundle not found: ${appPath}`);
const info = JSON.parse(execFileSync("plutil", ["-convert", "json", "-o", "-", join(appPath, "Contents/Info.plist")], { encoding: "utf8" }));
execFileSync("codesign", ["--verify", "--deep", "--strict", "--verbose=4", appPath], { stdio: "pipe" });
const signature = commandOutput("codesign", ["-dv", "--verbose=4", appPath]);
if (!/Authority=Developer ID Application:/.test(signature)) throw new Error("Bundle is not signed with a Developer ID Application certificate");
const teamId = /TeamIdentifier=([A-Z0-9]{10})/.exec(signature)?.[1];
if (!teamId) throw new Error("Developer ID signature has no Apple Team ID");
if (!/flags=.*runtime/.test(signature)) throw new Error("Hardened runtime is not enabled");

const gatekeeper = commandOutput("spctl", ["--assess", "--type", "execute", "--verbose=4", appPath]);
const stapler = commandOutput("xcrun", ["stapler", "validate", appPath]);
const executable = join(appPath, "Contents/MacOS", info.CFBundleExecutable);
const executableSha256 = createHash("sha256").update(await readFile(executable)).digest("hex");
const report = {
  generatedAt: new Date().toISOString(),
  status: "Accepted",
  bundleId: info.CFBundleIdentifier,
  version: info.CFBundleShortVersionString,
  teamId,
  hardenedRuntime: true,
  gatekeeperAccepted: true,
  stapledTicket: true,
  executableSha256,
  gatekeeper: gatekeeper.trim(),
  stapler: stapler.trim(),
};
await mkdir("artifacts", { recursive: true });
await writeFile("artifacts/notarization-report.json", `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
