"use client";
import { useEffect, useRef, useState } from "react";
import type { PdfImportChoice } from "../engine/pdf-import";
import { BUNDLED_FONTS } from "../engine/bundled-fonts";

export default function PdfImportDialog({ name, onChoose }: { name: string; onChoose: (choice: PdfImportChoice | null) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [page, setPage] = useState(1);
  const [mode, setMode] = useState<PdfImportChoice["mode"]>("raster");
  const [ppi, setPpi] = useState(150);
  const [fontFamily, setFontFamily] = useState("Lato");
  const [accepted, setAccepted] = useState(false);
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.showModal();
    return () => { if (previous instanceof HTMLElement) previous.focus(); };
  }, []);
  return <dialog ref={ref} className="new-document-dialog" aria-labelledby="pdf-import-title" onCancel={() => onChoose(null)} onKeyDown={event => event.stopPropagation()}>
    <form onSubmit={event => { event.preventDefault(); if (Number.isInteger(page) && page >= 1 && page <= 64 && (mode !== "objects" || accepted)) onChoose({ page, mode, ppi, fontFamily }); }}>
      <header><strong id="pdf-import-title">Import PDF page</strong><button type="button" aria-label="Cancel PDF import" onClick={() => onChoose(null)}>×</button></header>
      <p>{name}</p>
      <label>Page<input autoFocus required type="number" min={1} max={64} step={1} value={page} onChange={event => setPage(event.target.valueAsNumber)} /></label>
      <label>Import as<select value={mode} onChange={event => setMode(event.target.value as PdfImportChoice["mode"])}><option value="raster">Rendered page (recommended)</option><option value="editable">Editable vector paths</option><option value="objects">Editable text, images and paths (font mapping)</option></select></label>
      {mode === "objects" && <>
        <label>Map PDF text to<select value={fontFamily} onChange={event => setFontFamily(event.target.value)}>{BUNDLED_FONTS.map(font => <option key={font.family}>{font.family}</option>)}</select></label>
        <p>Reconstructs simple text, image and solid-path objects at 72 ppi. All text uses the chosen bundled font. Original font weights, glyph spacing and line widths may change; embedded font fidelity is not preserved. Complex clipping, effects, vertical text and annotations stop import.</p>
        <label><input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)} />I accept font substitution and will review the result.</label>
      </>}
      {mode === "raster" && <label>Resolution<select value={ppi} onChange={event => setPpi(Number(event.target.value))}><option value={72}>72 ppi</option><option value={150}>150 ppi</option><option value={300}>300 ppi</option></select></label>}
      {mode !== "objects" && <p>{mode === "editable" ? "Solid vector paths only · RGB · 72 ppi. Text, images, clipping and unsupported effects stop the import. Outline text in the source application first." : "Text, images and graphics rendered into one RGB pixel layer on white. PDF objects are not editable. Maximum 16 megapixels / 8192 pixels per edge; large embedded images and annotations/forms are refused."}</p>}
      <p>Import failures leave your open documents unchanged.</p>
      <footer><button type="button" onClick={() => onChoose(null)}>Cancel</button><button type="submit" disabled={mode === "objects" && !accepted}>Import page</button></footer>
    </form>
  </dialog>;
}
