import type { Document as DocumentModel, Layer, TextStyle } from "./document";
import { resolvedDefaultTextStyle } from "./text-model";
import { bundledFontReady, loadBundledFont } from "./bundled-fonts";
import { getPhotoshopLayerMetadata } from "./psd-metadata";
import { nativeImportedFontReady, loadNativeImportedFont } from "./native-font-resources";
import { listUserFonts, loadUserFont, primaryFamily, userFontReady } from "./user-fonts";

const listeners = new Set<() => void>();
const watched = new Set<Promise<void>>();
const requested = new WeakSet<TextStyle>();
const failures = new Set<(layer: Layer, error: unknown) => void>();
export function subscribeTextFontFailures(listener: (layer: Layer, error: unknown) => void) { failures.add(listener); return () => { failures.delete(listener); }; }
export function subscribeTextFonts(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
/** Re-render text after a font was (re)installed outside a document load, e.g. from Glyph. */
export function notifyTextFontsChanged() { for (const listener of listeners) listener(); }
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
      const user = !exact && !userFontReady(style.fontFamily);
      if (exact || user || !bundledFontReady(style.fontFamily, style.fontWeight, italic)) {
        const load = exact ? loadNativeImportedFont(style.fontFamily) : user ? loadUserFont(style.fontFamily) : loadBundledFont(style.fontFamily, style.fontWeight, italic);
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

/**
 * Distinct installed Glyph families this document's text layers actually
 * use, in their canonical (installed-index) casing. Used on save to decide
 * which fonts to embed in the `.luma` archive — see `project.ts`.
 */
export function documentUserFontFamilies(doc: Pick<DocumentModel, "layers">): string[] {
  const installed = listUserFonts();
  if (!installed.length) return [];
  const found = new Map<string, string>(); // lowercase key -> canonical family
  for (const layer of doc.layers) {
    if (!layer.text) continue;
    const base = resolvedDefaultTextStyle(layer.text);
    for (const style of [base, ...(layer.text.runs ?? []).map(run => ({ ...base, ...run.style }))]) {
      const key = primaryFamily(style.fontFamily).toLowerCase();
      if (found.has(key)) continue;
      const entry = installed.find(candidate => candidate.family.toLowerCase() === key);
      if (entry) found.set(key, entry.family);
    }
  }
  return [...found.values()];
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
