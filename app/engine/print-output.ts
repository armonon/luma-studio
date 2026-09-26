import { PDFDocument, PDFName, PDFString, pushGraphicsState, popGraphicsState, concatTransformationMatrix, drawObject } from "pdf-lib";
import type { RenderingIntent } from "./icc-profile";

export const PRINT_MAX_PIXELS = 4_000_000;
export const PRINT_MAX_PROFILE_BYTES = 4 * 1024 * 1024;
export type PrintOptions = { profile: Uint8Array; profileName: string; intent: RenderingIntent; blackPointCompensation: boolean; trimInsetMm: number };
type Invoke = <T>(command: string, payload?: unknown) => Promise<T>;
const intents: RenderingIntent[] = ["perceptual", "relative-colorimetric", "saturation", "absolute-colorimetric"];

export function validatePrinterProfile(profile: Uint8Array) {
  if (profile.byteLength < 132 || profile.byteLength > PRINT_MAX_PROFILE_BYTES) throw new Error("Printer ICC profiles must be between 132 bytes and 4 MiB");
  const view = new DataView(profile.buffer, profile.byteOffset, profile.byteLength);
  const signature = (offset: number) => String.fromCharCode(...profile.subarray(offset, offset + 4));
  if (view.getUint32(0) !== profile.byteLength || signature(36) !== "acsp" || signature(12) !== "prtr" || signature(16) !== "CMYK" || !["XYZ ", "Lab "].includes(signature(20))) throw new Error("Choose a CMYK printer ICC profile, not a display or device-link profile");
  const count = view.getUint32(128), end = 132 + count * 12;
  if (count > 4096 || end > profile.byteLength) throw new Error("Invalid ICC tag table");
  for (let index = 0; index < count; index++) {
    const start = view.getUint32(136 + index * 12), size = view.getUint32(140 + index * 12);
    if (start < end || size < 8 || start + size > profile.byteLength) throw new Error("Invalid ICC tag bounds");
  }
}

export function encodePrintRequest(width: number, height: number, rgb: Uint8Array, options: PrintOptions) {
  const pixels = width * height;
  if (![width, height].every(value => Number.isSafeInteger(value) && value > 0 && value <= 16384) || pixels > PRINT_MAX_PIXELS || rgb.length !== pixels * 3) throw new Error("CMYK print export is limited to 4 megapixels");
  validatePrinterProfile(options.profile);
  const intent = intents.indexOf(options.intent);
  if (intent < 0 || (intent === 3 && options.blackPointCompensation)) throw new Error("Invalid intent or absolute intent with black-point compensation");
  const payload = new Uint8Array(24 + options.profile.length + rgb.length), view = new DataView(payload.buffer);
  payload.set([76,67,80,49]);
  [width, height, intent, options.blackPointCompensation ? 1 : 0, options.profile.length].forEach((value, index) => view.setUint32(4 + index * 4, value));
  payload.set(options.profile, 24); payload.set(rgb, 24 + options.profile.length);
  return payload;
}

export async function convertPrintPixels(width: number, height: number, rgb: Uint8Array, options: PrintOptions, invoke?: Invoke) {
  const native = invoke ?? (typeof window === "undefined" ? undefined : (window as Window & { __TAURI__?: { core?: { invoke?: Invoke } } }).__TAURI__?.core?.invoke);
  if (!native) throw new Error("ICC CMYK conversion requires the desktop application");
  const result = await native<ArrayBuffer | Uint8Array>("convert_print_cmyk", encodePrintRequest(width, height, rgb, options));
  const bytes = result instanceof Uint8Array ? result : new Uint8Array(result);
  if (bytes.length !== width * height * 4) throw new Error("Native CMYK conversion returned an invalid pixel payload");
  return bytes;
}

/** Flattened CMYK PDF with the exact conversion profile embedded. No PDF/X claim. */
export async function createCmykPrintPdf(width: number, height: number, ppi: number, cmyk: Uint8Array, options: PrintOptions) {
  if (![width, height].every(value => Number.isSafeInteger(value) && value > 0 && value <= 16384) || width * height > PRINT_MAX_PIXELS || cmyk.length !== width * height * 4) throw new Error("Invalid CMYK image bounds");
  validatePrinterProfile(options.profile);
  if (!Number.isFinite(ppi) || ppi < 1 || ppi > 2400 || !Number.isFinite(options.trimInsetMm) || options.trimInsetMm < 0 || options.trimInsetMm > 25) throw new Error("Invalid print resolution or trim inset");
  const w = width * 72 / ppi, h = height * 72 / ppi, inset = options.trimInsetMm * 72 / 25.4;
  if (Math.min(w, h) <= inset * 2 || Math.max(w, h) > 14400) throw new Error("Trim inset exceeds the page or page dimensions exceed PDF limits");
  const pdf = await PDFDocument.create();
  pdf.setCreator("Luma Studio"); pdf.setTitle("CMYK print proof");
  pdf.setSubject(`Flattened ICC CMYK; ${ppi} ppi; ${options.intent}; BPC ${options.blackPointCompensation ? "on" : "off"}. Not certified PDF/X. Printer proof required.`);
  const profileRef = pdf.context.register(pdf.context.flateStream(options.profile, { N: 4, Alternate: "DeviceCMYK" }));
  const image = pdf.context.register(pdf.context.flateStream(cmyk, { Type: "XObject", Subtype: "Image", Width: width, Height: height, BitsPerComponent: 8, ColorSpace: ["ICCBased", profileRef], Interpolate: false }));
  const page = pdf.addPage([w, h]); page.setTrimBox(inset, inset, w - inset * 2, h - inset * 2); page.setBleedBox(0, 0, w, h);
  const name = page.node.newXObject("PrintImage", image);
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(w, 0, 0, h, 0, 0), drawObject(name), popGraphicsState());
  pdf.catalog.set(PDFName.of("OutputIntents"), pdf.context.obj([{
    Type: "OutputIntent", S: "GTS_PDFX", OutputConditionIdentifier: PDFString.of(options.profileName.slice(0, 160)),
    Info: PDFString.of("Printer ICC output condition; conformance not certified"), DestOutputProfile: profileRef,
  }]));
  return new Blob([await pdf.save() as Uint8Array<ArrayBuffer>], { type: "application/pdf" });
}
