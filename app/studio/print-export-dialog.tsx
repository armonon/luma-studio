"use client";
import { useEffect, useRef, useState } from "react";
import { PRINT_MAX_PROFILE_BYTES, validatePrinterProfile, type PrintOptions } from "../engine/print-output";

export default function PrintExportDialog({ documentName, onExport, onClose }: {
  documentName: string; onExport: (options: PrintOptions) => Promise<void>; onClose: () => void;
}) {
  const root = useRef<HTMLElement>(null);
  const [profile, setProfile] = useState<Uint8Array>();
  const [profileName, setProfileName] = useState("");
  const [intent, setIntent] = useState<PrintOptions["intent"]>("relative-colorimetric");
  const [bpc, setBpc] = useState(true);
  const [inset, setInset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef(0);
  useEffect(() => {
    const previous = document.activeElement;
    const pendingRequest = request;
    root.current?.querySelector<HTMLInputElement>("input")?.focus();
    return () => { pendingRequest.current++; if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  return <div className="studio-popover-backdrop" onMouseDown={() => { if (!busy) onClose(); }}>
    <section ref={root} className="studio-export-popover print-export-dialog" role="dialog" aria-modal="true" aria-label="CMYK print export" onMouseDown={event => event.stopPropagation()} onKeyDown={event => {
      event.stopPropagation();
      if (event.key === "Escape" && !busy) { event.preventDefault(); onClose(); }
      if (event.key === "Tab") {
        const controls = [...(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)') ?? [])];
        if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
        if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); }
      }
    }}>
      <header><div><strong>CMYK print PDF</strong><span>{documentName}</span></div><button disabled={busy} onClick={onClose} aria-label="Close print export">×</button></header>
      <form onSubmit={event => {
        event.preventDefault(); if (!profile || busy) return;
        setBusy(true); setError("");
        void onExport({ profile, profileName, intent, blackPointCompensation: intent !== "absolute-colorimetric" && bpc, trimInsetMm: inset })
          .then(onClose).catch(reason => setError(reason instanceof Error ? reason.message : "Print export failed"))
          .finally(() => setBusy(false));
      }}>
        <label>Printer ICC profile<input type="file" accept=".icc,.icm" disabled={busy} onChange={event => {
          const file = event.target.files?.[0], id = ++request.current; setProfile(undefined); setProfileName(""); setError("");
          if (!file) return;
          if (file.size > PRINT_MAX_PROFILE_BYTES) { setError("Printer profile exceeds 4 MiB"); return; }
          void file.arrayBuffer().then(buffer => {
            const bytes = new Uint8Array(buffer); validatePrinterProfile(bytes);
            if (request.current === id) { setProfile(bytes); setProfileName(file.name); }
          }).catch(reason => { if (request.current === id) setError(reason instanceof Error ? reason.message : "Profile could not be loaded"); });
        }}/></label>
        <label>Rendering intent<select value={intent} disabled={busy} onChange={event => setIntent(event.target.value as PrintOptions["intent"])}>
          <option value="relative-colorimetric">Relative colorimetric</option><option value="perceptual">Perceptual</option><option value="saturation">Saturation</option><option value="absolute-colorimetric">Absolute colorimetric</option>
        </select></label>
        <label className="print-checkbox"><input type="checkbox" checked={intent !== "absolute-colorimetric" && bpc} disabled={busy || intent === "absolute-colorimetric"} onChange={event => setBpc(event.target.checked)}/> Black-point compensation</label>
        <label>Trim inset (mm)<input type="number" min="0" max="25" step="0.1" required value={inset} disabled={busy} onChange={event => setInset(event.target.valueAsNumber)}/></label>
        <p>The canvas is the full bleed area. Trim inset crops inward; it does not generate extra artwork. Resolution comes from Document properties.</p>
        <p>Flattened 8-bit CMYK, transparency on white paper. Up to 4 MP from an sRGB 8-bit master. Not PDF/X certified; obtain a printer proof before production.</p>
        {error && <p role="alert">{error}</p>}
        <button type="submit" disabled={!profile || busy}>{busy ? "Converting…" : "Export CMYK PDF"}</button>
      </form>
    </section>
  </div>;
}
