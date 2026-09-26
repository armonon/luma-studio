import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { inspectPrintReadiness } from "../app/engine/print-readiness.ts";
const file = process.argv[2];
if (!file) throw new Error("Usage: tsx build/inspect-print-delivery.ts file.pdf");
if ((await stat(file)).size > 8 * 1024 * 1024) throw new Error("Print inspection accepts PDFs up to 8 MiB");
const bytes = await readFile(file);
console.log(JSON.stringify({ file, sha256: createHash("sha256").update(bytes).digest("hex"), ...await inspectPrintReadiness(bytes) }, null, 2));
// A clean structural check is deliberately not sufficient to pass certification.
process.exitCode = 2;
