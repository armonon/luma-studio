"use client";

import type { AiEditQuality } from "@/app/engine/ai-edit";
import type { AiProvenance, Layer } from "@/app/engine/document";

export default function NeuralPanel({
  prompt,
  operation,
  quality,
  variations,
  strength,
  preserve,
  temperature,
  running,
  neuralProgress,
  activeLayer,
  identityReference,
  onPromptChange,
  onOperationChange,
  onQualityChange,
  onVariationsChange,
  onStrengthChange,
  onPreserveChange,
  onTemperatureChange,
  onToggleIdentity,
  onGenerate,
  onCancel,
  onNeuralSubject,
  onLumaMask,
  onInvertMask,
  onRevealAll,
}: Readonly<{
  prompt: string;
  operation: AiProvenance["operation"];
  quality: AiEditQuality;
  variations: number;
  strength: number;
  preserve: number;
  temperature: number;
  running: boolean;
  neuralProgress: number | null;
  activeLayer: Layer | null | undefined;
  identityReference: Layer | null | undefined;
  onPromptChange: (prompt: string) => void;
  onOperationChange: (operation: AiProvenance["operation"]) => void;
  onQualityChange: (quality: AiEditQuality) => void;
  onVariationsChange: (variations: number) => void;
  onStrengthChange: (strength: number) => void;
  onPreserveChange: (preserve: number) => void;
  onTemperatureChange: (temperature: number) => void;
  onToggleIdentity: () => void;
  onGenerate: () => void;
  onCancel: () => void;
  onNeuralSubject: () => void;
  onLumaMask: () => void;
  onInvertMask: () => void;
  onRevealAll: () => void;
}>) {
  const identityUnavailable = !activeLayer || activeLayer.kind === "group" || activeLayer.kind.startsWith("adjustment-");
  return (
    <section className="glass-card neural-card neural-compact" data-contextual-panel="neural">
      <header><strong><span>✦</span> Neural Lab</strong><small>ON-DEVICE MODEL + GPT IMAGE</small></header>
      <div style={{ display: "grid", gap: 6, padding: "8px 10px 4px" }}>
        <textarea value={prompt} onChange={(event) => onPromptChange(event.target.value)} aria-label="Generative edit prompt" style={{ minHeight: 58, resize: "vertical", borderRadius: 8, padding: 8, background: "rgba(255,255,255,.06)", color: "inherit", border: "1px solid rgba(255,255,255,.14)" }} />
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", alignItems: "center", gap: 6, padding: "5px 7px", border: "1px solid rgba(126,231,255,.15)", borderRadius: 8, background: "rgba(126,231,255,.035)", fontSize: 10 }}>
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><strong>Identity Lock</strong> · {identityReference?.name ?? "No reference"}</span>
          <button disabled={identityUnavailable} onClick={onToggleIdentity} title="The locked layer is sent as a separate identity/product reference for generative edits" style={{ padding: "4px 7px", fontSize: 9 }}>
            {identityReference?.id === activeLayer?.id ? "Unlock" : "Lock active"}
          </button>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <select value={operation} onChange={(event) => onOperationChange(event.target.value as AiProvenance["operation"])} style={{ flex: 1 }}>
            <option value="fill">Generative fill</option><option value="remove">Remove</option><option value="relight">Relight</option><option value="harmonize">Harmonize</option><option value="upscale">Upscale 2× · new copy</option><option value="expand">Expand 150% · new copy</option>
          </select>
          <button onClick={onGenerate} disabled={running || !prompt.trim()} style={{ flex: 1 }}>{running ? "Creating…" : "Generate layer ✦"}</button>
          {running && <button onClick={onCancel} title="Cancel all pending variations">Cancel</button>}
        </div>
        {(operation === "upscale" || operation === "expand") && <small>Creates an enlarged raster document; your original layered tab stays unchanged. Expand adds space on all sides. Maximum 3840 px per side / 8.29 MP.</small>}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          <label style={{ display: "grid", gap: 3, fontSize: 10 }}><span>Quality</span><select value={quality} onChange={(event) => onQualityChange(event.target.value as AiEditQuality)}><option value="auto">Auto</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
          <label style={{ display: "grid", gap: 3, fontSize: 10 }}><span>Variations</span><select value={variations} onChange={(event) => onVariationsChange(Number(event.target.value))}>{[1, 2, 3, 4].map((count) => <option key={count} value={count}>{count}</option>)}</select></label>
        </div>
        <label style={{ display: "grid", gridTemplateColumns: "72px 1fr 34px", gap: 5, alignItems: "center", fontSize: 10 }}><span>Strength</span><input type="range" min="0" max="100" value={Math.round(strength * 100)} onChange={(event) => onStrengthChange(Number(event.target.value) / 100)} /><output>{Math.round(strength * 100)}%</output></label>
        <label style={{ display: "grid", gridTemplateColumns: "72px 1fr 34px", gap: 5, alignItems: "center", fontSize: 10 }}><span>Preserve</span><input type="range" min="0" max="100" value={Math.round(preserve * 100)} onChange={(event) => onPreserveChange(Number(event.target.value) / 100)} /><output>{Math.round(preserve * 100)}%</output></label>
        {operation === "relight" && <label style={{ display: "grid", gridTemplateColumns: "72px 1fr 34px", gap: 5, alignItems: "center", fontSize: 10 }}><span>Temperature</span><input type="range" min="-100" max="100" value={Math.round(temperature * 100)} onChange={(event) => onTemperatureChange(Number(event.target.value) / 100)} /><output>{Math.round(temperature * 100)}</output></label>}
      </div>
      <div className="neural-quick-grid">
        <button onClick={onNeuralSubject} disabled={neuralProgress !== null}><i>✦</i><span>{neuralProgress !== null ? `${Math.round(neuralProgress)}%` : "Neural subject"}</span></button>
        <button onClick={onLumaMask}><i>◐</i><span>Luma mask</span></button>
        <button onClick={onInvertMask}><i>◑</i><span>Invert mask</span></button>
        <button onClick={onRevealAll}><i>◯</i><span>Reveal all</span></button>
      </div>
    </section>
  );
}
