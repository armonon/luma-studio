/**
 * Canonical tool metadata for every studio surface.
 *
 * Pointer implementations still live beside the canvas while they depend on
 * document-local closures, but the dispatch and overlay kinds below are the
 * stable contract the canvas uses to choose those implementations. The rail,
 * searchable palette, shortcuts, cursors, and options bar all derive from this
 * file instead of maintaining competing tool lists.
 */

export type WorkspaceMode =
  | "edit"
  | "retouch"
  | "select"
  | "mask"
  | "develop"
  | "vector"
  | "transform"
  | "measure";

export type Tool =
  | "move" | "brush" | "capture-brush" | "pencil" | "mixer" | "erase"
  | "gradient" | "pattern" | "clone" | "heal" | "spot-heal" | "patch"
  | "remove" | "dodge" | "burn" | "blur-brush" | "sharpen-brush"
  | "smudge" | "sponge" | "liquify" | "fill" | "text" | "paragraph-text"
  | "vertical-text" | "path-text" | "type-mask" | "rect" | "ellipse"
  | "triangle" | "polygon" | "line" | "custom-shape" | "frame" | "pen"
  | "path-select" | "direct-select" | "mask-add" | "mask-remove"
  | "sel-rect" | "sel-ellipse" | "sel-lasso" | "sel-polygon"
  | "sel-magnetic" | "sel-quick" | "sel-wand" | "sel-sam" | "tone"
  | "crop" | "perspective-crop" | "straighten" | "content-move"
  | "perspective-warp" | "radial-warp" | "eyedropper" | "color-sampler"
  | "ruler";

export type ToolOptionsKind = "general" | "paint" | "selection" | "type" | "crop" | "transform" | "shape" | "pen";
export type ToolPointerKind = "move" | "paint" | "retouch" | "selection" | "vector" | "transform" | "sample" | "none";
export type ToolOverlayKind = "transform" | "brush" | "selection" | "path" | "warp" | "sample" | "none";
export type ToolCursorVisualKind =
  | "precision" | "move" | "brush" | "selection" | "sample"
  | "type" | "path" | "transform" | "fill" | "gradient";

export type ToolDefinition = Readonly<{
  id: Tool;
  workspace: WorkspaceMode;
  icon: string;
  label: string;
  shortcut: string;
  cursor: "default" | "crosshair" | "move";
  cursorVisual: ToolCursorVisualKind;
  options: ToolOptionsKind;
  pointer: ToolPointerKind;
  overlay: ToolOverlayKind;
}>;

export type WorkspaceDefinition = Readonly<{
  id: WorkspaceMode;
  label: string;
  description: string;
}>;

export const WORKSPACE_REGISTRY: readonly WorkspaceDefinition[] = [
  { id: "edit", label: "Edit", description: "Pixel + vector" },
  { id: "retouch", label: "Retouch", description: "Repair + paint" },
  { id: "select", label: "Select", description: "Marquee, lasso, wand" },
  { id: "mask", label: "Mask", description: "Selection intelligence" },
  { id: "develop", label: "Develop", description: "Nondestructive color" },
  { id: "vector", label: "Type", description: "Text + shapes" },
  { id: "transform", label: "Transform", description: "Crop + deform" },
  { id: "measure", label: "Measure", description: "Color + dimensions" },
] as const;

type Seed = readonly [Tool, WorkspaceMode, string, string, string];

