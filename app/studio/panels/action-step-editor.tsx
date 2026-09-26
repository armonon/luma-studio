"use client";
import { useState } from "react";
import type { Action, ActionStep } from "../../engine/actions";
import { isSafeAction } from "../../engine/actions";
import { ACTION_LAYER_KINDS, type ActionCondition } from "../../engine/action-conditions";

export function ActionStepEditor({ action, onApply }: { action: Action; onApply: (action: Action) => void }) {
  const [draft, setDraft] = useState<Action>(() => structuredClone(action));
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState("");
  const [paramsOpen, setParamsOpen] = useState(false);
  const step = draft.steps[selected];
  const patch = (next: ActionStep) => { setParamsOpen(false); setDraft(current => ({ ...current, steps: current.steps.map((item, index) => index === selected ? next : item) })); };
  const conditions = step?.conditions ?? [];
  const changeCondition = (index: number, next: ActionCondition | null) => patch({ ...step, conditions: conditions.flatMap((condition, i) => i !== index ? [condition] : next ? [next] : []) });
  const move = (direction: -1 | 1) => {
    const index = selected + direction;
    if (index < 0 || index >= draft.steps.length) return;
    const steps = [...draft.steps];
    [steps[selected], steps[index]] = [steps[index], steps[selected]];
    setParamsOpen(false); setDraft({ ...draft, steps }); setSelected(index);
  };
  return <div className="action-step-editor">
    <label>Name<input aria-label="Edited action name" value={draft.name} maxLength={120} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
    <label>Step<input aria-label="Action step number" type="number" min={1} max={Math.max(1, draft.steps.length)} value={selected + 1} disabled={!draft.steps.length} onChange={event => { setParamsOpen(false); setSelected(Math.max(0, Math.min(draft.steps.length - 1, Math.floor(Number(event.target.value) || 1) - 1))); }} /> / {draft.steps.length}</label>
    {step && <strong>{step.op === "layerBatch" ? `${step.operation} · ${step.targets.length} layer(s)` : step.op}</strong>}
    {step?.op === "layerBatch" && <p>Targets recorded stack positions and layer types. Replay requires a matching layer structure.</p>}
    <div className="action-edit-buttons">
      <button disabled={selected <= 0} onClick={() => move(-1)}>Move up</button>
      <button disabled={!step || selected >= draft.steps.length - 1} onClick={() => move(1)}>Move down</button>
      <button disabled={!step || draft.steps.length >= 20_000} onClick={() => { setParamsOpen(false); const steps = [...draft.steps]; steps.splice(selected + 1, 0, structuredClone(step)); setDraft({ ...draft, steps }); setSelected(selected + 1); }}>Duplicate</button>
      <button disabled={!step} onClick={() => { setParamsOpen(false); setDraft({ ...draft, steps: draft.steps.filter((_, index) => index !== selected) }); setSelected(Math.max(0, selected - 1)); }}>Remove step</button>
    </div>
    {step && <>
      <label><input type="checkbox" checked={step.enabled !== false} onChange={event => patch({ ...step, enabled: event.target.checked })} />Enabled</label>
      <strong>Run when all conditions match</strong>
      {conditions.map((condition, index) => <div className="action-condition" key={index}>
        <select aria-label={`Condition ${index + 1} type`} value={condition.kind} onChange={event => {
          const kind = event.target.value as ActionCondition["kind"];
          changeCondition(index, kind === "orientation" ? { kind, value: "portrait" } : kind === "layer-kind" ? { kind, value: "raster" } : kind === "bit-depth" ? { kind, value: 8 } : { kind, value: true });
        }}>
          <option value="orientation">Orientation</option><option value="layer-kind">Layer type</option><option value="bit-depth">Bit depth</option>
          <option value="selection">Has selection</option><option value="mask">Has mask</option><option value="locked">Layer locked</option>
        </select>
        <select aria-label={`Condition ${index + 1} value`} value={String(condition.value)} onChange={event => {
          const value = event.target.value;
          changeCondition(index, { ...condition, value: condition.kind === "bit-depth" ? Number(value) : ["selection", "mask", "locked"].includes(condition.kind) ? value === "true" : value } as ActionCondition);
        }}>
          {(condition.kind === "orientation" ? ["portrait", "landscape", "square"] : condition.kind === "layer-kind" ? ACTION_LAYER_KINDS : condition.kind === "bit-depth" ? ["8", "16", "32"] : ["true", "false"]).map(value => <option key={value} value={value}>{value}</option>)}
        </select>
        <label><input type="checkbox" checked={condition.not === true} onChange={event => changeCondition(index, { ...condition, not: event.target.checked })} />Not</label>
        <button aria-label={`Remove condition ${index + 1}`} onClick={() => changeCondition(index, null)}>×</button>
      </div>)}
      <button disabled={conditions.length >= 8} onClick={() => patch({ ...step, conditions: [...conditions, { kind: "orientation", value: "portrait" }] })}>Add condition</button>
      <button aria-expanded={paramsOpen} onClick={() => setParamsOpen(!paramsOpen)}>Step parameters (JSON)</button>
      {paramsOpen && <StepParameters key={selected} step={step} onApply={patch} />}
    </>}
    {!step && <p>No steps. Record a new action to add operations.</p>}
    {error && <p role="alert">{error}</p>}
    <button onClick={() => {
      try {
        if (!draft.name.trim() || !isSafeAction(draft)) throw new Error("Enter a name and valid step parameters.");
        onApply(draft); setError("");
      } catch (failure) { setError(failure instanceof Error ? failure.message : "Action edit failed"); }
    }}>Apply action edits</button>
    <small>Saved with the project. Canvas Undo does not change the action library; use Undo action edit.</small>
  </div>;
}

function StepParameters({ step, onApply }: { step: ActionStep; onApply: (step: ActionStep) => void }) {
  const [json, setJson] = useState(() => JSON.stringify(step, null, 2));
  const [error, setError] = useState("");
  return <>
    <textarea aria-label="Step parameters JSON" value={json} maxLength={250_000} rows={8} onChange={event => setJson(event.target.value)} />
    <button onClick={() => {
      try {
        const candidate: unknown = JSON.parse(json);
        const action = { name: "Validation", steps: [candidate] };
        if (!isSafeAction(action)) throw new Error("Unsupported operation or invalid parameters.");
        onApply(action.steps[0]); setError("");
      } catch (failure) { setError(failure instanceof Error ? failure.message : "Invalid JSON"); }
    }}>Update draft step</button>
    {error && <p role="alert">{error}</p>}
  </>;
}
