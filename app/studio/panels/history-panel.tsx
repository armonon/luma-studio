"use client";

import { useContext } from "react";
import type { BlendMode } from "@/app/engine/document";
import type { Studio } from "@/app/engine/studio";
import { ExpandedWorkspaceContext } from "../panel-workspace-context";
import VersionHistoryDialog from "../version-history-dialog";

export default function HistoryPanel({ studio, history, opacity, blend, hasSelection, onOpacity, onBlend, onRestore, onMix, onOpen }: {
  studio: Studio | null;
  history: ReturnType<Studio["historyState"]> | undefined;
  opacity: number;
  blend: BlendMode;
  hasSelection: boolean;
  onOpacity: (value: number) => void;
  onBlend: (value: BlendMode) => void;
  onRestore: (id: string, label: string) => void;
  onMix: (id: string, label: string) => void;
  onOpen: () => void;
}) {
  const expanded = useContext(ExpandedWorkspaceContext);
  if (expanded) return <VersionHistoryDialog inline history={history} opacity={opacity} blend={blend} hasSelection={hasSelection} onOpacity={onOpacity} onBlend={onBlend} onRestore={onRestore} onMix={onMix} />;
  return <div className="spatial-view-dock">
    <button onClick={() => studio?.undo()} title="Undo" aria-label="Undo" disabled={!studio?.canUndo()}>↶</button>
    <button onClick={() => studio?.redo()} title="Redo" aria-label="Redo" disabled={!studio?.canRedo()}>↷</button>
    <button onClick={() => studio?.selectAll()} title="Select all" aria-label="Select all">▭</button>
    <span />
    <button onClick={onOpen} title={`${history?.operations ?? 0} operations · ${history?.branchPoints ?? 0} branch points`} aria-label="Open version history">◴{history?.branchPoints ? <sup>{history.branchPoints + 1}</sup> : null}</button>
  </div>;
}