const seeds: readonly Seed[] = [
  ["move", "edit", "↖", "Move", "V"], ["brush", "edit", "╱", "Brush", "B"],
  ["capture-brush", "edit", "◉", "Capture Brush", "C"], ["pencil", "edit", "✎", "Pencil", "N"],
  ["mixer", "edit", "≈", "Mixer brush", "X"], ["erase", "edit", "⌫", "Erase", "E"],
  ["gradient", "edit", "◩", "Gradient", "G"], ["pattern", "edit", "▦", "Pattern", "P"],
  ["fill", "edit", "▣", "Fill", "F"],
  ["clone", "retouch", "◎", "Clone stamp", "S"], ["heal", "retouch", "✚", "Healing brush", "J"],
  ["spot-heal", "retouch", "✣", "Spot healing", "Q"], ["patch", "retouch", "⬡", "Patch", "A"],
  ["remove", "retouch", "◇", "Remove", "R"], ["dodge", "retouch", "◌", "Dodge", "O"],
  ["burn", "retouch", "●", "Burn", "U"], ["blur-brush", "retouch", "◍", "Blur", "L"],
  ["sharpen-brush", "retouch", "◆", "Sharpen", "H"], ["smudge", "retouch", "〰", "Smudge", "M"],
  ["sponge", "retouch", "◉", "Sponge", "D"], ["liquify", "retouch", "≋", "Liquify", "Y"],
  ["sel-rect", "select", "▭", "Rect marquee", "M"], ["sel-ellipse", "select", "◯", "Ellipse marquee", "N"],
  ["sel-lasso", "select", "◜", "Lasso", "L"], ["sel-polygon", "select", "⬠", "Polygonal lasso", "P"],
  ["sel-magnetic", "select", "↯", "Magnetic lasso", "G"], ["sel-quick", "select", "◒", "Quick selection", "Q"],
  ["sel-wand", "select", "✣", "Magic wand", "W"], ["sel-sam", "select", "✦", "SAM click-select", "K"],
  ["mask-add", "mask", "＋", "Reveal", "B"], ["mask-remove", "mask", "−", "Hide", "E"],
  ["tone", "develop", "◐", "Tone", "T"],
  ["text", "vector", "T", "Text", "T"], ["paragraph-text", "vector", "¶", "Paragraph text", "A"],
  ["vertical-text", "vector", "↧", "Vertical text", "V"], ["path-text", "vector", "⌒", "Type on path", "Y"],
  ["type-mask", "vector", "T⃞", "Type mask", "M"], ["rect", "vector", "▭", "Rect", "R"],
  ["ellipse", "vector", "◯", "Ellipse", "O"], ["triangle", "vector", "△", "Triangle", "I"],
  ["polygon", "vector", "⬡", "Polygon", "G"], ["line", "vector", "╱", "Line", "L"],
  ["custom-shape", "vector", "★", "Custom shape", "C"], ["frame", "vector", "▣", "Frame", "F"],
  ["pen", "vector", "✎", "Pen", "P"], ["path-select", "vector", "↖", "Path selection", "S"],
  ["direct-select", "vector", "△", "Edit Points", "D"],
  ["crop", "transform", "⌗", "Crop", "C"], ["perspective-crop", "transform", "▱", "Perspective crop", "K"],
  ["straighten", "transform", "／", "Straighten", "S"], ["content-move", "transform", "⇥", "Content-aware move", "M"],
  ["perspective-warp", "transform", "◇", "Perspective warp", "W"], ["radial-warp", "transform", "⌘", "Radial warp", "P"],
  ["eyedropper", "measure", "⌁", "Eyedropper", "I"], ["color-sampler", "measure", "⊕", "Color sampler", "S"],
  ["ruler", "measure", "╱", "Ruler", "R"],
] as const;

const paintTools = new Set<Tool>(["brush", "capture-brush", "pencil", "mixer", "erase", "gradient", "pattern", "fill", "mask-add", "mask-remove"]);
const retouchTools = new Set<Tool>(["clone", "heal", "spot-heal", "patch", "remove", "dodge", "burn", "blur-brush", "sharpen-brush", "smudge", "sponge", "liquify"]);
const selectionTools = new Set<Tool>(["sel-rect", "sel-ellipse", "sel-lasso", "sel-polygon", "sel-magnetic", "sel-quick", "sel-wand", "sel-sam"]);
const typeTools = new Set<Tool>(["text", "paragraph-text", "vertical-text", "path-text", "type-mask"]);
const vectorTools = new Set<Tool>([...typeTools, "rect", "ellipse", "triangle", "polygon", "line", "custom-shape", "frame", "pen", "path-select", "direct-select"]);
const transformTools = new Set<Tool>(["crop", "perspective-crop", "straighten", "content-move", "perspective-warp", "radial-warp"]);
const sampleTools = new Set<Tool>(["eyedropper", "color-sampler", "ruler"]);
const brushCursorTools = new Set<Tool>([
  "brush", "capture-brush", "pencil", "mixer", "erase", "mask-add", "mask-remove",
  "clone", "heal", "spot-heal", "patch", "remove", "dodge", "burn", "blur-brush",
  "sharpen-brush", "smudge", "sponge", "liquify", "sel-quick",
]);

