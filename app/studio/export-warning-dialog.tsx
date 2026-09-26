"use client";
import { useEffect, useRef } from "react";
import type { PhotoshopCompatibilityReport } from "../engine/psd";
import { deliveryGuidance, deliveryStatus } from "./delivery-preflight";

export default function ExportWarningDialog({ report, onChoose, onInspectLayer }: { report: PhotoshopCompatibilityReport; onChoose: (proceed: boolean) => void; onInspectLayer: (id: string) => void }) {
  const ref = useRef<HTMLElement>(null);
  const blocked = !report.canExport || report.issues.some(issue => issue.severity === "error");
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  return <div className="studio-popover-backdrop"><section ref={ref} className="unsaved-document-dialog delivery-preflight-dialog" role="dialog" aria-modal="true" aria-labelledby="export-warning-title"
    onKeyDown={event => {
      event.stopPropagation();
      if (event.key === "Escape") { event.preventDefault(); onChoose(false); }
      if (event.key === "Tab") {
        const buttons = [...ref.current!.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
        event.preventDefault();
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = current < 0 ? (event.shiftKey ? buttons.length - 1 : 0) :
          (current + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }
    }}>
    <h2 id="export-warning-title">Review {report.container.toUpperCase()} delivery</h2>
    <p><strong>{deliveryStatus(report)}</strong> · Your Luma document is unchanged.</p>
    <ul className="delivery-preflight-issues">{report.issues.filter(issue => issue.severity !== "info" &&
      // The blocked preliminary report runs before merged-preview preparation.
      !(blocked && issue.code === "COMPOSITE_PREVIEW_UNAVAILABLE")).map((issue, index) => {
      const guidance = deliveryGuidance(issue);
      return <li key={`${issue.code}-${index}`} data-severity={issue.severity}>
        <strong>{guidance.category}</strong>
        <p>{issue.message}</p><p className="delivery-preflight-action">{guidance.action}</p>
        {issue.layerId && <button type="button" onClick={() => onInspectLayer(issue.layerId!)}>Show affected layer</button>}
      </li>;
    })}</ul>
    <footer><button type="button" onClick={() => onChoose(false)}>Keep editing</button>{!blocked && <button type="button" className="delivery-preflight-confirm" onClick={() => onChoose(true)}>Export with these limitations</button>}</footer>
  </section></div>;
}
