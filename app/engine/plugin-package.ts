import { SMART_FILTER_KINDS } from "./filters";
import type { Action, ActionStep } from "./actions";
import type { LumaPlugin } from "./studio";

export const LUMA_PLUGIN_SCHEMA = "luma-plugin/1" as const;
export const MAX_PLUGIN_PACKAGE_BYTES = 1024 * 1024;

export type LumaPluginPackage = {
  schema: typeof LUMA_PLUGIN_SCHEMA;
  manifest: {
    id: string;
    name: string;
    version: string;
    apiVersion: string;
    description?: string;
  };
  actions: Action[];
};

const ACTION_OPS = new Set<ActionStep["op"]>([
  "fill", "clear", "invert", "blur", "sharpen", "desaturate", "hue",
  "invertSelection", "featherSelection", "selectAll", "deselect",
  "addAdjustment", "addRaster", "addShape", "addText", "addSmartFilter",
  "addDropShadow", "convertSmartObject", "groupActive", "setTransform",
  "updateShape", "updateText", "autoSubject",
]);

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finiteRecord(value: unknown) {
  const input = record(value);
  if (!input || Object.values(input).some((entry) => typeof entry !== "number" || !Number.isFinite(entry))) return false;
  return true;
}

function validTransform(value: unknown) {
  const input = record(value);
  return !!input && ["tx", "ty", "sx", "sy", "rotation"].every((key) => typeof input[key] === "number" && Number.isFinite(input[key]));
}

function validateStep(value: unknown, actionName: string, index: number): asserts value is ActionStep {
  const step = record(value);
  const fail = (reason: string): never => { throw new Error(`Plugin action "${actionName}" step ${index + 1}: ${reason}`); };
  if (!step) throw new Error(`Plugin action "${actionName}" step ${index + 1}: must be an object`);
  if (typeof step.op !== "string" || !ACTION_OPS.has(step.op as ActionStep["op"])) fail("unsupported operation");
  const number = (key: string) => {
    if (typeof step[key] !== "number" || !Number.isFinite(step[key])) fail(`${key} must be a finite number`);
  };
  switch (step.op) {
    case "fill":
      if (typeof step.color !== "string" || step.color.length > 100) fail("color must be a CSS color string");
      if (step.opacity != null && (typeof step.opacity !== "number" || !Number.isFinite(step.opacity) || step.opacity < 0 || step.opacity > 1)) fail("opacity must be between 0 and 1");
      break;
    case "blur": case "featherSelection": number("radius"); break;
    case "sharpen": number("radius"); number("amount"); break;
    case "desaturate": number("amount"); break;
    case "hue": number("degrees"); break;
    case "addAdjustment": if (!finiteRecord(step.tone)) fail("tone must contain only finite numeric controls"); break;
    case "addRaster": if (typeof step.name !== "string" || !step.name.trim() || step.name.length > 120) fail("name is invalid"); break;
    case "addShape": if (!record(step.style)) fail("style is required"); break;
    case "addText":
      if (typeof step.text !== "string" || step.text.length > 20_000 || !record(step.style) || !validTransform(step.transform)) fail("text, style, and transform are required");
      break;
    case "addSmartFilter":
      if (typeof step.kind !== "string" || !SMART_FILTER_KINDS.includes(step.kind as never) || !finiteRecord(step.params)) fail("filter kind or parameters are invalid");
      break;
    case "setTransform": if (!validTransform(step.transform)) fail("transform is invalid"); break;
    case "updateShape": if (!record(step.shape)) fail("shape is required"); break;
    case "updateText": if (!record(step.text)) fail("text style is required"); break;
  }
}

export function parseLumaPluginPackage(source: string): LumaPluginPackage {
  if (new TextEncoder().encode(source).byteLength > MAX_PLUGIN_PACKAGE_BYTES) throw new Error("Plugin package exceeds the 1 MB safety limit");
  let input: unknown;
  try { input = JSON.parse(source); } catch { throw new Error("Plugin package is not valid JSON"); }
  const root = record(input);
  const manifest = record(root?.manifest);
  if (!root || root.schema !== LUMA_PLUGIN_SCHEMA || !manifest) throw new Error(`Plugin package must use schema ${LUMA_PLUGIN_SCHEMA}`);
  const id = manifest.id;
  const name = manifest.name;
  const version = manifest.version;
  const apiVersion = manifest.apiVersion;
  if (typeof id !== "string" || !/^[a-z0-9][a-z0-9._-]{1,63}$/.test(id)) throw new Error("Plugin id must be 2–64 lowercase characters");
  if (typeof name !== "string" || !name.trim() || name.length > 100) throw new Error("Plugin name is invalid");
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+(?:[-+][a-z0-9.-]+)?$/i.test(version)) throw new Error("Plugin version must use semantic versioning");
  if (typeof apiVersion !== "string" || !/^\d+\.\d+(?:\.\d+)?$/.test(apiVersion)) throw new Error("Plugin API version is invalid");
  if (manifest.description !== undefined && (typeof manifest.description !== "string" || manifest.description.length > 500)) throw new Error("Plugin description is invalid");
  if (!Array.isArray(root.actions) || root.actions.length > 64) throw new Error("Plugin actions must be an array of at most 64 items");
  const actions = root.actions.map((candidate, actionIndex) => {
    const action = record(candidate);
    if (!action || typeof action.name !== "string" || !action.name.trim() || action.name.length > 100 || !Array.isArray(action.steps) || action.steps.length > 256) {
      throw new Error(`Plugin action ${actionIndex + 1} is invalid`);
    }
    action.steps.forEach((step, index) => validateStep(step, action.name as string, index));
    return { name: action.name, steps: action.steps } as Action;
  });
  return {
    schema: LUMA_PLUGIN_SCHEMA,
    manifest: { id, name, version, apiVersion, ...(typeof manifest.description === "string" ? { description: manifest.description } : {}) },
    actions,
  };
}

/** Turn a data-only package into a host plugin without eval, dynamic code, or
 * filesystem permissions. Unloading atomically removes its contributed actions. */
export function createDeclarativePlugin(pkg: LumaPluginPackage): LumaPlugin {
  return {
    id: pkg.manifest.id,
    name: pkg.manifest.name,
    version: pkg.manifest.version,
    apiVersion: pkg.manifest.apiVersion,
    activate(studio) {
      for (const action of pkg.actions) studio.actions.install(action, pkg.manifest.id);
      return () => { studio.actions.removeFromPlugin(pkg.manifest.id); };
    },
  };
}
