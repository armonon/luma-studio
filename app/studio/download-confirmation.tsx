"use client";

import { useEffect, useRef } from "react";

/** Browsers cannot acknowledge that an anchor download reached Files. */
export default function DownloadConfirmation({ name, onResolve }: { name: string; onResolve: (saved: boolean) => void }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { ref.current?.querySelector<HTMLButtonElement>("button")?.focus(); }, []);
  return <div className="spatial-modal download-confirmation-backdrop">
    <section ref={ref} className="unsaved-document-dialog download-confirmation" role="dialog" aria-modal="true" aria-labelledby="download-confirmation-title" onKeyDown={event => {
      event.stopPropagation();
      if (event.key === "Escape") { event.preventDefault(); onResolve(false); }
      if (event.key === "Tab") {
        const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
        if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1)?.focus(); }
        else if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0]?.focus(); }
      }
    }}>
      <h2 id="download-confirmation-title">Check your downloaded project</h2>
      <p>The download of <strong>{name}</strong> was started. Check Files or Downloads before confirming. Your browser cannot tell Luma whether the file was saved.</p>
      <p>Until you confirm, this document stays marked as unsaved.</p>
      <button onClick={() => onResolve(false)}>Keep document unsaved</button>
      <button onClick={() => onResolve(true)}>I verified the saved file</button>
    </section>
  </div>;
}
