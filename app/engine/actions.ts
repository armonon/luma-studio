// A tiny action recorder. Each recorded step is a serializable call against
// the Studio's scripting surface, so replay is deterministic and can be used
// as the basis for batch processing later.

import type { ShapeStyle, SmartFilter, TextStyle, Transform } from "./document";

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
  | { op: "addRaster"; name: string }
  | { op: "addShape"; style: ShapeStyle }
  | { op: "addText"; text: string; style: TextStyle; transform: Transform }
  | { op: "addSmartFilter"; kind: SmartFilter["kind"]; params: Record<string, number> }
  | { op: "addDropShadow" }
  | { op: "convertSmartObject" }
  | { op: "groupActive" }
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
          ...parsed.filter((action) => !action?.sourcePluginId),
          ...installed,
        ];
      }
    } catch {
      // ignore
    }
  }
}
