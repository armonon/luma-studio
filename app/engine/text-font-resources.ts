import type { Document as DocumentModel, Layer, TextStyle } from "./document";
import { resolvedDefaultTextStyle } from "./text-model";
import { bundledFontReady, loadBundledFont } from "./bundled-fonts";
import { getPhotoshopLayerMetadata } from "./psd-metadata";
import { nativeImportedFontReady, loadNativeImportedFont } from "./native-font-resources";

const listeners = new Set<() => void>();
const watched = new Set<Promise<void>>();
const requested = new WeakSet<TextStyle>();
const failures = new Set<(layer: Layer, error: unknown) => void>();
export function subscribeTextFontFailures(listener: (layer: Layer, error: unknown) => void) { failures.add(listener); return () => { failures.delete(listener); }; }
export function subscribeTextFonts(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function requestTextFonts(text: TextStyle, layer?: Layer) {
  if (requested.has(text) || typeof FontFace === "undefined") return;
  const pending = pendingDocumentFonts({ layers: [layer ?? { text }] } as Pick<DocumentModel, "layers">);
  // A temporary rendering copy may not carry imported-face metadata. An empty
  // request must not suppress a later request using the document-owned layer.
  if (pending || !layer?.photoshop) requested.add(text);
  if (pending) void pending.catch(error => {
    console.warn("Document font unavailable", error);
    if (layer?.text === text) for (const listener of failures) listener(layer, error);
  });
}
export function pendingDocumentFonts(doc: Pick<DocumentModel, "layers">): Promise<void> | null {
  if (typeof FontFace === "undefined") return null;
  const pending: Promise<void>[] = [];
  for (const layer of doc.layers) {
    if (!layer.text) continue;
    const base = resolvedDefaultTextStyle(layer.text);
    const source = getPhotoshopLayerMetadata(layer)?.source.text;
    const importedNames = new Set([source?.style?.font?.name, ...(source?.styleRuns ?? []).map(run => run.style.font?.name)].filter((name): name is string => !!name));
    for (const style of [base, ...(layer.text.runs ?? []).map(run => ({ ...base, ...run.style }))]) {
      const italic = style.fontStyle !== "normal";
      const exact = importedNames.has(style.fontFamily) && !nativeImportedFontReady(style.fontFamily);
      if (exact || !bundledFontReady(style.fontFamily, style.fontWeight, italic)) {
        const load = exact ? loadNativeImportedFont(style.fontFamily) : loadBundledFont(style.fontFamily, style.fontWeight, italic);
        pending.push(load);
        if (!watched.has(load)) {
          watched.add(load);
          void load.then(() => { watched.delete(load); for (const listener of listeners) listener(); }, () => watched.delete(load));
        }
      }
    }
  }
  return pending.length ? Promise.all(pending).then(() => undefined) : null;
}

/** Bound the caller's wait, not the native operation: timed-out loads keep their
 * queue/admission until settled, so retry cannot accumulate concurrent copies. */
export async function waitForDocumentFonts(doc: Pick<DocumentModel, "layers">, timeoutMs = 15000) {
  const pending = pendingDocumentFonts(doc);
  if (!pending) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([pending, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Fonts did not finish loading within the allowed time; no delivery asset was rendered. Try again after loading completes.")), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}