function cursorVisualFor(id: Tool): ToolCursorVisualKind {
  if (brushCursorTools.has(id)) return "brush";
  if (id === "move" || id === "content-move" || id === "path-select") return "move";
  if (id === "gradient") return "gradient";
  if (id === "pattern" || id === "fill") return "fill";
  if (selectionTools.has(id)) return "selection";
  if (typeTools.has(id)) return "type";
  if (id === "pen" || id === "direct-select" || vectorTools.has(id)) return "path";
  if (transformTools.has(id)) return "transform";
  if (sampleTools.has(id)) return "sample";
  return "precision";
}

function definition([id, workspace, icon, label, shortcut]: Seed): ToolDefinition {
  const options: ToolOptionsKind = paintTools.has(id) || retouchTools.has(id) ? "paint"
    : selectionTools.has(id) ? "selection" : typeTools.has(id) ? "type" : ["rect", "ellipse", "triangle", "polygon", "line", "custom-shape"].includes(id) ? "shape"
      : id === "pen" ? "pen" : id === "crop" || id === "perspective-crop" ? "crop" : id === "move" || id === "path-select" ? "transform" : "general";
  const pointer: ToolPointerKind = id === "move" ? "move" : paintTools.has(id) ? "paint"
    : retouchTools.has(id) ? "retouch" : selectionTools.has(id) ? "selection"
      : vectorTools.has(id) ? "vector" : transformTools.has(id) ? "transform"
        : sampleTools.has(id) ? "sample" : "none";
  const overlay: ToolOverlayKind = id === "move" ? "transform" : paintTools.has(id) || retouchTools.has(id) ? "brush"
    : selectionTools.has(id) ? "selection" : vectorTools.has(id) ? "path"
      : transformTools.has(id) ? "warp" : sampleTools.has(id) ? "sample" : "none";
  const cursor = id === "move" ? "move" : pointer === "none" ? "default" : "crosshair";
  return { id, workspace, icon, label, shortcut, cursor, cursorVisual: cursorVisualFor(id), options, pointer, overlay };
}

export const TOOL_REGISTRY: Readonly<Record<Tool, ToolDefinition>> = Object.freeze(
  Object.fromEntries(seeds.map((seed) => {
    const item = definition(seed);
    return [item.id, item];
  })) as Record<Tool, ToolDefinition>,
);

export const MODE_TOOLS: Readonly<Record<WorkspaceMode, ReadonlyArray<readonly [Tool, string, string, string]>>> =
  Object.freeze(Object.fromEntries(WORKSPACE_REGISTRY.map(({ id }) => [
    id,
    seeds.filter((seed) => seed[1] === id).map(([tool, , icon, label, shortcut]) => [tool, icon, label, shortcut] as const),
  ])) as unknown as Record<WorkspaceMode, ReadonlyArray<readonly [Tool, string, string, string]>>);

export const WORKSPACE_IDS = WORKSPACE_REGISTRY.map(({ id }) => id);
export const ALL_TOOL_IDS = Object.keys(TOOL_REGISTRY) as Tool[];

export function toolDefinition(id: Tool): ToolDefinition {
  return TOOL_REGISTRY[id];
}

export function toolsForWorkspace(workspace: WorkspaceMode): readonly ToolDefinition[] {
  return MODE_TOOLS[workspace].map(([id]) => TOOL_REGISTRY[id]);
}
