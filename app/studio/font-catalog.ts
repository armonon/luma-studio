import { BUNDLED_FONTS } from "../engine/bundled-fonts";
import { listUserFonts } from "../engine/user-fonts";
export type FontChoice = { label: string; value: string; category: string; bundled?: boolean };

export function fontFamilyValue(name: string) {
  const clean = name.trim();
  if (!clean || clean.length > 256 || /[\x00-\x1f]/.test(clean)) throw new Error("Enter a valid font family name (up to 256 characters)");
  return `${JSON.stringify(clean)}, sans-serif`;
}

const groups: Record<string, string[]> = {
  Sans: ["Inter", "Helvetica Neue", "Arial", "Arial Narrow", "Avenir", "Avenir Next", "Futura", "Gill Sans", "Helvetica", "Optima", "Trebuchet MS", "Verdana", "Tahoma", "DIN Alternate", "DIN Condensed", "Geneva"],
  Serif: ["Georgia", "Times New Roman", "Baskerville", "Didot", "Bodoni 72", "Palatino", "Hoefler Text", "Cochin", "Iowan Old Style", "Charter", "New York", "Big Caslon"],
  Display: ["Impact", "Copperplate", "American Typewriter", "Phosphate", "Rockwell", "Chalkboard", "Marker Felt", "Noteworthy", "Chalkduster"],
  Script: ["Snell Roundhand", "Zapfino", "Apple Chancery", "Brush Script MT", "Bradley Hand", "Savoye LET", "SignPainter"],
  Mono: ["Menlo", "Monaco", "Courier New", "Courier", "SF Mono", "Andale Mono"],
  Multilingual: ["PingFang SC", "Hiragino Sans", "Hiragino Mincho ProN", "Apple SD Gothic Neo", "Geeza Pro", "Kohinoor Devanagari", "Thonburi"],
};

/** Bundled choices are portable; other suggestions depend on installed fonts. */
export const FONT_CHOICES: FontChoice[] = [
  ...BUNDLED_FONTS.map(font => ({ label: font.family, value: fontFamilyValue(font.family), category: `Bundled · ${font.category}`, bundled: true })),
  { label: "System Sans", value: "system-ui, sans-serif", category: "System" },
  { label: "System Serif", value: "serif", category: "System" },
  { label: "System Mono", value: "monospace", category: "System" },
  ...Object.entries(groups).flatMap(([category, names]) => names.map(label => ({ label, value: fontFamilyValue(label), category }))),
];

export function normalizeFontFamilies(value: unknown): FontChoice[] {
  if (!Array.isArray(value)) throw new Error("Invalid font catalog response");
  const names = [...new Set(value.slice(0, 4096).filter((name): name is string => typeof name === "string" && !!name.trim() && name.length <= 256 && !/[\x00-\x1f]/.test(name)).map(name => name.trim()))];
  return names.sort((a, b) => a.localeCompare(b)).map(label => ({ label, value: fontFamilyValue(label), category: "Installed" }));
}

export async function loadInstalledFontFamilies(): Promise<FontChoice[]> {
  const host = window as unknown as { __TAURI__?: { core?: { invoke?: (command: string) => Promise<unknown> } }; queryLocalFonts?: () => Promise<Array<{ family: string }>> };
  if (host.__TAURI__?.core?.invoke) return normalizeFontFamilies(await host.__TAURI__.core.invoke("list_font_families"));
  if (host.queryLocalFonts) return normalizeFontFamilies((await host.queryLocalFonts()).map(font => font.family));
  throw new Error("Installed-font discovery requires the desktop app or a browser with Local Font Access. You can still enter a family name below.");
}

/** Fonts drawn in Glyph and installed in this browser, listed first. */
export function userFontChoices(): FontChoice[] {
  return listUserFonts().map(font => ({ label: font.family, value: fontFamilyValue(font.family), category: "Yours · Glyph" }));
}
