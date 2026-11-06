"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { GitBranch, X } from "lucide-react";
import type { Studio } from "../engine/studio";
import type { BlendMode } from "../engine/document";

export default function VersionHistoryDialog({ history, opacity, blend, hasSelection, onOpacity, onBlend, onRestore, onMix, onClose, inline = false }: {
  history: ReturnType<Studio["historyState"]> | undefined;
  opacity: number;
  blend: BlendMode;
  hasSelection: boolean;
  onOpacity: (value: number) => void;
  onBlend: (value: BlendMode) => void;
  onRestore: (id: string, label: string) => void;
  onMix: (id: string, label: string) => void;
  onClose?: () => void;
  inline?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (inline) return;
    const previous = document.activeElement;
    const element = dialog.current;
    element?.showModal();
    return () => {
      element?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, [inline]);
  const content = <div className="history-content">
      <header className="history-heading">
        <GitBranch size={20} aria-hidden="true" />
        <div><h2 id={inline ? "expanded-version-history-title" : "version-history-title"}>Version history</h2><span>{history?.operations ?? 0} edit{history?.operations === 1 ? "" : "s"} · {history?.branchPoints ?? 0} branch point{history?.branchPoints === 1 ? "" : "s"}</span></div>
        {!inline && <button type="button" onClick={onClose} aria-label="Close version history" autoFocus><X size={18} /></button>}
      </header>
      <p className="history-intro">Return to any edit. Your other versions stay available as branches.</p>
      <details className="history-mix-controls">
        <summary>Mix a version into a new layer</summary>
        <p>Use Mix beside a version to blend it into your current image{hasSelection ? " inside the selection" : ""}.</p>
        <label><span>Strength</span><input type="range" min="1" max="100" value={Math.round(opacity * 100)} onChange={event => onOpacity(Number(event.target.value) / 100)} /><output>{Math.round(opacity * 100)}%</output></label>
        <label><span>Blend mode</span><select value={blend} onChange={event => onBlend(event.target.value as BlendMode)}>
          <option value="source-over">Normal</option><option value="soft-light">Soft Light</option><option value="overlay">Overlay</option><option value="screen">Screen</option><option value="multiply">Multiply</option><option value="color">Color</option><option value="luminosity">Luminosity</option>
        </select></label>
      </details>
      <ol className="history-list" aria-label="Document versions">
        {history?.nodes.map(node => <li key={node.id} className="history-row" data-current={node.isCurrent} data-branch={!node.isOnCurrentPath} style={{ "--history-depth": Math.min(node.depth, 6) } as CSSProperties}>
          <button className="history-restore" aria-current={node.isCurrent ? "step" : undefined} aria-label={`${node.isCurrent ? "Current version" : "Restore"}: ${node.label}`} onClick={() => { if (!node.isCurrent) onRestore(node.id, node.label); }}>
            <i aria-hidden="true">{node.isCurrent ? "●" : node.childCount > 1 ? "⑂" : "○"}</i>
            <span>{node.label}</span>
            <small>{node.isCurrent ? "Current" : node.childCount > 1 ? `${node.childCount} branches` : new Date(node.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small>
          </button>
          <button className="history-mix" disabled={node.isCurrent || !node.parentId} aria-label={`Mix ${node.label} as a new layer`} onClick={() => onMix(node.id, node.label)}>Mix</button>
        </li>)}
      </ol>
    </div>;
  if (inline) return <section className="version-history-inline" aria-labelledby="expanded-version-history-title">{content}</section>;
  return <dialog ref={dialog} className="version-history-dialog" aria-labelledby="version-history-title"
    onCancel={event => { event.preventDefault(); onClose?.(); }}
    onClick={event => { if (event.target === event.currentTarget) onClose?.(); }}
    onKeyDown={event => {
      event.stopPropagation();
      if (event.key !== "Tab") return;
      const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), summary, input:not(:disabled), select:not(:disabled)')].filter(element => element.getClientRects().length > 0);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>{content}</dialog>;
}
