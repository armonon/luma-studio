import { qualifiedHostSamples } from "./qualification-host.mjs";

/** In-progress, interrupted, edited or internally inconsistent reports are not
 * release evidence, even if their completed subset happens to be all green. */
export function completedCorpusEvidence(report) {
  if (!report || report.completed !== true || report.unchanged !== true || report.interrupted !== false ||
      report.environmentQualified !== true || !qualifiedHostSamples(report.hostSamples) ||
      report.manifestUnchanged !== true || !/^[a-f\d]{64}$/i.test(report.manifestSha256 ?? "") ||
      !Number.isInteger(report.total) || report.total < 1 || report.executed !== report.total ||
      !Array.isArray(report.results) || report.results.length !== report.total) return false;
  const passed = report.results.filter(result => result.status === "pass").length;
  const failed = report.results.filter(result => result.status === "fail").length;
  return report.results.every(result => result.status !== "pass" || /^[a-f\d]{64}$/i.test(result.metrics?.inputSha256 ?? "")) &&
    passed + failed === report.total && passed === report.passed && failed === report.failed &&
    new Set(report.results.map(result => result.id)).size === report.total;
}

/** A golden PNG and an ag-psd reopen are not external application evidence.
 * The preview pilot is deliberately insufficient for this production gate. */
export function independentPhotoshopCorpusEvidence(external, internal) {
  if (!external || external.qualificationLevel !== "full-resolution-independent" ||
      external.completed !== true || external.unchanged !== true || external.manifestUnchanged !== true ||
      external.sourceSha256 !== internal?.sourceSha256 || external.manifestSha256 !== internal?.manifestSha256 ||
      !Array.isArray(external.results) || external.results.length !== external.total ||
      external.executed !== external.total || new Set(external.results.map(result => result.id)).size !== external.total) return false;
  const photoshop = internal.results?.filter(result => result.kind === "psd" || result.kind === "psb");
  if (!photoshop?.length) return false;
  return photoshop.every(result => {
    const proof = external.results.find(proof => proof.id === result.id);
    return proof?.status === "pass" && proof.application === "Adobe Photoshop" && typeof proof.version === "string" &&
      proof.inputSha256 === result.metrics?.inputSha256 && /^[a-f\d]{64}$/i.test(proof.inputSha256 ?? "") &&
      proof.sourceUnchanged === true && proof.stage === "complete" &&
      Array.isArray(proof.structuralDifferences) && proof.structuralDifferences.length === 0 &&
      proof.fullResolutionCompared === true && proof.externalEditAndSaveVerified === true &&
      proof.maskPlanesCompared === true && proof.colorProfileCompared === true &&
      proof.artifacts?.length >= 6 && proof.artifacts.every(artifact => typeof artifact.file === "string" && /^[a-f\d]{64}$/i.test(artifact.sha256 ?? ""));
  });
}
