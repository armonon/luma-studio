import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream } from "pdf-lib";

/** Structural triage only. No PDF/X, color accuracy or printer certification claim. */
export async function inspectPrintReadiness(bytes: Uint8Array) {
  if (bytes.byteLength < 8 || bytes.byteLength > 8 * 1024 * 1024) throw new Error("Print inspection accepts PDFs up to 8 MiB.");
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: true });
  if (pdf.getPageCount() > 64) throw new Error("Print inspection is limited to 64 pages.");
  const findings: { code: string; page?: number; message: string }[] = [];
  const intents = pdf.catalog.lookupMaybe(PDFName.of("OutputIntents"), PDFArray);
  let embeddedOutputProfiles = 0;
  if (intents) for (let index = 0; index < intents.size(); index++) {
    const intent = intents.lookup(index, PDFDict);
    const profile = intent.lookup(PDFName.of("DestOutputProfile"));
    const stream = profile instanceof PDFRawStream ? profile : undefined;
    const components = stream?.dict.lookupMaybe(PDFName.of("N"), PDFNumber)?.asNumber();
    // Deliberately don't inflate untrusted ICC streams here. Header/transform/RIP
    // correctness belongs to the independent preflight and print reference corpus.
    if (stream && [1, 3, 4].includes(components ?? 0)) embeddedOutputProfiles++;
    else findings.push({ code: "INVALID_OUTPUT_PROFILE", message: "Output intent is missing an embedded ICC stream or valid component count." });
  }
  if (!embeddedOutputProfiles) findings.push({ code: "NO_OUTPUT_PROFILE", message: "No structurally valid embedded output profile found. Select the printer and output condition before print delivery." });
  const contains = (outer: { x: number; y: number; width: number; height: number }, inner: typeof outer) => inner.x >= outer.x - 0.01 && inner.y >= outer.y - 0.01 && inner.x + inner.width <= outer.x + outer.width + 0.01 && inner.y + inner.height <= outer.y + outer.height + 0.01;
  const pages = pdf.getPages().map((page, index) => {
    const media = page.getMediaBox(), trim = page.getTrimBox(), bleed = page.getBleedBox();
    const finiteBox = (box: typeof media) => [box.x, box.y, box.width, box.height].every(Number.isFinite) && box.width > 0 && box.height > 0;
    if (![media, trim, bleed].every(finiteBox) || !contains(media, bleed) || !contains(bleed, trim)) findings.push({ code: "INVALID_PAGE_BOXES", page: index + 1, message: "Media, bleed and trim boxes must be finite, positive and nested." });
    if (!page.node.has(PDFName.of("TrimBox"))) findings.push({ code: "IMPLICIT_TRIM", page: index + 1, message: "No explicit trim box; get the printer's finished-page requirement." });
    if (!page.node.has(PDFName.of("BleedBox"))) findings.push({ code: "IMPLICIT_BLEED", page: index + 1, message: "No explicit bleed box; confirm required bleed with the printer." });
    return { page: index + 1, media, trim, bleed };
  });
  return { status: "NOT_CERTIFIED" as const, embeddedOutputProfiles, pages, findings,
    required: ["Printer-specific PDF/X and ICC target", "Independent PDF/X/content preflight", "Output-profile transform and color-chart validation", "Printer/RIP proof approval"],
    scope: "Page boxes and output-profile structure only. Fonts, ink limits, overprint, actual image resolution, PDF/X conformance and color accuracy are not validated." };
}
