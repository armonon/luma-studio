import type { Layer } from "@/app/engine/document";
import { ALL_TOOL_IDS, toolDefinition, type Tool } from "./tool-registry";

export type SpatialOperationId =
  | "extrude" | "bevel" | "sweep" | "revolve" | "surface-wrap" | "decal-project"
  | "depth-mask" | "volume-mask" | "occlusion" | "object-id"
  | "surface-paint" | "material-paint" | "normal-paint" | "displacement"
  | "relight" | "shadow-catcher" | "reflection-catcher" | "environment-light"
  | "camera-match" | "depth-transform" | "mesh-deform" | "physics-scatter"
  | "sample-material" | "measure-scene" | "animate" | "multipass-render";

export type SpatialOperation = Readonly<{
  id: SpatialOperationId;
  label: string;
  summary: string;
  destination: "luma" | "form" | "round-trip";
}>;

const operation = (id: SpatialOperationId, label: string, summary: string, destination: SpatialOperation["destination"] = "round-trip"): SpatialOperation => ({ id, label, summary, destination });

export const SPATIAL_OPERATION_REGISTRY: Readonly<Record<SpatialOperationId, SpatialOperation>> = Object.freeze(Object.fromEntries([
  operation("extrude", "Extrude", "Turn a silhouette into editable depth"),
  operation("bevel", "Bevel", "Add physical edge highlights and manufactured profiles"),
  operation("sweep", "Sweep", "Carry a profile along an editable path", "form"),
  operation("revolve", "Revolve", "Spin a profile into a lathed object", "form"),
  operation("surface-wrap", "Surface wrap", "Conform pixels, vectors or type to curved geometry"),
  operation("decal-project", "Project decal", "Project artwork through a camera onto scene surfaces"),
  operation("depth-mask", "Depth mask", "Convert distance ranges into sparse editable masks"),
  operation("volume-mask", "Selection volume", "Turn a 2D selection into a bounded 3D region"),
  operation("occlusion", "Occlusion", "Place content naturally behind and through scene objects"),
  operation("object-id", "Object ID", "Return stable scene-object selections to Luma"),
  operation("surface-paint", "Surface paint", "Paint directly across UV seams on linked objects"),
  operation("material-paint", "Material paint", "Paint roughness, metalness, emission and transmission"),
  operation("normal-paint", "Normal paint", "Paint small-scale lighting direction without changing topology"),
  operation("displacement", "Displacement", "Drive real or preview geometry from luminance and texture"),
  operation("relight", "Relight", "Use normals and depth to change light after rendering"),
  operation("shadow-catcher", "Shadow catcher", "Receive editable shadows on transparent output"),
  operation("reflection-catcher", "Reflection catcher", "Return editable reflections as a separate pass"),
  operation("environment-light", "Image lighting", "Use a layer or gradient as scene illumination"),
  operation("camera-match", "Match camera", "Infer perspective, horizon and framing from image guides"),
  operation("depth-transform", "Depth transform", "Move, rotate and scale content in XYZ"),
  operation("mesh-deform", "Mesh deform", "Bend, twist, taper, inflate or fracture linked content", "form"),
  operation("physics-scatter", "Physics scatter", "Distribute marks or objects with collision and gravity", "form"),
  operation("sample-material", "Sample material", "Estimate material color, roughness and surface response"),
  operation("measure-scene", "Measure scene", "Calibrate dimensions, camera scale and object distance"),
  operation("animate", "Animate", "Keyframe transforms, materials, paths and typography", "form"),
  operation("multipass-render", "Render passes", "Return beauty, depth, normal, shadow and ID layers", "round-trip"),
].map((entry) => [entry.id, entry])) as Record<SpatialOperationId, SpatialOperation>);

const PAINT = new Set<Tool>(["brush", "capture-brush", "pencil", "mixer", "erase", "clone", "heal", "spot-heal", "patch", "remove", "dodge", "burn", "blur-brush", "sharpen-brush", "smudge", "sponge", "liquify"]);
const SELECTION = new Set<Tool>(["sel-rect", "sel-ellipse", "sel-lasso", "sel-polygon", "sel-magnetic", "sel-quick", "sel-wand", "sel-sam", "mask-add", "mask-remove", "type-mask"]);
const TYPE = new Set<Tool>(["text", "paragraph-text", "vertical-text", "path-text"]);
const VECTOR = new Set<Tool>(["rect", "ellipse", "triangle", "polygon", "line", "custom-shape", "frame", "pen", "path-select", "direct-select"]);
const TRANSFORM = new Set<Tool>(["move", "crop", "perspective-crop", "straighten", "content-move", "perspective-warp", "radial-warp"]);
const MATERIAL = new Set<Tool>(["gradient", "pattern", "fill"]);
const MEASURE = new Set<Tool>(["eyedropper", "color-sampler", "ruler"]);

export function spatialOperationIdsForTool(tool: Tool): readonly SpatialOperationId[] {
  if (TYPE.has(tool)) return ["extrude", "bevel", "surface-wrap", "decal-project", "mesh-deform", "animate", "multipass-render"];
  if (VECTOR.has(tool)) return ["extrude", "bevel", "sweep", "revolve", "surface-wrap", "decal-project", "multipass-render"];
  if (SELECTION.has(tool)) return ["depth-mask", "volume-mask", "occlusion", "object-id", "multipass-render"];
  if (PAINT.has(tool)) return ["surface-paint", "material-paint", "normal-paint", "displacement", "physics-scatter"];
  if (MATERIAL.has(tool)) return ["material-paint", "displacement", "environment-light", "decal-project"];
  if (TRANSFORM.has(tool)) return ["depth-transform", "camera-match", "surface-wrap", "mesh-deform", "occlusion"];
  if (MEASURE.has(tool)) return ["sample-material", "measure-scene", "camera-match", "depth-mask"];
  if (tool === "tone") return ["relight", "environment-light", "shadow-catcher", "reflection-catcher", "multipass-render"];
  return ["depth-transform", "multipass-render"];
}

export function spatialOperationsForTool(tool: Tool) {
  return spatialOperationIdsForTool(tool).map((id) => SPATIAL_OPERATION_REGISTRY[id]);
}

export function spatialSourceKindForLayer(layer: Layer | null | undefined) {
  if (!layer) return "canvas" as const;
  if (layer.kind === "text") return "typography" as const;
  if (layer.kind === "shape" || layer.kind === "path") return "vector" as const;
  if (layer.kind === "raster" || layer.kind === "smart-object") return "image" as const;
  if (layer.kind === "group") return "scene-group" as const;
  return "adjustment" as const;
}

export const SPATIAL_TOOL_CAPABILITY_MATRIX = Object.freeze(Object.fromEntries(
  ALL_TOOL_IDS.map((id) => [id, {
    tool: toolDefinition(id),
    operations: spatialOperationIdsForTool(id),
  }]),
));
