"use client";

import { useEffect, useRef, useState } from "react";

export default function NewDocumentDialog({ onCreate, onClose }: {
  onCreate: (width: number, height: number, name: string) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("Untitled");
  const [width, setWidth] = useState(1920);
  const [height, setHeight] = useState(1080);
  const [error, setError] = useState("");
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.showModal();
    return () => { if (previous instanceof HTMLElement) previous.focus(); };
  }, []);
  return <dialog ref={dialog} className="new-document-dialog" aria-labelledby="new-document-title" onCancel={onClose} onKeyDown={event => event.stopPropagation()}>
    <form onSubmit={event => {
      event.preventDefault();
      try { onCreate(width, height, name); onClose(); }
      catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to create this document"); }
    }}>
      <header><strong id="new-document-title">New document</strong><button type="button" onClick={onClose} aria-label="Close new document">×</button></header>
      <label>Name<input autoFocus value={name} maxLength={160} onChange={event => setName(event.target.value)} /></label>
      <div className="new-document-dimensions">
        <label>Width · px<input type="number" required min={1} max={1000000} step={1} value={width} onChange={event => setWidth(event.target.valueAsNumber)} /></label>
        <label>Height · px<input type="number" required min={1} max={1000000} step={1} value={height} onChange={event => setHeight(event.target.valueAsNumber)} /></label>
      </div>
      <p>Transparent canvas · sRGB · 8-bit</p>
      {error && <p role="alert">{error}</p>}
      <footer><button type="button" onClick={onClose}>Cancel</button><button type="submit">Create</button></footer>
    </form>
  </dialog>;
}
