"use client";
import { useEffect, useRef, useState } from "react";

export default function RenameLayerDialog({ initialName, onRename, onClose }: {
  initialName: string; onRename: (name: string) => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(initialName);
  const [error, setError] = useState("");
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.showModal(); input.current?.select();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  return <dialog ref={dialog} className="new-document-dialog" aria-label="Rename layer" onCancel={onClose} onKeyDown={event => event.stopPropagation()}>
    <form onSubmit={event => {
      event.preventDefault();
      try { if (name.trim()) { onRename(name.trim()); onClose(); } }
      catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to rename layer"); }
    }}>
      <header><strong>Rename layer</strong><button type="button" aria-label="Close rename" onClick={onClose}>×</button></header>
      <label>Layer name<input ref={input} autoFocus required maxLength={160} value={name} onChange={event => setName(event.target.value)} /></label>
      {error && <p role="alert">{error}</p>}
      <footer><button type="button" onClick={onClose}>Cancel</button><button type="submit" disabled={!name.trim()}>Rename</button></footer>
    </form>
  </dialog>;
}
