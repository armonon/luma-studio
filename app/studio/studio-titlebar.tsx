"use client";

import { useRef } from "react";
import { ChevronDown, Ellipsis, FolderOpen, Redo2, Save, Undo2 } from "lucide-react";

export default function StudioTitlebar({
  desktop,
  projectName,
  saveState,
  zoom,
  canUndo,
  canRedo,
  exportOpen,
  filtersOpen,
  onBack,
  onOpen,
  onUndo,
  onRedo,
  onFit,
  onSave,
  onFilters,
  onBatch,
  onHistory,
  onSettings,
  onExport,
}: {
  desktop: boolean;
  projectName: string;
  saveState: "saved" | "unsaved" | "saving" | "error";
  zoom: number;
  canUndo: boolean;
  canRedo: boolean;
  exportOpen: boolean;
  filtersOpen: boolean;
  onBack: () => void;
  onOpen: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onFit: () => void;
  onSave: () => void;
  onFilters: () => void;
  onBatch: () => void;
  onHistory: () => void;
  onSettings: () => void;
  onExport: () => void;
}) {
  const menuRef = useRef<HTMLDetailsElement>(null);
  const run = (action: () => void) => {
    menuRef.current?.removeAttribute("open");
    action();
  };

  return (
    <header className="spatial-topbar studio-titlebar">
      {desktop && <div className="desktop-titlebar-drag" data-tauri-drag-region="true" aria-hidden="true" />}
      <div className="studio-brand-area">
        <button className="studio-app-mark" onClick={onBack} aria-label="Back to Luma home">L</button>
        <strong className="studio-product-name">Luma Studio</strong>
      </div>

      <div className="studio-project-title">
        <strong>{projectName}</strong>
        <span aria-live="polite">{saveState === "saving" ? "Saving…" : saveState === "error" ? "Save needs attention" : saveState === "unsaved" ? "Unsaved changes" : "Saved locally"}</span>
      </div>

      <div className="spatial-share-actions">
        <button className="studio-icon-button" onClick={onUndo} title="Undo (⌘Z)" aria-label="Undo" disabled={!canUndo}><Undo2 /></button>
        <button className="studio-icon-button" onClick={onRedo} title="Redo (⇧⌘Z)" aria-label="Redo" disabled={!canRedo}><Redo2 /></button>
        <span className="studio-action-divider" />
        <button className="studio-header-button studio-fit-button" onClick={onFit}>Fit</button>
        <span className="studio-zoom-readout">{zoom}%</span>
        <details ref={menuRef} className="studio-app-menu">
          <summary aria-label="More application actions"><Ellipsis /></summary>
          <div>
            <button onClick={() => run(onOpen)}><FolderOpen /><span>Open…</span><kbd>⌘O</kbd></button>
            <button onClick={() => run(onSave)}><Save /><span>Save project</span><kbd>⌘S</kbd></button>
            <hr />
            <button className={filtersOpen ? "active" : ""} onClick={() => run(onFilters)}><span>Filters</span></button>
            <button onClick={() => run(onBatch)}><span>Batch processing</span></button>
            <button onClick={() => run(onHistory)}><span>Version history</span></button>
            <button onClick={() => run(onSettings)}><span>Workspaces & shortcuts</span></button>
          </div>
        </details>
        <button className={`spatial-export ${exportOpen ? "active" : ""}`} onClick={onExport} aria-haspopup="dialog" aria-expanded={exportOpen}>
          Export <ChevronDown />
        </button>
      </div>
    </header>
  );
}
