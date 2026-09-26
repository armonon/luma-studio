// A tiny action recorder. Each recorded step is a serializable call against
// the Studio's scripting surface, so replay is deterministic and can be used
// as the basis for batch processing later.

import {
  BLEND_MODES,
  type BlendMode,
  type ShapeStyle,
  type SmartFilter,
  type TextStyle,
  type Transform,
} from "./document";
import { defaultProAdjustment, PRO_ADJUSTMENT_KINDS, type ProAdjustmentKind, type ProAdjustmentParams } from "./pro-adjustments";
import { isActionCondition, type ActionCondition } from "./action-conditions";

export type ActionStep = (
  | { op: "layerBatch"; operation: "group" | "ungroup" | "merge" | "duplicate" | "delete" | "visible" | "locked"; targets: { index: number; kind: string }[]; value?: boolean }
  | { op: "fill"; layerId?: "active"; color: string; opacity?: number }
  | { op: "clear"; layerId?: "active" }
  | { op: "invert"; layerId?: "active" }
  | { op: "blur"; layerId?: "active"; radius: number }
  | { op: "sharpen"; layerId?: "active"; radius: number; amount: number }
  | { op: "desaturate"; layerId?: "active"; amount: number }
  | { op: "hue"; layerId?: "active"; degrees: number }
  | { op: "invertSelection" }
  | { op: "featherSelection"; radius: number }
  | { op: "selectAll" }
  | { op: "deselect" }
  | { op: "addAdjustment"; tone: Record<string, number> }
  | { op: "addCurves" }
  | { op: "addLevels" }
  | { op: "addHsl" }
  | { op: "addProAdjustment"; kind: ProAdjustmentKind; params: ProAdjustmentParams }
  | { op: "addRaster"; name: string }
  | { op: "addShape"; style: ShapeStyle }
  | { op: "addText"; text: string; style: TextStyle; transform: Transform }
  | { op: "addSmartFilter"; kind: SmartFilter["kind"]; params: Record<string, number> }
  | { op: "addDropShadow" }
  | { op: "convertSmartObject" }
  | { op: "groupActive" }
  | { op: "duplicateActive" }
  | { op: "deleteActive" }
  | { op: "setOpacity"; opacity: number }
  | { op: "setFillOpacity"; opacity: number }
  | { op: "setBlendMode"; mode: BlendMode }
  | { op: "invertMask" }
  | { op: "clearMask" }
  | { op: "cropSelection" }
  | { op: "setTransform"; transform: Transform }
  | { op: "updateShape"; shape: ShapeStyle }
  | { op: "updateText"; text: TextStyle }
  | { op: "autoSubject" }) & { enabled?: boolean; /** All conditions must match the state immediately before this step. */ conditions?: ActionCondition[] };

export type Action = {
  name: string;
  steps: ActionStep[];
  /** Set for declarative actions contributed by an installed plugin. */
  sourcePluginId?: string;
};

