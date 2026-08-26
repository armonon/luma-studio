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
import { PRO_ADJUSTMENT_KINDS, type ProAdjustmentKind, type ProAdjustmentParams } from "./pro-adjustments";

export type ActionStep =
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
  | { op: "autoSubject" };

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

function finite(value: unknown) {
  return typeof value === "number" && Number.isFinite(value);
}

function bounded(value: unknown, min: number, max: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function numericRecord(value: unknown, absoluteLimit = 1_000_000) {
  return record(value) && Object.values(value).every((candidate) => bounded(candidate, -absoluteLimit, absoluteLimit));
}

export function isSafeAction(value: unknown): value is Action {
  if (!record(value) || typeof value.name !== "string" || value.name.length > 500 ||
      !Array.isArray(value.steps) || value.steps.length > 20_000 ||
      (value.sourcePluginId !== undefined && typeof value.sourcePluginId !== "string")) return false;
  return value.steps.every((candidate) => {
    if (!record(candidate) || typeof candidate.op !== "string") return false;
    if (ARGUMENT_FREE_STEPS.has(candidate.op)) return true;
    switch (candidate.op) {
      case "fill": return typeof candidate.color === "string" && (candidate.opacity === undefined || bounded(candidate.opacity, 0, 1));
      case "blur": case "featherSelection": return bounded(candidate.radius, 0, 512);
      case "sharpen": return bounded(candidate.radius, 0, 128) && bounded(candidate.amount, 0, 10);
      case "desaturate": return bounded(candidate.amount, 0, 1);
      case "hue": return bounded(candidate.degrees, -3_600, 3_600);
      case "addAdjustment": return numericRecord(candidate.tone);
      case "addProAdjustment": return typeof candidate.kind === "string" &&
        PRO_ADJUSTMENT_KINDS.includes(candidate.kind as ProAdjustmentKind) && record(candidate.params) && candidate.params.kind === candidate.kind;
      case "addRaster": return typeof candidate.name === "string" && candidate.name.length <= 500;
      case "addShape": return record(candidate.style);
      case "addText": return typeof candidate.text === "string" && candidate.text.length <= 1_000_000 &&
        record(candidate.style) && numericRecord(candidate.transform);
      case "addSmartFilter": return typeof candidate.kind === "string" && SMART_FILTER_KINDS.has(candidate.kind) && numericRecord(candidate.params);
      case "setOpacity": case "setFillOpacity": return bounded(candidate.opacity, 0, 1);
      case "setBlendMode": return typeof candidate.mode === "string" && BLEND_MODES.includes(candidate.mode as BlendMode);
      case "setTransform": return record(candidate.transform) && Object.values(candidate.transform).every(finite);
      case "updateShape": return record(candidate.shape);
      case "updateText": return record(candidate.text);
      default: return false;
    }
  });
}

export class ActionRecorder {
  private recording: Action | null = null;
  private saved: Action[] = [];

  isRecording() {
    return this.recording !== null;
  }
  start(name: string) {
    this.recording = { name, steps: [] };
  }
  push(step: ActionStep) {
    if (this.recording) this.recording.steps.push(step);
  }
  stop(): Action | null {
    const a = this.recording;
    if (!a) return null;
    this.recording = null;
    this.saved.push(a);
    return a;
  }
  list() {
    return this.saved.slice();
  }
  install(action: Action, sourcePluginId: string) {
    if (!isSafeAction(action)) throw new Error("Plugin action is malformed or unsupported");
    const installed: Action = {
      name: action.name,
      steps: action.steps.map((step) => ({ ...step })),
      sourcePluginId,
    };
    this.saved.push(installed);
    return installed;
  }
  removeFromPlugin(sourcePluginId: string) {
    const before = this.saved.length;
    this.saved = this.saved.filter((action) => action.sourcePluginId !== sourcePluginId);
    return before - this.saved.length;
  }
  remove(index: number) {
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
