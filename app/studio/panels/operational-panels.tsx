"use client";
import { lazy, Suspense, useState } from "react";
import type { ActionPlaybackReport } from "../../engine/action-playback";
import type { Action } from "../../engine/actions";
import type { AlphaCalculation, AlphaCombineMode } from "../../engine/alpha-surface";
import type { StudioCommand } from "../../desktop/menu-model";
const ActionStepEditor = lazy(() => import("./action-step-editor").then(module => ({ default: module.ActionStepEditor })));

export type ChannelView = "rgb" | "red" | "green" | "blue" | "alpha";

export type AlphaChannelDraft = { id: string; name: string; otherId: string; mode: AlphaCalculation; opacity: number; loadMode: AlphaCombineMode };
export const EMPTY_ALPHA_DRAFT: AlphaChannelDraft = { id: "", name: "", otherId: "", mode: "multiply", opacity: 1, loadMode: "replace" };

export function ChannelsPanel({ channelView, onChange, onLoad, canLoad, channels, draft, onDraft, execute, enabled }: Readonly<{
  channelView: ChannelView;
  onChange: (channel: ChannelView) => void;
  onLoad: () => void;
  canLoad: boolean;
  channels: readonly { id: string; name: string }[];
  draft: AlphaChannelDraft;
  onDraft: (draft: AlphaChannelDraft) => void;
  execute: (command: StudioCommand) => void;
  enabled: (command: StudioCommand) => boolean;
}>) {
  return (
    <section className="glass-card mask-card" data-contextual-panel="channels">
      <header><strong>Channels</strong><small title="Channel previews do not change RGB export">{channelView.toUpperCase()}</small></header>
      <div className="mask-segmented channel-switcher">
        {(["rgb", "red", "green", "blue", "alpha"] as const).map((channel) => (
          <button key={channel} className={channelView === channel ? "active" : ""} onClick={() => onChange(channel)} aria-pressed={channelView === channel}>
            {channel === "rgb" ? "RGB" : channel === "alpha" ? "A" : channel[0].toUpperCase()}
          </button>
        ))}
      </div>
      <button type="button" onClick={onLoad} disabled={!canLoad} title="Load the composite channel as selection alpha (⌘⌥2). RGB loads luminosity.">Load as selection</button>
      <div className="saved-alpha-controls">
        <label>Saved alpha<select aria-label="Saved alpha channel" value={draft.id} onChange={event => {
          const channel = channels.find(candidate => candidate.id === event.target.value);
          onDraft({ ...draft, id: event.target.value, name: channel?.name ?? "" });
        }}><option value="">Choose channel…</option>{channels.map(channel => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></label>
        <label>Name<input aria-label="Alpha channel name" maxLength={80} placeholder="Alpha channel" value={draft.name} onChange={event => onDraft({ ...draft, name: event.target.value })} /></label>
        <label>Load mode<select aria-label="Alpha load mode" value={draft.loadMode} onChange={event => onDraft({ ...draft, loadMode: event.target.value as AlphaCombineMode })}>
          <option value="replace">Replace selection</option><option value="add">Add</option><option value="subtract">Subtract</option><option value="intersect">Intersect</option>
        </select></label>
        <div className="alpha-actions">{([
          ["channel-save", "Save selection"], ["channel-load", "Load"], ["channel-update", "Replace"], ["channel-rename", "Rename"], ["channel-invert", "Invert"], ["channel-delete", "Delete"],
        ] as const).map(([command, label]) => <button key={command} disabled={!enabled(command)} onClick={() => execute(command)}>{label}</button>)}</div>
        <details><summary>Calculations</summary>
          <label>Second source<select aria-label="Second alpha source" value={draft.otherId} onChange={event => onDraft({ ...draft, otherId: event.target.value })}>
            <option value="">Choose channel…</option>{channels.map(channel => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
          </select></label>
          <label>Blend<select aria-label="Channel calculation" value={draft.mode} onChange={event => onDraft({ ...draft, mode: event.target.value as AlphaCalculation })}>
            {(["multiply", "screen", "difference", "add", "subtract"] as const).map(mode => <option key={mode} value={mode}>{mode}</option>)}
          </select></label>
          <label>Opacity<input aria-label="Channel calculation opacity" type="number" min={0} max={100} value={Math.round(draft.opacity * 100)} onChange={event => onDraft({ ...draft, opacity: Math.max(0, Math.min(1, Number(event.target.value) / 100)) })} /></label>
          <button disabled={!enabled("channel-calculate")} onClick={() => execute("channel-calculate")}>Create calculated alpha</button>
        </details>
        <small>Load to refine; Replace stores the edited selection. Saved in .luma.</small>
      </div>
    </section>
  );
}

type Point = Readonly<{ x: number; y: number }>;
type Measurement = Readonly<{ start: Point; end: Point }>;
type ColorSample = Readonly<{ x: number; y: number; color: string }>;

export function MeasurePanel({ measurement, colorSamples, onClear }: Readonly<{
  measurement: Measurement | null;
  colorSamples: readonly ColorSample[];
  onClear: () => void;
}>) {
  return (
    <section className="glass-card tone-card" data-contextual-panel="measure">
      <header><strong>Measure & sample</strong><button onClick={onClear}>Clear</button></header>
      <div style={{ display: "grid", gap: 7, padding: "8px 12px 12px", fontSize: 11 }}>
        {measurement ? (() => {
          const dx = measurement.end.x - measurement.start.x;
          const dy = measurement.end.y - measurement.start.y;
          return <><div>Length <strong>{Math.hypot(dx, dy).toFixed(1)} px</strong></div><div>Angle <strong>{(Math.atan2(dy, dx) * 180 / Math.PI).toFixed(1)}°</strong></div><div>Δx {dx.toFixed(1)} · Δy {dy.toFixed(1)}</div></>;
        })() : <p style={{ margin: 0, opacity: 0.7 }}>Drag with Ruler or click with a sampler.</p>}
        {colorSamples.map((sample, index) => (
          <div key={`${sample.x}-${sample.y}-${index}`} style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <i style={{ width: 14, height: 14, borderRadius: 3, background: sample.color, border: "1px solid rgba(255,255,255,.35)" }} />
            <span>#{index + 1} · {sample.color} · {Math.round(sample.x)}, {Math.round(sample.y)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function ActionsPanel({ actions, recordingName, onStart, onStop, onPlay, onEdit, onUndoEdit, canUndoEdit, canRedoEdit, report }: Readonly<{
  actions: readonly Action[];
  recordingName: string;
  onStart: (name: string) => void;
  onStop: () => void;
  onPlay: (index: number) => void;
  onEdit: (index: number, action: Action) => void;
  onUndoEdit: (redo: boolean) => void;
  canUndoEdit: boolean;
  canRedoEdit: boolean;
  report?: ActionPlaybackReport | null;
}>) {
  const [draftName, setDraftName] = useState("");
  const [editing, setEditing] = useState<{ index: number; action: Action } | null>(null);
  const [page, setPage] = useState(0);
  const [reportView, setReportView] = useState<{ report: ActionPlaybackReport; page: number } | null>(null);
  const reportPage = reportView?.report === report ? reportView?.page ?? 0 : 0;
  const currentPage = Math.min(page, Math.max(0, Math.ceil(actions.length / 20) - 1));
  const visibleActions = actions.slice(currentPage * 20, currentPage * 20 + 20);
  const beginRecording = () => {
    onStart(draftName.trim() || `Action ${actions.length + 1}`);
    setDraftName("");
  };
  return (
    <section className="glass-card neural-card neural-compact" data-contextual-panel="actions">
      <header>
        <strong>Actions</strong>
        {recordingName
          ? <button onClick={onStop} title="Stop" aria-label="Stop recording">◼</button>
          : <button onClick={beginRecording} title="Record" aria-label="Record action">●</button>}
      </header>
      {!recordingName ? <label className="action-record-name">
        <span>Name</span>
        <input aria-label="Action name" value={draftName} maxLength={120} placeholder={`Action ${actions.length + 1}`}
          onChange={event => setDraftName(event.target.value)}
          onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); beginRecording(); } }} />
      </label> : <p className="action-record-name" role="status">Recording · {recordingName}</p>}
      <div className="neural-quick-grid">
        {visibleActions.map((action, index) => (
          <button key={action.name + index} onClick={() => onPlay(currentPage * 20 + index)}>
            <i>▶</i><span>{action.name}<br /><small style={{ opacity: 0.6 }}>{action.steps.length} steps</small></span>
          </button>
        ))}
        {!actions.length && <div className="inspector-empty-state" style={{ padding: "8px 4px" }}>No recorded actions</div>}
      </div>
      {actions.length > 20 && <div className="action-edit-buttons">
        <button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous actions</button>
        <span>{currentPage + 1} / {Math.ceil(actions.length / 20)}</span>
        <button disabled={(currentPage + 1) * 20 >= actions.length} onClick={() => setPage(currentPage + 1)}>Next actions</button>
      </div>}
      <div className="action-edit-buttons">
        <button disabled={!canUndoEdit || !!recordingName} onClick={() => onUndoEdit(false)}>Undo action edit</button>
        <button disabled={!canRedoEdit || !!recordingName} onClick={() => onUndoEdit(true)}>Redo action edit</button>
      </div>
      {!recordingName && <div className="action-edit-buttons">{visibleActions.map((action, index) => <button key={`${index}:${action.name}`} disabled={!!action.sourcePluginId}
        title={action.sourcePluginId ? "Plugin action · edit the source package" : "Edit steps and conditions"}
        onClick={() => setEditing({ index: currentPage * 20 + index, action })}>Edit {action.name}</button>)}</div>}
      {!recordingName && editing && actions[editing.index] === editing.action && <div className="action-editor-disclosure">
        <button onClick={() => setEditing(null)}>Cancel action edits</button>
        <Suspense fallback={<p>Loading step editor…</p>}><ActionStepEditor key={editing.index} action={editing.action} onApply={next => { onEdit(editing.index, next); setEditing(null); }} /></Suspense>
      </div>}
      {report && <details open={!report.completed} className="action-playback-report">
        <summary>{report.completed ? "Finished" : "Stopped"} · {report.name}</summary>
        <ol>{report.steps.slice(reportPage * 100, reportPage * 100 + 100).map(step => <li key={step.index} value={step.index + 1}>
          <span>{step.operation} · {step.status}</span>
          {step.message && <small>{step.message}</small>}
        </li>)}</ol>
        {report.steps.length > 100 && <div className="action-edit-buttons">
          <button disabled={reportPage === 0} onClick={() => setReportView({ report, page: reportPage - 1 })}>Previous results</button>
          <span>{reportPage + 1} / {Math.ceil(report.steps.length / 100)}</span>
          <button disabled={(reportPage + 1) * 100 >= report.steps.length} onClick={() => setReportView({ report, page: reportPage + 1 })}>Next results</button>
        </div>}
        {!report.completed && <p>Earlier completed steps remain in history. Use Undo to revert them.</p>}
      </details>}
    </section>
  );
}