const ARGUMENT_FREE_STEPS = new Set([
  "clear", "invert", "invertSelection", "selectAll", "deselect", "addCurves", "addLevels", "addHsl",
  "addDropShadow", "convertSmartObject", "groupActive", "duplicateActive", "deleteActive", "invertMask",
  "clearMask", "cropSelection", "autoSubject",
]);
const SMART_FILTER_KINDS = new Set([
  "blur", "sharpen", "high-pass", "motion-blur", "surface-blur", "median", "dust-scratches", "maximum",
  "minimum", "lens-blur", "reduce-noise", "displace", "invert", "desaturate", "hue",
]);

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function bounded(value: unknown, min: number, max: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function numericRecord(value: unknown, absoluteLimit = 1_000_000) {
  return record(value) && Object.values(value).every((candidate) => bounded(candidate, -absoluteLimit, absoluteLimit));
}

// Validate the complete payload before playback, including unused fields. Keep
// imported actions bounded and reject cycles, non-JSON values and deep trees.
function boundedPayload(value: unknown): boolean {
  const pending = [{ value, depth: 0 }];
  let nodes = 0, characters = 0;
  while (pending.length) {
    const item = pending.pop()!;
    if (++nodes > 250_000 || item.depth > 32) return false;
    const entry = item.value;
    if (typeof entry === "string") {
      characters += entry.length;
      if (characters > 8_000_000) return false;
    } else if (typeof entry === "number") {
      if (!Number.isFinite(entry)) return false;
    } else if (entry && typeof entry === "object") {
      const entries = Object.entries(entry);
      if (entries.length + pending.length + nodes > 250_000) return false;
      for (const [key, child] of entries) {
        characters += key.length;
        pending.push({ value: child, depth: item.depth + 1 });
      }
    } else if (entry !== null && entry !== undefined && typeof entry !== "boolean") return false;
  }
  return characters <= 8_000_000;
}

function safeTransform(value: unknown) {
  return numericRecord(value) && ["tx", "ty", "sx", "sy", "rotation"].every(key => bounded((value as Record<string, unknown>)[key], -1_000_000, 1_000_000));
}

function safeShape(value: unknown) {
  return record(value) && ["rect", "ellipse"].includes(value.kind as string) &&
    ["x", "y"].every(key => bounded(value[key], -1_000_000, 1_000_000)) &&
    ["w", "h", "strokeWidth", "radius"].every(key => bounded(value[key], 0, 1_000_000)) &&
    typeof value.fill === "string" && typeof value.stroke === "string";
}

function safeText(value: unknown) {
  return record(value) && typeof value.text === "string" && value.text.length <= 1_000_000 &&
    typeof value.font === "string" && typeof value.color === "string" &&
    ["left", "right", "center", "start", "end"].includes(value.align as string) &&
    bounded(value.lineHeight, 0, 1_000_000) && ["x", "y"].every(key => bounded(value[key], -1_000_000, 1_000_000));
}

function safeProParams(kind: ProAdjustmentKind, value: unknown) {
  if (!record(value) || value.kind !== kind) return false;
  // Required fields have the same shape as the engine's own defaults.
  return Object.entries(defaultProAdjustment(kind)).every(([key, expected]) => {
    const actual = value[key];
    if (Array.isArray(expected)) return Array.isArray(actual) && actual.length === expected.length && actual.every(number => bounded(number, -1_000_000, 1_000_000));
    if (typeof expected === "number") return bounded(actual, -1_000_000, 1_000_000);
    if (key === "preset") return ["cinematic", "teal-orange", "film", "chrome"].includes(actual as string);
    return typeof actual === typeof expected;
  });
}

export function isSafeAction(value: unknown): value is Action {
  if (!record(value) || typeof value.name !== "string" || value.name.length > 500 ||
      !Array.isArray(value.steps) || value.steps.length > 20_000 ||
      (value.sourcePluginId !== undefined && typeof value.sourcePluginId !== "string") || !boundedPayload(value)) return false;
  return value.steps.every((candidate) => {
    if (!record(candidate) || typeof candidate.op !== "string" || (candidate.enabled !== undefined && typeof candidate.enabled !== "boolean")) return false;
    if (candidate.conditions !== undefined && (!Array.isArray(candidate.conditions) || candidate.conditions.length > 8 || !candidate.conditions.every(isActionCondition))) return false;
    if (ARGUMENT_FREE_STEPS.has(candidate.op)) return true;
    switch (candidate.op) {
      case "layerBatch": return ["group", "ungroup", "merge", "duplicate", "delete", "visible", "locked"].includes(candidate.operation as string)
        && Array.isArray(candidate.targets) && candidate.targets.length > 0 && candidate.targets.length <= 10000
        && candidate.targets.every(target => record(target) && Number.isInteger(target.index) && bounded(target.index, 0, 9999) && typeof target.kind === "string" && target.kind.length < 80)
        && new Set(candidate.targets.map(target => target.index)).size === candidate.targets.length
        && (!["visible", "locked"].includes(candidate.operation as string) || typeof candidate.value === "boolean");
      case "fill": return typeof candidate.color === "string" && (candidate.opacity === undefined || bounded(candidate.opacity, 0, 1));
      case "blur": case "featherSelection": return bounded(candidate.radius, 0, 512);
      case "sharpen": return bounded(candidate.radius, 0, 128) && bounded(candidate.amount, 0, 10);
      case "desaturate": return bounded(candidate.amount, 0, 1);
      case "hue": return bounded(candidate.degrees, -3_600, 3_600);
      case "addAdjustment": return numericRecord(candidate.tone);
      case "addProAdjustment": return typeof candidate.kind === "string" &&
        PRO_ADJUSTMENT_KINDS.includes(candidate.kind as ProAdjustmentKind) && safeProParams(candidate.kind as ProAdjustmentKind, candidate.params);
      case "addRaster": return typeof candidate.name === "string" && candidate.name.length <= 500;
      case "addShape": return safeShape(candidate.style);
      case "addText": return typeof candidate.text === "string" && candidate.text.length <= 1_000_000 &&
        safeText(candidate.style) && safeTransform(candidate.transform);
      case "addSmartFilter": return typeof candidate.kind === "string" && SMART_FILTER_KINDS.has(candidate.kind) && numericRecord(candidate.params);
      case "setOpacity": case "setFillOpacity": return bounded(candidate.opacity, 0, 1);
      case "setBlendMode": return typeof candidate.mode === "string" && BLEND_MODES.includes(candidate.mode as BlendMode);
      case "setTransform": return safeTransform(candidate.transform);
      case "updateShape": return safeShape(candidate.shape);
      case "updateText": return safeText(candidate.text);
      default: return false;
    }
  });
}

export class ActionRecorder {
  private edits: Array<{ index: number; before: string; after: string }> = [];
  private undoneEdits: Array<{ index: number; before: string; after: string }> = [];
  private playbackDepth = 0;
  private recording: Action | null = null;
  private saved: Action[] = [];

  private clearEditHistory() { this.edits = []; this.undoneEdits = []; }
  canUndoEdit() { return this.edits.length > 0 && !this.isRecording(); }
  canRedoEdit() { return this.undoneEdits.length > 0 && !this.isRecording(); }
  replace(index: number, next: Action) {
    const previous = this.saved[index];
    if (!previous || this.isRecording()) throw new Error("Stop recording and select an existing action before editing.");
    if (previous.sourcePluginId || next.sourcePluginId) throw new Error("Plugin actions are read-only; edit the source package instead.");
    if (!isSafeAction(next)) throw new Error("Action edits contain malformed or unsupported steps.");
    const before = JSON.stringify(previous), after = JSON.stringify(next);
    if (before === after) return false;
    const size = before.length + after.length;
    if (size > 4_000_000) throw new Error("This edit exceeds the bounded action-undo budget; split the action into smaller actions.");
    this.saved[index] = JSON.parse(after) as Action;
    this.undoneEdits = [];
    this.edits.push({ index, before, after });
    let characters = this.edits.reduce((sum, edit) => sum + edit.before.length + edit.after.length, 0);
    while (this.edits.length > 64 || characters > 4_000_000) {
      const removed = this.edits.shift()!;
      characters -= removed.before.length + removed.after.length;
    }
    return true;
  }
  undoEdit() {
    if (!this.canUndoEdit()) return false;
    const edit = this.edits.pop()!;
    this.saved[edit.index] = JSON.parse(edit.before) as Action;
    this.undoneEdits.push(edit);
    return true;
  }
  redoEdit() {
    if (!this.canRedoEdit()) return false;
    const edit = this.undoneEdits.pop()!;
    this.saved[edit.index] = JSON.parse(edit.after) as Action;
    this.edits.push(edit);
    return true;
  }

  isRecording() {
    return this.recording !== null;
  }
  start(name: string) {
    this.recording = { name, steps: [] };
  }
  push(step: ActionStep) {
    if (this.recording && !this.playbackDepth) this.recording.steps.push(step);
  }
  withoutRecording<T>(run: () => T): T {
    this.playbackDepth++;
    try { return run(); } finally { this.playbackDepth--; }
  }
  stop(): Action | null {
    const a = this.recording;
    if (!a) return null;
    this.recording = null;
    this.clearEditHistory();
    this.saved.push(a);
    return a;
  }
  list() {
    return this.saved.slice();
  }
  install(action: Action, sourcePluginId: string) {
    if (!isSafeAction(action)) throw new Error("Plugin action is malformed or unsupported");
    this.clearEditHistory();
    const installed: Action = {
      name: action.name,
      steps: action.steps.map((step) => ({ ...step })),
      sourcePluginId,
    };
    this.saved.push(installed);
    return installed;
  }
  removeFromPlugin(sourcePluginId: string) {
    this.clearEditHistory();
    const before = this.saved.length;
    this.saved = this.saved.filter((action) => action.sourcePluginId !== sourcePluginId);
    return before - this.saved.length;
  }
  remove(index: number) {
    this.clearEditHistory();
    this.saved.splice(index, 1);
  }
  get(index: number) {
    return this.saved[index];
  }
  toJSON() {
    return JSON.stringify(this.saved, null, 2);
  }
  fromJSON(json: string) {
    try {
      const parsed = JSON.parse(json);
      if (Array.isArray(parsed)) {
        this.clearEditHistory();
        // Installed plugin actions belong to the running application, not to
        // whichever project was just opened. Preserve the live package's
        // current actions and discard serialized plugin copies, which could
        // otherwise duplicate or resurrect an uninstalled package.
        const installed = this.saved.filter((action) => action.sourcePluginId);
        this.saved = [
          ...parsed.filter((action) => !action?.sourcePluginId && isSafeAction(action)),
          ...installed,
        ];
      }
    } catch {
      // ignore
    }
  }
}
