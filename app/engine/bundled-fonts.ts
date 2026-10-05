import { nativeFontResourceRevision } from "./native-font-resources";
import { userFontResourceRevision } from "./user-fonts";
/** Redistributable, unmodified SIL OFL fonts shipped in public/fonts. */
export const BUNDLED_FONTS = [
  { family: "Lato", slug: "lato", category: "Sans", faces: ["Regular", "Bold", "Italic", "BoldItalic", "Light", "Black"] },
  { family: "Arvo", slug: "arvo", category: "Serif", faces: ["Regular", "Bold", "Italic", "BoldItalic"] },
  { family: "Abel", slug: "abel", category: "Sans", faces: ["Regular"] },
  { family: "Anton", slug: "anton", category: "Display", faces: ["Regular"] },
  { family: "Lobster", slug: "lobster", category: "Script", faces: ["Regular"] },
  { family: "Pacifico", slug: "pacifico", category: "Script", faces: ["Regular"] },
  { family: "Space Mono", slug: "spacemono", category: "Mono", faces: ["Regular", "Bold", "Italic", "BoldItalic"] },
  { family: "Bangers", slug: "bangers", category: "Display", faces: ["Regular"] },
  { family: "Righteous", slug: "righteous", category: "Display", faces: ["Regular"] },
  { family: "Rajdhani", slug: "rajdhani", category: "Sans", faces: ["Regular", "Medium", "SemiBold", "Bold", "Light"] },
  { family: "Amatic SC", slug: "amaticsc", category: "Display", faces: ["Regular", "Bold"] },
  { family: "Great Vibes", slug: "greatvibes", category: "Script", faces: ["Regular"] },
  { family: "Noto Sans Arabic", slug: "notosansarabic", category: "Sans", faces: ["Variable"] },
  { family: "Noto Sans Hebrew", slug: "notosanshebrew", category: "Sans", faces: ["Variable"] },
] as const;

export const bundledFontWeight = (face: string) => face.includes("Black") ? 900 : face.includes("SemiBold") ? 600 : face.includes("Bold") ? 700 : face.includes("Medium") ? 500 : face.includes("Light") ? 300 : 400;
export const bundledFontFile = (family: string, face: string) => `${family.replaceAll(" ", "")}${face === "Variable" ? "[wdth,wght]" : `-${face}`}.ttf`;
export function bundledFontForFamily(family: string) {
  const first = family.split(",")[0].trim().replace(/^["']|["']$/g, "");
  return BUNDLED_FONTS.find(font => font.family.toLowerCase() === first.toLowerCase());
}
export function bundledFontFace(family: string, weight = 400, italic = false) {
  const font = bundledFontForFamily(family);
  if (!font) throw new Error("Choose a bundled font for mesh lettering; system font outlines are not available.");
  const available = font.faces.filter(face => face.includes("Italic") === italic);
  const faces = available.length ? available : font.faces.filter(face => !face.includes("Italic"));
  const face = [...faces].sort((a, b) => Math.abs(bundledFontWeight(a) - weight) - Math.abs(bundledFontWeight(b) - weight))[0];
  return { font, face, file: bundledFontFile(font.family, face), weight: face === "Variable" ? Math.max(100, Math.min(900, weight)) : bundledFontWeight(face), italic: face.includes("Italic") };
}

const loads = new Map<string, Promise<void>>();
const ready = new Set<string>();
let revision = 0;
export const fontResourceRevision = () => revision + nativeFontResourceRevision() + userFontResourceRevision();
export function bundledFontReady(family: string, weight = 400, italic = false) {
  return !bundledFontForFamily(family) || ready.has(bundledFontFace(family, weight, italic).file);
}
/** FontFace registers lazily; zero third-party requests, no fallback rasterization race. */
export function loadBundledFont(family: string, weight = 400, italic = false): Promise<void> {
  if (!bundledFontForFamily(family) || typeof FontFace === "undefined" || typeof document === "undefined" || !document.fonts) return Promise.resolve();
  const selected = bundledFontFace(family, weight, italic);
  const existing = loads.get(selected.file);
  if (existing) return existing;
  const face = new FontFace(selected.font.family, `url("/fonts/${selected.file}")`, { weight: selected.face === "Variable" ? "100 900" : String(selected.weight), style: selected.italic ? "italic" : "normal" });
  const pending = face.load().then(loaded => { document.fonts.add(loaded); ready.add(selected.file); revision += 1; }).catch(error => { loads.delete(selected.file); throw error; });
  loads.set(selected.file, pending);
  return pending;
}
