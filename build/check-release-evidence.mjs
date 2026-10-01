import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { notarizationMatchesCandidate } from "./macos-release-policy.mjs";
import { validUpdaterConfiguration } from "./release-config.mjs";
import { releaseSourceId, evidenceMatchesSource } from "./release-source-id.mjs";
import { completedCorpusEvidence, independentPhotoshopCorpusEvidence } from "./corpus-evidence.mjs";

const requested = process.argv[2] ?? "status";
const phases = { rc0: 0, rc1: 1, rc2: 2, status: 2 };
if (!(requested in phases)) throw new Error("Usage: node build/check-release-evidence.mjs [rc0|rc1|rc2|status]");

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
const externalCorpus = await json("artifacts/photoshop-external-report.json");
const externalQualified = independentPhotoshopCorpusEvidence(externalCorpus, corpus);
const corpusResults = Array.isArray(corpus?.results) ? corpus.results : [];
const photoshopResults = corpusResults.filter((entry) => entry.kind === "psd" || entry.kind === "psb");
const corpusIsEditable = photoshopResults.length > 0 && photoshopResults.every((entry) =>
  entry.status === "pass" && entry.metrics?.importMode === "layered");
const corpusHasReferences = photoshopResults.length > 0 && photoshopResults.every((entry) =>
  entry.status === "pass" && entry.metrics?.reference === "photoshop-golden");
const notarization = await json("artifacts/notarization-report.json");
const updater = await json("artifacts/updater-report.json");
const crashes = await json("artifacts/crash-reporting-report.json");
const cleanInstall = await json("artifacts/clean-install-report.json");
const cleanMachines = Array.isArray(cleanInstall?.results) ? cleanInstall.results : [];
const uniqueCleanMachines = new Set(cleanMachines.map((entry) => entry?.machineId).filter(Boolean));
const sourceSha256 = releaseSourceId();
const nativeBuild = await json("artifacts/native-build-report.json");
const appPath = resolve("src-tauri/target/release/bundle/macos/Luma Studio.app");
const executableBytes = await readFile(resolve(appPath, "Contents/MacOS/luma-studio")).catch(() => null);
const executableSha256 = executableBytes ? createHash("sha256").update(executableBytes).digest("hex") : null;
const notarizationQualified = notarizationMatchesCandidate({ report: notarization, build: nativeBuild,
  sourceSha256, executableSha256, appPath, expected: tauri });
const local = await json("artifacts/local-hardening-report.json");
const localQualified = evidenceMatchesSource(local, sourceSha256) && local.unchanged === true &&
  ["types", "engine-regressions", "lint", "native-bridge", "native-core"].every(id => local.checks?.some(check => check.id === id && check.pass === true && check.exitCode === 0));
const localDetail = localQualified ? "current-source local campaign passed" : "fresh local qualification required: npm run qualify:local";

const checks = [
  { phase: 0, name: "P0 checkpoint tagged", pass: tagged("v0.5.0-alpha-p0"), detail: "v0.5.0-alpha-p0" },
  { phase: 0, name: "Sparse selection regressions", pass: localQualified, detail: localDetail },
  { phase: 0, name: "Sparse layer-mask regressions", pass: localQualified, detail: localDetail },
  { phase: 0, name: "Recovery/destructive regressions", pass: localQualified, detail: localDetail },
  {
    phase: 1,
    name: "Real compatibility corpus",
    pass: evidenceMatchesSource(corpus, sourceSha256) && completedCorpusEvidence(corpus) && corpus.total >= 50 && corpus.failed === 0 &&
      ["psd", "psb", "raw"].every((kind) => corpusResults.some((entry) => entry.kind === kind && entry.status === "pass")) &&
      corpusIsEditable && corpusHasReferences && externalQualified,
    detail: corpus
      ? `${evidenceMatchesSource(corpus, sourceSha256) ? "CURRENT SOURCE" : "STALE EVIDENCE"} · ${completedCorpusEvidence(corpus) ? "complete" : "incomplete/unverified campaign"} · ${corpus.passed ?? 0}/${corpus.total ?? 0} workflow pass · ${photoshopResults.filter(entry => entry.status === "pass" && entry.metrics?.importMode === "layered").length}/${photoshopResults.length} layered · all editable ${corpusIsEditable ? "yes" : "no"} · Photoshop goldens ${corpusHasReferences ? "yes" : "no"} · artifacts/compatibility-corpus-report.json`
      : "report missing",
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
    pass: evidenceMatchesSource(updater, sourceSha256) && updater?.signatureVerified === true && updater?.previousVersionUpgrade === true &&
      updater?.interruptedUpdateRecovered === true && updater?.invalidSignatureRejected === true &&
      updater?.offlineRetryRecovered === true && typeof updater?.fromVersion === "string" &&
      typeof updater?.toVersion === "string" && updater.fromVersion !== updater.toVersion &&
      /^[a-f0-9]{64}$/.test(updater?.artifactSha256 ?? ""),
    detail: updater ? "evidence loaded" : "report missing",
  },
  {
    phase: 2,
    name: "Apple signing and notarization",
    pass: notarizationQualified,
    detail: notarizationQualified ? "exact current-source native candidate accepted" : "missing or stale native-candidate notarization evidence",
  },
  {
    phase: 2,
    name: "Remote crash reporting",
    pass: evidenceMatchesSource(crashes, sourceSha256) && crashes?.remoteCrashReceived === true && crashes?.symbolsResolved === true && crashes?.sensitiveDataScrubbed === true &&
      typeof crashes?.receiptId === "string" && crashes.receiptId.length > 8,
    detail: crashes ? "evidence loaded" : "report missing",
  },
  {
    phase: 2,
    name: "Clean-machine installation",
    pass: evidenceMatchesSource(cleanInstall, sourceSha256) && cleanInstall?.withoutDevEnvironment === true && uniqueCleanMachines.size >= 2 &&
      cleanMachines.every((entry) => entry?.installed === true && entry?.launched === true && entry?.fileAssociations === true),
    detail: cleanInstall ? `${uniqueCleanMachines.size} independently identified machines` : "report missing",
  },
];

const selected = checks.filter((check) => check.phase <= phases[requested]);
if (phases[requested] >= 1) console.log(`Independent Photoshop evidence: ${externalQualified ? "qualified" : externalCorpus ? `${externalCorpus.qualificationLevel ?? "unclassified"} · ${externalCorpus.passed ?? 0}/${externalCorpus.total ?? 0} pass · not production-qualified` : "missing"}`);
for (const check of selected) console.log(`${check.pass ? "PASS" : "FAIL"} ${check.name} — ${check.detail}`);
const failed = selected.filter((check) => !check.pass);
console.log(`\n${selected.length - failed.length}/${selected.length} release evidence gates pass.`);
if (requested !== "status" && failed.length) process.exitCode = 1;
