import { bundledFontFace, loadBundledFont } from "./bundled-fonts";
import { withPdfPage } from "./pdf-import";
import { pdfObjectOperators, type PdfObjects } from "./pdf-object-operators";
export { pdfObjectOperators };
export type { PdfObject, PdfObjects } from "./pdf-object-operators";

export async function importPdfObjects(bytes: ArrayBuffer, pageNumber: number, fontFamily: string, options: { workerSrc?: string; resourceBase?: string; plan?: typeof pdfObjectOperators } = {}): Promise<PdfObjects> {
  bundledFontFace(fontFamily);
  return withPdfPage(bytes, pageNumber, options, async (page, pdfjs, cleanup) => {
    if ((await page.getAnnotations()).length) throw new Error("PDF annotations/forms must be flattened in the source application.");
    const list = await page.getOperatorList(); if (list.fnArray.length > 50000) throw new Error("PDF operation budget exceeded.");
    const fonts = new Map<string, { vertical?: boolean; fontMatrix?: number[] }>();
    for (let i = 0; i < list.fnArray.length; i++) if (list.fnArray[i] === pdfjs.OPS.setFont) {
      const id = list.argsArray[i][0] as string;
      if (!fonts.has(id)) fonts.set(id, await new Promise(resolve => page.commonObjs.get(id, resolve)));
    }
    const viewport = page.getViewport({ scale: 1 });
    const view = { width: viewport.width, height: viewport.height, transform: viewport.transform };
    let result: PdfObjects;
    if (options.plan) result = options.plan(list, view, pdfjs.OPS, fontFamily, fonts);
    else {
      const worker = new Worker(new URL("./pdf-object-import.worker.ts", import.meta.url), { type: "module" });
      cleanup(() => worker.terminate());
      result = await new Promise<PdfObjects>((resolve, reject) => {
        worker.onmessage = event => event.data.error ? reject(new Error(event.data.error)) : resolve(event.data.result);
        worker.onerror = () => reject(new Error("PDF object worker failed; document unchanged."));
        worker.postMessage({ list, view, ops: pdfjs.OPS, fontFamily, fonts: new Map([...fonts].map(([id, font]) => [id, { vertical: font.vertical, fontMatrix: font.fontMatrix }])) });
      });
    }
    for (const object of result.layers) if (object.kind === "image") {
      const image = await new Promise<{ width: number; height: number; bitmap?: ImageBitmap; data?: Uint8Array | Uint8ClampedArray; kind?: number }>(resolve => (object.id.startsWith("g_") ? page.commonObjs : page.objs).get(object.id, resolve));
      if (!image || image.width !== object.width || image.height !== object.height) throw new Error("PDF image was omitted or exceeds its decoder budget.");
      const canvas = document.createElement("canvas"); canvas.width = object.width; canvas.height = object.height;
      cleanup(success => { if (!success) { canvas.width = 1; canvas.height = 1; } });
      const context = canvas.getContext("2d"); if (!context) throw new Error("PDF image allocation failed.");
      if (image.bitmap) context.drawImage(image.bitmap, 0, 0);
      else {
        const channels = image.kind === pdfjs.ImageKind.RGBA_32BPP ? 4 : image.kind === pdfjs.ImageKind.RGB_24BPP ? 3 : 0;
        if (!channels || !image.data || image.data.length !== object.width * object.height * channels) throw new Error("Unsupported PDF image sample format.");
        const pixels = context.createImageData(object.width, object.height);
        for (let from = 0, to = 0; from < image.data.length; from += channels, to += 4) { pixels.data[to] = image.data[from]; pixels.data[to + 1] = image.data[from + 1]; pixels.data[to + 2] = image.data[from + 2]; pixels.data[to + 3] = channels === 4 ? image.data[from + 3] : 255; }
        context.putImageData(pixels, 0, 0);
      }
      object.canvas = canvas;
    }
    await loadBundledFont(fontFamily); return result;
  });
}
