import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, PDFName } from "pdf-lib";
import { inspectPrintReadiness } from "../app/engine/print-readiness.ts";

test("print readiness cannot certify a basic RGB PDF or metadata-only output intent", async () => {
  const pdf = await PDFDocument.create(); pdf.addPage([300, 200]);
  const simple = await inspectPrintReadiness(await pdf.save());
  assert.equal(simple.status, "NOT_CERTIFIED");
  assert.ok(simple.findings.some(f => f.code === "NO_OUTPUT_PROFILE"));
  assert.ok(simple.findings.some(f => f.code === "IMPLICIT_TRIM"));
  pdf.catalog.set(PDFName.of("OutputIntents"), pdf.context.obj([{ Type: "OutputIntent", S: "GTS_PDFX", OutputConditionIdentifier: "fake claim" }]));
  const fake = await inspectPrintReadiness(await pdf.save());
  assert.equal(fake.status, "NOT_CERTIFIED"); assert.ok(fake.findings.some(f => f.code === "INVALID_OUTPUT_PROFILE"));
});

test("print triage detects invalid page box geometry and malformed files", async () => {
  const pdf = await PDFDocument.create(); const page = pdf.addPage([300, 200]);
  page.setTrimBox(-10, -10, 320, 220); page.setBleedBox(0, 0, 300, 200);
  assert.ok((await inspectPrintReadiness(await pdf.save())).findings.some(f => f.code === "INVALID_PAGE_BOXES"));
  await assert.rejects(inspectPrintReadiness(new Uint8Array(9 * 1024 * 1024)), /8 MiB/);
  await assert.rejects(inspectPrintReadiness(new TextEncoder().encode("broken PDF contents")));
});
