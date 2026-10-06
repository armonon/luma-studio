"use client";
import { useEffect, useState } from "react";
import { loadBundledFont } from "@/app/engine/bundled-fonts";
import { loadUserFont } from "@/app/engine/user-fonts";
import { FONT_CHOICES, fontFamilyValue, loadInstalledFontFamilies, userFontChoices, type FontChoice } from "../font-catalog";

export function FontPicker({ value, onChange }: { value: string; onChange: (family: string) => void }) {
  const [fonts, setFonts] = useState<FontChoice[]>(() => [...userFontChoices(), ...FONT_CHOICES]);
  const [query, setQuery] = useState("");
  const [custom, setCustom] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    void loadBundledFont(value).catch(() => setStatus("Bundled font could not load. Check that the app's font assets are present."));
    void loadUserFont(value).catch(() => setStatus("This Glyph font is missing from this browser's storage. Reinstall it from Glyph."));
  }, [value]);
  const visible = fonts.filter(font => `${font.label} ${font.category}`.toLowerCase().includes(query.toLowerCase())).slice(0, 100);
  return <div className="type-wide type-font-picker">
    <label><span>Find a typeface</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Family or style…" /></label>
    <label><span>Typeface · {fonts.length} choices</span><select value={value} onChange={event => onChange(event.target.value)}>
      {!visible.some(font => font.value === value) && <option value={value}>{value.split(",")[0].replace(/["']/g, "")} · current</option>}
      {visible.map(font => <option key={font.value} value={font.value}>{font.label} · {font.category}</option>)}
    </select></label>
    <div aria-label="Font preview" className="type-font-preview" style={{ fontFamily: value }}>Aa Bb 0123 · Type your world</div>
    <button disabled={loading} onClick={async () => {
      setLoading(true); setStatus("");
      try { const installed = await loadInstalledFontFamilies(); const retained = [...userFontChoices(), ...FONT_CHOICES.filter(font => font.bundled || font.category === "System")]; setFonts([...retained, ...installed.filter(font => !retained.some(item => item.value === font.value))]); setStatus(`${installed.length} installed families found`); }
      catch (error) { setStatus(error instanceof Error ? error.message : "Font discovery failed"); }
      finally { setLoading(false); }
    }}>{loading ? "Reading fonts…" : "Load installed fonts"}</button>
    <details><summary>Use a font by name</summary><label><span>Installed font family</span><input value={custom} maxLength={256} onChange={event => setCustom(event.target.value)} placeholder="Exact family name" /></label><button onClick={() => { try { onChange(fontFamilyValue(custom)); setStatus(""); } catch (error) { setStatus(String(error)); } }}>Apply font</button></details>
    <small>14 bundled families work offline, including Arabic and Hebrew. Other choices require installed fonts and may fall back. Search shows up to 100 matches.</small>
    {status && <p role="status">{status}</p>}
  </div>;
}
