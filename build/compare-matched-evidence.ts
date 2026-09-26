import { loadMatchedEvidence } from "./load-matched-evidence";
import { compareMatchedWorkflows } from "./matched-workflow-evidence";

if (process.argv.length !== 4) throw new Error("Usage: npm run benchmark:matched -- luma.json competitor.json");
// Sequential streaming avoids doubling I/O pressure for retained project files.
const luma = await loadMatchedEvidence(process.argv[2]);
const competitor = await loadMatchedEvidence(process.argv[3]);
const report = compareMatchedWorkflows(luma, competitor);
console.log(JSON.stringify(report, null, 2));
if (report.status !== "recorded-samples-compared") process.exitCode = 1;
