import { access, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { validUpdaterConfiguration } from "./release-config.mjs";

const requested = process.argv[2] ?? "status";
const phases = { rc0: 0, rc1: 1, rc2: 2, status: 2 };
if (!(requested in phases)) throw new Error("Usage: node build/check-release-evidence.mjs [rc0|rc1|rc2|status]");

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

async function json(path) {
  try { return JSON.parse(await readFile(path, "utf8")); } catch { return null; }
}

function tagged(name) {
  try {
    execFileSync("git", ["rev-parse", "-q", "--verify", `refs/tags/${name}`], { stdio: "ignore" });
    return true;
  } catch { return false; }
}

const cargo = await readFile("src-tauri/Cargo.toml", "utf8");
const tauri = JSON.parse(await readFile("src-tauri/tauri.conf.json", "utf8"));
const tauriRelease = await json("src-tauri/tauri.release.conf.json");
const updaterConfig = tauriRelease?.plugins?.updater ?? tauri.plugins?.updater;
const updaterArtifacts = tauriRelease?.bundle?.createUpdaterArtifacts ?? tauri.bundle?.createUpdaterArtifacts;
const nativeMain = await readFile("src-tauri/src/main.rs", "utf8");
const corpus = await json("artifacts/compatibility-corpus-report.json");
const notarization = await json("artifacts/notarization-report.json");
const updater = await json("artifacts/updater-report.json");
const crashes = await json("artifacts/crash-reporting-report.json");
const cleanInstall = await json("artifacts/clean-install-report.json");
const cleanMachines = Array.isArray(cleanInstall?.results) ? cleanInstall.results : [];
const uniqueCleanMachines = new Set(cleanMachines.map((entry) => entry?.machineId).filter(Boolean));

const checks = [
  { phase: 0, name: "P0 checkpoint tagged", pass: tagged("v0.5.0-alpha-p0"), detail: "v0.5.0-alpha-p0" },
  { phase: 0, name: "Sparse selection implementation", pass: await exists("app/engine/alpha-surface.ts") && await exists("tests/extreme-alpha-memory.test.ts"), detail: "implementation + extreme-size tests" },
  { phase: 0, name: "Sparse layer-mask implementation", pass: await exists("app/engine/layer-mask.ts") && await exists("tests/sparse-mask.test.ts"), detail: "shared alpha tiles + mask tests" },
  { phase: 0, name: "Recovery/destructive tests", pass: await exists("tests/recovery-rc.test.ts"), detail: "workspace recovery, corrupt import, long history" },
  {
    phase: 1,
    name: "Real compatibility corpus",
    pass: !!corpus && corpus.total >= 50 && corpus.failed === 0 &&
      ["psd", "psb", "raw"].every((kind) => corpus.results?.some((entry) => entry.kind === kind && entry.status === "pass")),
    detail: corpus ? `${corpus.passed ?? 0}/${corpus.total ?? 0} pass` : "report missing",
  },
  {
    phase: 2,
    name: "Updater configured",
    pass: cargo.includes("tauri-plugin-updater") && nativeMain.includes("tauri_plugin_updater::Builder") &&
      updaterArtifacts === true && validUpdaterConfiguration(updaterConfig),
    detail: validUpdaterConfiguration(updaterConfig)
      ? "runtime + signed artifacts + validated HTTPS endpoint/public key"
      : "runtime ready; production HTTPS endpoint/public key missing",
  },
  {
    phase: 2,
    name: "Updater failure campaign",
    pass: updater?.signatureVerified === true && updater?.previousVersionUpgrade === true &&
      updater?.interruptedUpdateRecovered === true && updater?.invalidSignatureRejected === true &&
      updater?.offlineRetryRecovered === true && typeof updater?.fromVersion === "string" &&
      typeof updater?.toVersion === "string" && updater.fromVersion !== updater.toVersion &&
      /^[a-f0-9]{64}$/.test(updater?.artifactSha256 ?? ""),
    detail: updater ? "evidence loaded" : "report missing",
  },
  {
    phase: 2,
    name: "Apple signing and notarization",
    pass: notarization?.status === "Accepted" && notarization?.bundleId === tauri.identifier &&
      notarization?.gatekeeperAccepted === true && notarization?.stapledTicket === true &&
      notarization?.hardenedRuntime === true && /^[A-Z0-9]{10}$/.test(notarization?.teamId ?? "") &&
      /^[a-f0-9]{64}$/.test(notarization?.executableSha256 ?? ""),
    detail: notarization ? String(notarization.status ?? "invalid report") : "report missing",
  },
  {
    phase: 2,
    name: "Remote crash reporting",
    pass: crashes?.remoteCrashReceived === true && crashes?.symbolsResolved === true && crashes?.sensitiveDataScrubbed === true &&
      typeof crashes?.receiptId === "string" && crashes.receiptId.length > 8,
    detail: crashes ? "evidence loaded" : "report missing",
  },
  {
    phase: 2,
    name: "Clean-machine installation",
    pass: cleanInstall?.withoutDevEnvironment === true && uniqueCleanMachines.size >= 2 &&
      cleanMachines.every((entry) => entry?.installed === true && entry?.launched === true && entry?.fileAssociations === true),
    detail: cleanInstall ? `${uniqueCleanMachines.size} independently identified machines` : "report missing",
  },
];

const selected = checks.filter((check) => check.phase <= phases[requested]);
for (const check of selected) console.log(`${check.pass ? "PASS" : "FAIL"} ${check.name} — ${check.detail}`);
const failed = selected.filter((check) => !check.pass);
console.log(`\n${selected.length - failed.length}/${selected.length} release evidence gates pass.`);
if (requested !== "status" && failed.length) process.exitCode = 1;
