"use client";
import { useEffect, useRef, useState } from "react";
import type { VectorDeliveryReport } from "../engine/vector-delivery-plan";

export default function VectorPreflightDialog({ report, onClose, onExport, onInspectLayer }: {
  report: VectorDeliveryReport; onClose: () => void; onExport: () => Promise<void>; onInspectLayer: (id: string) => void;
}) {
  const ref = useRef<HTMLElement>(null), busyRef = useRef(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  const exportCopy = async () => {
    if (busyRef.current || !report.canExport) return;
    busyRef.current = true; setBusy(true); setError("");
    try { await onExport(); onClose(); }
    catch (error) { setError(error instanceof Error ? error.message : "Vector export failed. Your master is unchanged."); }
    finally { busyRef.current = false; setBusy(false); }
  };
  return <div className="studio-popover-backdrop"><section ref={ref} className="unsaved-document-dialog delivery-preflight-dialog" role="dialog" aria-modal="true" aria-labelledby="vector-preflight-title" aria-busy={busy}
    onKeyDown={event => {
      event.stopPropagation();
      if (event.key === "Escape") { event.preventDefault(); if (!busyRef.current) onClose(); }
      if (event.key === "Tab") {
        const buttons = [...ref.current!.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
        event.preventDefault();
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = current < 0 ? (event.shiftKey ? buttons.length - 1 : 0) : (current + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }
    }}>
    <h2 id="vector-preflight-title">Review {report.format.toUpperCase()} delivery</h2>
    <p><strong>{report.status}</strong> · {report.objectCount} visible objects checked. Your Luma master stays unchanged.</p>
    <p>Preserves supported vector geometry, groups, opacity and masks. Pixel masks remain bounded image tiles; artwork is not flattened. Luma history, construction recipes and hidden layers are not included. Reimporting masked output editably into Luma is not yet supported. {report.format === "pdf" ? "RGB vector PDF; not PDF/X or certified print output." : "sRGB SVG; receiving applications may organize paths differently."}</p>
    {report.issues.length > 0 && <ul className="delivery-preflight-issues">{report.issues.map((issue, index) => <li key={`${issue.code}-${index}`} data-severity="error">
      <strong>{issue.layerPath}</strong>
      <p>{issue.reason}</p>
      <p className="delivery-preflight-action">{issue.classification === "A" ? "Target format limitation" : issue.classification === "B" ? "Luma implementation limitation" : "Conversion / semantic mismatch"} · {issue.conversion}</p>
      <p>{issue.impact}</p>
      {issue.layerId && <button type="button" disabled={busy} onClick={() => onInspectLayer(issue.layerId!)}>Show {issue.objectName}</button>}
    </li>)}</ul>}
    {error && <p role="alert">{error}</p>}
    <footer><button type="button" disabled={busy} onClick={onClose}>Keep editing</button>{report.canExport && <button type="button" className="delivery-preflight-confirm" disabled={busy} onClick={() => void exportCopy()}>{busy ? "Exporting…" : `Export ${report.format.toUpperCase()} copy`}</button>}</footer>
  </section></div>;
}
