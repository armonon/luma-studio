import type { ImportedSvg } from "./vector-svg-import";
export const PDF_IMPORT_LIMITS = { bytes: 8 * 1024 * 1024, pages: 64, timeoutMs: 12000 } as const;
export const PDF_RASTER_LIMITS = { pixels: 16_000_000, edge: 8192 } as const;
export type PdfImportChoice = { page: number; mode: "editable" | "objects" | "raster"; ppi: number; fontFamily?: string };
type PdfOptions = { workerSrc?: string; resourceBase?: string };
let busy = false;

export async function withPdfPage<T>(bytes: ArrayBuffer, pageNumber: number, options: PdfOptions, run: (page: import("pdfjs-dist").PDFPageProxy, pdfjs: typeof import("pdfjs-dist"), cleanup: (fn: (success: boolean) => void) => void) => Promise<T>): Promise<T> {
  if (busy) throw new Error("Another PDF import is running.");
  if (bytes.byteLength > PDF_IMPORT_LIMITS.bytes || bytes.byteLength < 8 || !Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > PDF_IMPORT_LIMITS.pages) throw new Error("Editable PDF import supports files up to 8 MiB and page numbers 1–64.");
  busy = true;
  const cleanup: ((success: boolean) => void)[] = [];
  let success = false, settled = false;
  let task: import("pdfjs-dist").PDFDocumentLoadingTask | undefined, worker: Worker | undefined, pdfWorker: import("pdfjs-dist").PDFWorker | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    if (options.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = options.workerSrc;
    else {
      worker = new Worker(new URL("../../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url), { type: "module" });
    }
    pdfWorker = worker ? pdfjs.PDFWorker.create({ port: worker }) : undefined;
    const base = options.resourceBase ?? (typeof location === "undefined" ? undefined : new URL("/pdfjs/", location.href).href);
    task = pdfjs.getDocument({ data: new Uint8Array(bytes.slice(0)), worker: pdfWorker, useWasm: Boolean(base), standardFontDataUrl: base && `${base}standard_fonts/`, cMapUrl: base && `${base}cmaps/`, cMapPacked: true, wasmUrl: base && `${base}wasm/`, useSystemFonts: false, useWorkerFetch: false, disableFontFace: true, maxImageSize: 4_000_000, stopAtErrors: true, verbosity: 0 });
    const work = async () => {
      const doc = await task!.promise;
      if (doc.numPages > PDF_IMPORT_LIMITS.pages || pageNumber > doc.numPages) throw new Error(`PDF contains ${doc.numPages} pages; choose an available page (maximum 64).`);
      const page = await doc.getPage(pageNumber);
      if (settled) throw new Error("PDF import cancelled");
      return run(page, pdfjs, fn => { if (settled) { fn(false); throw new Error("PDF import cancelled"); } cleanup.push(fn); });
    };
    const result = await Promise.race([work(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("PDF import exceeded the 12-second deadline; document unchanged.")), PDF_IMPORT_LIMITS.timeoutMs); })]);
    success = true;
    return result;
  } finally {
    settled = true; clearTimeout(timer); for (const dispose of cleanup.reverse()) dispose(success);
    worker?.terminate(); pdfWorker?.destroy(); if (task) void task.destroy().catch(() => {}); busy = false;
  }
}

export async function importEditablePdf(bytes: ArrayBuffer, pageNumber = 1, options: PdfOptions & { convert?: (...args: Parameters<typeof import("./pdf-vector-operators").pdfVectorOperators>) => ImportedSvg | Promise<ImportedSvg> } = {}): Promise<ImportedSvg> {
  return withPdfPage(bytes, pageNumber, options, async (page, pdfjs, cleanup) => {
      if ((await page.getAnnotations()).length) throw new Error("PDF annotations are not supported for editable import.");
      const list = await page.getOperatorList();
      if (list.fnArray.length > 50000) throw new Error("PDF exceeds the 50,000-operation import budget.");
      const v = page.getViewport({ scale: 1 }), viewport = { width: v.width, height: v.height, transform: v.transform };
      if (!options.convert) {
        // Paper parsing/path construction is CPU-bound too; keep it off the UI thread.
        const geometryWorker = new Worker(new URL("./pdf-vector-operators.worker.ts", import.meta.url), { type: "module" });
        cleanup(() => geometryWorker.terminate());
        return await new Promise<ImportedSvg>((resolve, reject) => {
          geometryWorker!.onmessage = event => event.data.error ? reject(new Error(event.data.error)) : resolve(event.data.result);
          geometryWorker!.onerror = () => reject(new Error("PDF vector worker failed; document unchanged."));
          geometryWorker!.postMessage({ list, viewport, ops: pdfjs.OPS });
        });
      }
      return options.convert(list, viewport, pdfjs.OPS);
  });
}

export function pdfRasterDimensions(width: number, height: number, ppi: number) {
  if (![72, 150, 300].includes(ppi)) throw new Error("Choose 72, 150 or 300 ppi for PDF rendering.");
  const w = Math.ceil(width * ppi / 72), h = Math.ceil(height * ppi / 72);
  if (![w, h].every(n => Number.isSafeInteger(n) && n > 0 && n <= PDF_RASTER_LIMITS.edge) || w * h > PDF_RASTER_LIMITS.pixels) throw new Error("Rendered PDF exceeds the 16-megapixel / 8192-pixel edge budget. Choose a lower resolution.");
  return { width: w, height: h };
}

/** Explicit flattened import: never represented to the user as editable PDF objects. */
export function renderPdfPage(bytes: ArrayBuffer, pageNumber = 1, ppi = 150, options: PdfOptions = {}) {
  return withPdfPage(bytes, pageNumber, options, async (page, pdfjs, cleanup) => {
    const size = page.getViewport({ scale: 1 });
    const dimensions = pdfRasterDimensions(size.width, size.height, ppi);
    // No invisible annotations/forms: these require a dedicated interactive importer.
    if ((await page.getAnnotations()).length) throw new Error("PDF annotations/forms must be flattened in the source application before importing.");
    const canvas = document.createElement("canvas");
    canvas.width = dimensions.width; canvas.height = dimensions.height;
    cleanup(success => { if (!success) { canvas.width = 1; canvas.height = 1; } });
    const render = page.render({ canvas, viewport: page.getViewport({ scale: ppi / 72 }), background: "rgb(255,255,255)", annotationMode: pdfjs.AnnotationMode.DISABLE });
    cleanup(success => { if (!success) render.cancel(); });
    await render.promise;
    return { canvas, ppi };
  });
}
