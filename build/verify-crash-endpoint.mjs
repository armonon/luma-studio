import { mkdir, writeFile } from "node:fs/promises";
import { releaseSourceId } from "./release-source-id.mjs";

const sourceSha256 = releaseSourceId();

const endpoint = process.env.LUMA_CRASH_ENDPOINT;
if (!endpoint || new URL(endpoint).protocol !== "https:") {
  throw new Error("LUMA_CRASH_ENDPOINT must be the deployed HTTPS crash-ingest URL");
}
const release = process.env.LUMA_RELEASE ?? `verification-${new Date().toISOString()}`;
const eventId = `release-probe-${crypto.randomUUID()}`;
const response = await fetch(endpoint, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    schema: "luma-crash/1",
    release,
    edition: "pro",
    event: {
      id: eventId,
      kind: "crash",
      timestamp: new Date().toISOString(),
      message: "Synthetic release verification from /Users/private/Luma/probe.psd",
      stack: "at https://luma.invalid/private?token=never-send",
      context: { synthetic: true },
    },
  }),
});
const result = await response.json().catch(() => null);
if (response.status !== 202 || result?.accepted !== true || typeof result?.receiptId !== "string") {
  throw new Error(`Crash endpoint verification failed (${response.status})`);
}
await mkdir("artifacts", { recursive: true });
await writeFile("artifacts/crash-reporting-report.json", `${JSON.stringify({
  sourceSha256,
  generatedAt: new Date().toISOString(),
  release,
  remoteCrashReceived: true,
  receiptId: result.receiptId,
  sensitiveDataScrubbed: false,
  symbolsResolved: false,
  note: "The endpoint accepted a synthetic crash. Stored-payload scrubbing and symbolication must be independently confirmed in the collector before RC2.",
}, null, 2)}\n`);
console.log(`Crash endpoint accepted receipt ${result.receiptId}; symbolication remains unverified.`);
