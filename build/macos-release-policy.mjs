export function validateMacosCandidate({ info, signature, build, sourceSha256, executableSha256, appPath, expected }) {
  if (info.CFBundleIdentifier !== expected.identifier || info.CFBundleShortVersionString !== expected.version) {
    throw new Error("Bundle identity/version does not match the main Luma release");
  }
  if (!/^Authority=Developer ID Application:/m.test(signature) || !/^TeamIdentifier=NJBZDU7XZX$/m.test(signature)
    || !/^Timestamp=.+$/m.test(signature) || !/flags=.*\bruntime\b/.test(signature)) {
    throw new Error("Release requires a timestamped Developer ID signature for NJBZDU7XZX with hardened runtime");
  }
  if (!build || build.appPath !== appPath || build.executableSha256 !== executableSha256
    || !/^[a-f0-9]{64}$/.test(sourceSha256) || build.sourceSha256 !== sourceSha256) {
    throw new Error("Bundle does not match a current-source native build receipt; rebuild before notarizing");
  }
}
export function notarizationMatchesCandidate({ report, build, sourceSha256, executableSha256, appPath, expected }) {
  return Boolean(report && build && /^[a-f0-9]{64}$/.test(executableSha256 ?? "") &&
    report.sourceSha256 === sourceSha256 && build.sourceSha256 === sourceSha256 &&
    report.executableSha256 === executableSha256 && build.executableSha256 === executableSha256 &&
    report.appPath === appPath && build.appPath === appPath &&
    report.bundleId === expected.identifier && report.version === expected.version &&
    report.teamId === "NJBZDU7XZX" && report.status === "Accepted" &&
    report.gatekeeperAccepted === true && report.stapledTicket === true && report.hardenedRuntime === true);
}
