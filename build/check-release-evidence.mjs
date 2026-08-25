import { access, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

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
const corpus = await json("artifacts/compatibility-corpus-report.json");
const notarization = await json("artifacts/notarization-report.json");
const updater = await json("artifacts/updater-report.json");
const crashes = await json("artifacts/crash-reporting-report.json");
const cleanInstall = await json("artifacts/clean-install-report.json");

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
    pass: cargo.includes("tauri-plugin-updater") && !!tauri.plugins?.updater?.pubkey &&
      Array.isArray(tauri.plugins?.updater?.endpoints) && tauri.plugins.updater.endpoints.length > 0,
    detail: "signed endpoint + embedded public key",
  },
  {
    phase: 2,
    name: "Updater failure campaign",
    pass: updater?.signatureVerified === true && updater?.previousVersionUpgrade === true && updater?.interruptedUpdateRecovered === true,
    detail: updater ? "evidence loaded" : "report missing",
  },
  {
    phase: 2,
    name: "Apple signing and notarization",
    pass: notarization?.status === "Accepted" && notarization?.bundleId === tauri.identifier && notarization?.gatekeeperAccepted === true,
    detail: notarization ? String(notarization.status ?? "invalid report") : "report missing",
  },
  {
    phase: 2,
    name: "Remote crash reporting",
    pass: crashes?.remoteCrashReceived === true && crashes?.symbolsResolved === true && crashes?.sensitiveDataScrubbed === true,
    detail: crashes ? "evidence loaded" : "report missing",
  },
  {
    phase: 2,
    name: "Clean-machine installation",
    pass: cleanInstall?.withoutDevEnvironment === true && cleanInstall?.machines >= 2 && cleanInstall?.fileAssociations === true,
    detail: cleanInstall ? `${cleanInstall.machines ?? 0} machines` : "report missing",
  },
];

const selected = checks.filter((check) => check.phase <= phases[requested]);
for (const check of selected) console.log(`${check.pass ? "PASS" : "FAIL"} ${check.name} — ${check.detail}`);
const failed = selected.filter((check) => !check.pass);
console.log(`\n${selected.length - failed.length}/${selected.length} release evidence gates pass.`);
if (requested !== "status" && failed.length) process.exitCode = 1;
