import { createHash } from "node:crypto";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir, tmpdir } from "node:os";

const appPath = resolve(process.argv.find((arg) => arg.endsWith(".app")) ?? "src-tauri/target/release/bundle/macos/Luma Studio.app");
const launchRequested = process.argv.includes("--launch");

async function filesBelow(path) {
  const output = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) output.push(...await filesBelow(child));
    else if (entry.isFile()) output.push(child);
  }
  return output;
}

function plist(path) {
  return JSON.parse(execFileSync("plutil", ["-convert", "json", "-o", "-", path], { encoding: "utf8" }));
}

function commandOutput(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${command} failed: ${(result.stderr || result.stdout).trim()}`);
  return `${result.stdout}${result.stderr}`;
}

async function launchWithCleanEnvironment(executable) {
  const isolatedHome = await mkdtemp(join(tmpdir(), "luma-clean-home-"));
  try {
    const child = spawn(executable, [], {
      env: {
        HOME: isolatedHome,
        TMPDIR: isolatedHome,
        PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
        LANG: "en_US.UTF-8",
      },
      stdio: "ignore",
    });
    const outcome = await new Promise((resolveOutcome) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill("SIGTERM");
        resolveOutcome({ launched: true, remainedAliveMs: 6000 });
      }, 6000);
      child.once("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolveOutcome({ launched: false, error: error.message });
      });
      child.once("exit", (code, signal) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolveOutcome({ launched: code === 0, exitedEarly: true, code, signal });
      });
    });
    return outcome;
  } finally {
    await rm(isolatedHome, { recursive: true, force: true });
  }
}

if (!(await stat(appPath).catch(() => null))?.isDirectory()) throw new Error(`App bundle not found: ${appPath}`);
const infoPath = join(appPath, "Contents/Info.plist");
const info = plist(infoPath);
if (info.CFBundleIdentifier !== "app.luma.studio") throw new Error(`Unexpected bundle id: ${info.CFBundleIdentifier}`);
const executable = join(appPath, "Contents/MacOS", info.CFBundleExecutable);
if (!(await stat(executable).catch(() => null))?.isFile()) throw new Error("Bundle executable is missing");

execFileSync("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath], { stdio: "pipe" });
const signature = commandOutput("codesign", ["-dv", "--verbose=4", appPath]);
// Tauri may embed the frontend archive directly in the executable, in which
// case a valid bundle has no Resources directory. Inspect the complete sealed
// Contents tree instead of assuming one packaging layout.
const resources = await filesBelow(join(appPath, "Contents"));
const forbidden = ["http://localhost:3000", `${homedir()}/`, "webpack-internal://", "/@vite/client"];
const leaks = [];
let installedBytes = 0;
for (const file of resources) {
  const bytes = await readFile(file);
  installedBytes += bytes.byteLength;
  for (const needle of forbidden) if (bytes.includes(Buffer.from(needle))) leaks.push({ file, needle });
}
if (leaks.length) throw new Error(`Bundle contains development-only paths or URLs: ${leaks.map((entry) => entry.needle).join(", ")}`);

const executableSha256 = createHash("sha256").update(await readFile(executable)).digest("hex");
const extensions = new Set((info.CFBundleDocumentTypes ?? []).flatMap((entry) => entry.CFBundleTypeExtensions ?? []));
for (const extension of ["luma", "psd", "psb", "png", "jpg", "webp"]) {
  if (!extensions.has(extension)) throw new Error(`Packaged file association missing: ${extension}`);
}
const launch = launchRequested ? await launchWithCleanEnvironment(executable) : { launched: false, skipped: true };
if (launchRequested && !launch.launched) throw new Error(`Packaged app did not survive the isolated launch: ${JSON.stringify(launch)}`);

const report = {
  generatedAt: new Date().toISOString(),
  appPath,
  bundleId: info.CFBundleIdentifier,
  version: info.CFBundleShortVersionString,
  executableSha256,
  installedMiB: Number((installedBytes / 1024 / 1024).toFixed(2)),
  strictCodeSignatureValid: true,
  adHocSignature: /Signature=adhoc|TeamIdentifier=not set/.test(signature),
  developerPathsAbsent: true,
  fileAssociations: true,
  launch,
  note: "This is a same-machine isolated-environment audit, not clean-machine RC2 evidence.",
};
await mkdir("artifacts", { recursive: true });
await writeFile("artifacts/local-bundle-audit.json", `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
