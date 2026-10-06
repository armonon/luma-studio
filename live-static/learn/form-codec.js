// ../../sculptor-studio/app/render-shot.ts
var SHOT_LIMITS = { count: 8, bytes: 32 * 1024 * 1024 };
function validateRenderQueue(value, purpose = "render") {
  const native = purpose === "render";
  const fail = () => {
    throw Error("Invalid or oversized render shot snapshot");
  };
  if (!Array.isArray(value) || value.length > SHOT_LIMITS.count) return fail();
  const vector = (v, n) => Array.isArray(v) && (n === void 0 || v.length === n) && v.length <= 75e4 && v.every((x) => typeof x === "number" && Number.isFinite(native ? Math.fround(x) : x));
  const vec3 = (v) => vector(v, 3) && (!native || v.every((x) => Math.abs(x) <= 1e8));
  const f = Math.fround;
  const nonzero = (v) => f(f(f(v[0] * v[0]) + f(v[1] * v[1])) + f(v[2] * v[2])) > f(1e-10);
  const cross = (a, b) => [f(f(a[1] * b[2]) - f(a[2] * b[1])), f(f(a[2] * b[0]) - f(a[0] * b[2])), f(f(a[0] * b[1]) - f(a[1] * b[0]))];
  const scalar = (v, min, max) => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
  const string = (v, max = 256) => typeof v === "string" && v.length > 0 && v.length <= max;
  const record = (v) => !!v && typeof v === "object" && !Array.isArray(v);
  const ids = /* @__PURE__ */ new Set();
  for (const s of value) {
    if (!record(s) || s.schema !== "form-render-shot@1" || !string(s.id) || !string(s.name, 128) || ids.has(s.id) || !string(s.createdAt) || !Number.isFinite(Date.parse(s.createdAt)) || !["queued", "rendering", "complete", "cancelled", "failed"].includes(String(s.status)) || !["Fast", "Studio", "Final"].includes(String(s.quality)) || !scalar(s.timeSeconds, 0, 86400) || !(s.focalLengthMm === null || scalar(s.focalLengthMm, 0.01, 1e5)) || s.error !== void 0 && !string(s.error, 2e3)) return fail();
    ids.add(s.id);
    const p = s.settings, scene = s.scene;
    if (!record(p) || !record(scene)) return fail();
    if (![p.width, p.height].every((n) => Number.isInteger(n) && scalar(n, 128, 1024)) || !Number.isInteger(p.samples) || !scalar(p.samples, 1, 128) || !Number.isInteger(p.maxBounces) || !scalar(p.maxBounces, 1, 8) || !Number.isInteger(p.seed) || !scalar(p.seed, 0, 4294967295) || typeof p.denoise !== "boolean") return fail();
    const positions = scene.positions;
    if (!vector(positions) || !positions.length || native && (positions.length < 9 || positions.length > 45e4) || positions.length % 3 || !vector(scene.indices) || !scene.indices.length || scene.indices.length % 3 || scene.indices.length > 15e4 || scene.indices.some((i) => !Number.isInteger(i) || i < 0 || i >= positions.length / 3) || !vector(scene.normals, positions.length) || !vector(scene.uvs, positions.length / 3 * 2) || !vector(scene.materialIds, scene.indices.length / 3)) return fail();
    const materials = scene.materials, textures = scene.textures, lights = scene.lights;
    if (!Array.isArray(materials) || !materials.length || materials.length > (native ? 1024 : 5e4) || !Array.isArray(textures) || textures.length > (native ? 64 : 128) || !Array.isArray(lights) || lights.length > (native ? 64 : 1024) || !Array.isArray(scene.warnings) || scene.warnings.length > 256 || scene.warnings.some((w) => !string(w, 2e3))) return fail();
    const textureIndex = (n) => Number.isInteger(n) && scalar(n, -1, textures.length - 1);
    for (const m of materials) {
      if (!record(m) || !vec3(m.color) || !vec3(m.emission) || !vec3(m.sheenColor) || !vector(m.transform, 9) || !vector(m.wrap, 2) || m.wrap.some((n) => ![0, 1, 2].includes(n)) || typeof m.flipY !== "boolean" || !textureIndex(m.texture) || !scalar(m.ior, 1, native ? 3 : 5) || ![m.roughness, m.metalness, m.transmission, m.opacity, m.alphaTest, m.clearcoat, m.clearcoatRoughness, m.sheen, m.sheenRoughness].every((n) => scalar(n, 0, 1))) return fail();
    }
    if (scene.materialIds.some((i) => !Number.isInteger(i) || i < 0 || i >= materials.length)) return fail();
    let totalPixels = 0;
    for (const t of textures) {
      if (!record(t) || !Number.isInteger(t.width) || !Number.isInteger(t.height) || !scalar(t.width, 1, 4096) || !scalar(t.height, 1, 4096)) return fail();
      const pixels = t.width * t.height;
      totalPixels += pixels;
      if (pixels > 187500 || totalPixels > 1e6 || !vector(t.pixels, pixels * 4) || native && t.pixels.some((v) => v < 0)) return fail();
    }
    for (const l of lights) {
      if (!record(l) || !(native ? [0, 1, 2, 3] : [0, 1, 2, 3, 4]).includes(l.kind) || !vec3(l.position) || !vec3(l.direction) || !vec3(l.color) || !vector(l.size, 2) || !vec3(l.tangent) || !vector(l.cone, 2) || native && !nonzero(l.direction.map(f))) return fail();
      if (native && l.kind === 3 && (l.size.some((v) => v <= 0) || !nonzero(cross(l.direction.map(f), l.tangent.map(f))))) return fail();
    }
    const c = scene.camera, e = scene.environment;
    if (!record(c) || !vec3(c.position) || !vec3(c.target) || !vec3(c.up) || !scalar(c.fov, native ? 1 : 0.01, 179) || native && f(c.fov) >= 179 || !scalar(c.aspect, 0.125, 8) || !scalar(c.orthoHeight, 0, native ? 1e8 : 1e12) || !record(e) || !vec3(e.horizon) || !vec3(e.zenith) || !scalar(e.intensity, 0, 1e12) || !scalar(e.textureIntensity, 0, 1e12) || !textureIndex(e.texture) || !vec3(scene.background) || !scalar(scene.exposure, 0, native ? 100 : 1e12)) return fail();
    const forward = c.target.map((v, i) => f(f(v) - f(c.position[i])));
    if (native && (!nonzero(forward) || !nonzero(cross(forward, c.up.map(f))))) return fail();
  }
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > SHOT_LIMITS.bytes) fail();
}

// ../../sculptor-studio/app/project-format.ts
var FORM_PROJECT_KIND = "form-studio-project";
var FORM_PROJECT_VERSION = 2;
var FORM_SCENE_WORKSPACE_SCHEMA = "form-studio/scene@1";
var FORM_PROJECT_LIMITS = {
  bytes: 64 * 1024 * 1024,
  nestingDepth: 64,
  collectionItems: 75e4,
  workspaces: 32,
  objectIdsPerWorkspace: 5e5,
  relationships: 5e5,
  assets: 1e5,
  stringLength: 16 * 1024 * 1024
};
var FORM_Y_UP_COORDINATES = {
  units: "mm",
  upAxis: "Y",
  handedness: "right",
  toCommonAxes: ["+X", "+Y", "+Z"]
};
var isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
var validVector = (value) => Array.isArray(value) && value.length === 3 && value.every((entry) => typeof entry === "number" && Number.isFinite(entry));
var dangerousKeys = /* @__PURE__ */ new Set(["__proto__", "prototype", "constructor"]);
function assertSafeTree(value, path = "project", depth = 0, counter = { value: 0 }) {
  if (depth > FORM_PROJECT_LIMITS.nestingDepth) throw new Error(`${path} exceeds the supported nesting depth.`);
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error(`${path} contains a non-finite number.`);
  if (typeof value === "string" && value.length > FORM_PROJECT_LIMITS.stringLength) throw new Error(`${path} contains an oversized string.`);
  if (Array.isArray(value)) {
    counter.value += value.length;
    if (counter.value > FORM_PROJECT_LIMITS.collectionItems) throw new Error("The project contains too many collection items.");
    value.forEach((item, index) => assertSafeTree(item, `${path}[${index}]`, depth + 1, counter));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, item] of Object.entries(value)) {
    if (dangerousKeys.has(key)) throw new Error(`${path} contains an unsafe key.`);
    assertSafeTree(item, `${path}.${key}`, depth + 1, counter);
  }
}
function hashText(source) {
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).padStart(7, "0");
}
function stableId(prefix, value) {
  return `${prefix}-${hashText(JSON.stringify(value))}`;
}
function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort((first, second) => first.localeCompare(second)).map((key) => [key, stableValue(value[key])]));
}
function rotateLeft(value, bits) {
  return (value << bits | value >>> 32 - bits) >>> 0;
}
function avalanche(value) {
  let mixed = value >>> 0;
  mixed ^= mixed >>> 16;
  mixed = Math.imul(mixed, 2246822507);
  mixed ^= mixed >>> 13;
  mixed = Math.imul(mixed, 3266489909);
  mixed ^= mixed >>> 16;
  return mixed >>> 0;
}
function formProjectChecksum(value) {
  const root = isRecord(value) ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== "checksum")) : value;
  const source = JSON.stringify(stableValue(root));
  let lane0 = 2166136261;
  let lane1 = 2654435761;
  let lane2 = 3266489917;
  let lane3 = 1103515245;
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    lane0 = rotateLeft(Math.imul((lane0 ^ code) >>> 0, 16777619) >>> 0, 5);
    lane1 = rotateLeft(Math.imul((lane1 ^ code) >>> 0, 2246822519) >>> 0, 11);
    lane2 = rotateLeft(Math.imul((lane2 ^ code) >>> 0, 374761393) >>> 0, 17);
    lane3 = rotateLeft(Math.imul((lane3 ^ code) >>> 0, 668265263) >>> 0, 23);
  }
  const lanes = [lane0, lane1, lane2, lane3];
  const mixed = lanes.map((lane, index) => avalanche((lane ^ source.length ^ rotateLeft(lanes[(index + 1) % lanes.length], 7)) >>> 0));
  return `fnv1a128-${mixed.map((lane) => lane.toString(16).padStart(8, "0")).join("")}`;
}
function uniqueObjectIds(value, workspace) {
  const ids = [];
  const seen = /* @__PURE__ */ new Set();
  value.forEach((item) => {
    if (!isRecord(item) || typeof item.id !== "string" || item.id.length === 0 || seen.has(item.id)) return;
    seen.add(item.id);
    ids.push(item.id);
  });
  if (ids.length > FORM_PROJECT_LIMITS.objectIdsPerWorkspace) throw new Error(`${workspace} contains too many object ids.`);
  return ids;
}
function validateSceneWorkspace(value) {
  if (!isRecord(value) || !Array.isArray(value.scene)) throw new Error("The project has no readable scene workspace.");
  if (!isRecord(value.workspace) || !isRecord(value.camera)) throw new Error("The scene workspace data is incomplete.");
  if (!validVector(value.camera.position) || !validVector(value.camera.target)) throw new Error("The project camera data is invalid.");
  const qualityMode = value.workspace.qualityMode;
  if (qualityMode !== "Fast" && qualityMode !== "Studio" && qualityMode !== "Final") throw new Error("The project renderer setting is invalid.");
  if (!Array.isArray(value.cameraShots) || !Array.isArray(value.groups)) throw new Error("The scene collections are invalid.");
  if (value.renderQueue !== void 0) validateRenderQueue(value.renderQueue, "storage");
}
function validateWorkspaceRecord(name, value) {
  if (!isRecord(value) || typeof value.schema !== "string" || value.schema.length === 0 || value.schema.length > 160) throw new Error(`The ${name} workspace schema is invalid.`);
  if (typeof value.updatedAt !== "number" || !Number.isFinite(value.updatedAt) || value.updatedAt < 0) throw new Error(`The ${name} workspace timestamp is invalid.`);
  if (!Array.isArray(value.objectIds) || value.objectIds.length > FORM_PROJECT_LIMITS.objectIdsPerWorkspace) throw new Error(`The ${name} object index is invalid.`);
  if (!isRecord(value.coordinateSystem) || value.coordinateSystem.units !== "mm" || !["Y", "Z"].includes(String(value.coordinateSystem.upAxis)) || value.coordinateSystem.handedness !== "right" || !Array.isArray(value.coordinateSystem.toCommonAxes) || value.coordinateSystem.toCommonAxes.length !== 3 || value.coordinateSystem.toCommonAxes.some((axis) => !/^[+-][XYZ]$/.test(String(axis))) || new Set(value.coordinateSystem.toCommonAxes.map((axis) => String(axis).slice(1))).size !== 3) throw new Error(`The ${name} coordinate system is invalid.`);
  const seen = /* @__PURE__ */ new Set();
  for (const id of value.objectIds) {
    if (typeof id !== "string" || id.length === 0 || id.length > 256 || seen.has(id)) throw new Error(`The ${name} object index contains invalid or duplicate ids.`);
    seen.add(id);
  }
  if (!("data" in value)) throw new Error(`The ${name} workspace has no data.`);
  if (name === "scene") validateSceneWorkspace(value.data);
}
function validateProject(value) {
  if (!isRecord(value) || value.kind !== FORM_PROJECT_KIND) throw new Error("This is not a Form Studio project.");
  if (value.version !== FORM_PROJECT_VERSION) throw new Error(`Project version ${String(value.version)} is not supported.`);
  if (typeof value.projectId !== "string" || value.projectId.length === 0 || value.projectId.length > 160) throw new Error("The project identity is invalid.");
  if (typeof value.revisionId !== "string" || value.revisionId.length === 0 || value.revisionId.length > 200) throw new Error("The project revision identity is invalid.");
  if (typeof value.name !== "string" || typeof value.createdAt !== "number" || typeof value.updatedAt !== "number" || !Number.isFinite(value.createdAt) || !Number.isFinite(value.updatedAt)) throw new Error("The project metadata is invalid.");
  if (!isRecord(value.common) || value.common.canonicalUnits !== "mm" || value.common.upAxis !== "Y" || value.common.handedness !== "right" || !["mm", "cm", "m", "in", "ft"].includes(String(value.common.displayUnits))) throw new Error("The common project coordinate system is invalid.");
  if (!isRecord(value.workspaces)) throw new Error("The project workspace index is missing.");
  const workspaceIndex = value.workspaces;
  const workspaceEntries = Object.entries(workspaceIndex);
  if (workspaceEntries.length > FORM_PROJECT_LIMITS.workspaces) throw new Error("The project contains too many workspaces.");
  workspaceEntries.forEach(([name, workspace]) => validateWorkspaceRecord(name, workspace));
  if (!Array.isArray(value.relationships) || value.relationships.length > FORM_PROJECT_LIMITS.relationships) throw new Error("The project relationship graph is invalid.");
  const relationshipIds = /* @__PURE__ */ new Set();
  value.relationships.forEach((relationship, index) => {
    if (!isRecord(relationship) || typeof relationship.id !== "string" || typeof relationship.kind !== "string" || !isRecord(relationship.source) || !isRecord(relationship.target)) throw new Error(`Project relationship ${index + 1} is invalid.`);
    if (relationship.id.length === 0 || relationship.id.length > 256 || relationshipIds.has(relationship.id)) throw new Error(`Project relationship ${index + 1} has an invalid or duplicate id.`);
    relationshipIds.add(relationship.id);
    for (const endpoint of [relationship.source, relationship.target]) {
      const workspace = typeof endpoint.workspace === "string" ? workspaceIndex[endpoint.workspace] : void 0;
      if (!isRecord(workspace) || !Array.isArray(workspace.objectIds) || typeof endpoint.objectId !== "string" || !workspace.objectIds.includes(endpoint.objectId)) throw new Error(`Project relationship ${relationship.id} has an invalid endpoint.`);
    }
  });
  if (!Array.isArray(value.assets) || value.assets.length > FORM_PROJECT_LIMITS.assets) throw new Error("The project asset index is invalid.");
  const assetIds = /* @__PURE__ */ new Set();
  value.assets.forEach((asset, index) => {
    if (!isRecord(asset) || typeof asset.id !== "string" || typeof asset.name !== "string" || typeof asset.mediaType !== "string") throw new Error(`Project asset ${index + 1} is invalid.`);
    if (asset.id.length === 0 || asset.id.length > 256 || assetIds.has(asset.id)) throw new Error(`Project asset ${index + 1} has an invalid or duplicate id.`);
    assetIds.add(asset.id);
  });
  if (value.checksum !== void 0 && (typeof value.checksum !== "string" || !/^fnv1a128-[0-9a-f]{32}$/.test(value.checksum))) throw new Error("The project integrity seal is invalid.");
}
function cleanProjectName(value) {
  const cleaned = value.replace(/\.form$/i, "").replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned.slice(0, 80) || "Untitled scene";
}
function formWorkspace(project, workspace) {
  return project.workspaces[workspace];
}
var LEGACY_PROJECT_KEYS = /* @__PURE__ */ new Set(["kind", "version", "name", "createdAt", "updatedAt", "scene", "workspace", "camera", "cameraShots", "groups"]);
function migrateLegacyProject(value) {
  const sceneData = { scene: value.scene, workspace: value.workspace, camera: value.camera, cameraShots: value.cameraShots ?? [], groups: value.groups ?? [] };
  validateSceneWorkspace(sceneData);
  const createdAt = typeof value.createdAt === "number" && Number.isFinite(value.createdAt) ? value.createdAt : 0;
  const updatedAt = typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt) ? value.updatedAt : createdAt;
  const name = cleanProjectName(typeof value.name === "string" ? value.name : "Untitled scene");
  const projectId = stableId("project", { name, createdAt });
  const unknownEntries = Object.entries(value).filter(([key]) => !LEGACY_PROJECT_KEYS.has(key));
  return {
    kind: FORM_PROJECT_KIND,
    version: FORM_PROJECT_VERSION,
    projectId,
    revisionId: stableId("revision", value),
    name,
    createdAt,
    updatedAt,
    common: { canonicalUnits: "mm", displayUnits: "mm", upAxis: "Y", handedness: "right" },
    workspaces: { scene: { schema: FORM_SCENE_WORKSPACE_SCHEMA, updatedAt, coordinateSystem: FORM_Y_UP_COORDINATES, objectIds: uniqueObjectIds(sceneData.scene, "scene"), data: sceneData } },
    relationships: [],
    assets: [],
    ...unknownEntries.length ? { extensions: { legacyRoot: Object.fromEntries(unknownEntries) } } : {}
  };
}
function parseProjectWithMigration(input) {
  if (new TextEncoder().encode(input).byteLength > FORM_PROJECT_LIMITS.bytes) throw new Error("The project exceeds the supported file size.");
  let value;
  try {
    value = JSON.parse(input);
  } catch {
    throw new Error("This file is not valid JSON.");
  }
  assertSafeTree(value);
  if (!isRecord(value) || value.kind !== FORM_PROJECT_KIND) throw new Error("This is not a Form Studio project.");
  if (value.version === 1) {
    const project = migrateLegacyProject(value);
    validateProject(project);
    return { project, backup: { source: input, sourceVersion: 1, targetVersion: FORM_PROJECT_VERSION, reason: "schema-migration" } };
  }
  if (value.version !== FORM_PROJECT_VERSION) throw new Error(`Project version ${String(value.version)} is not supported.`);
  validateProject(value);
  if (typeof value.checksum === "string" && value.checksum !== formProjectChecksum(value)) throw new Error("Project integrity check failed.");
  return { project: value, backup: null };
}
function parseProject(input) {
  return parseProjectWithMigration(input).project;
}

// ../../sculptor-studio/app/cad-drafting.ts
function createCadDraftingDocument() {
  return {
    schema: "form-studio-drafting-v1",
    texts: [],
    dimensions: [],
    leaders: [],
    hatches: [],
    blockDefinitions: [],
    blockInstances: [],
    layouts: [{ id: "model", name: "Model", paperWidthMm: 420, paperHeightMm: 297, marginMm: 5, scale: "1:1", orientation: "landscape", modelSpace: true }],
    activeLayoutId: "model"
  };
}
var finitePoint = (point) => Boolean(point && Number.isFinite(point.x) && Number.isFinite(point.y) && Math.abs(point.x) <= 1e9 && Math.abs(point.y) <= 1e9);
function validateCadDraftingDocument(document) {
  const errors = [];
  if (document.schema !== "form-studio-drafting-v1") errors.push("Unsupported drafting schema");
  const collections = [document.texts, document.dimensions, document.leaders, document.hatches, document.blockDefinitions, document.blockInstances, document.layouts];
  const objects = collections.flat();
  if (objects.length > 25e4) errors.push("Drafting document exceeds the 250,000-object limit");
  const ids = /* @__PURE__ */ new Set();
  objects.forEach((object) => {
    if (!object.id || object.id.length > 200) errors.push("Drafting object has an invalid id");
    else if (ids.has(object.id)) errors.push(`Duplicate drafting object id: ${object.id}`);
    ids.add(object.id);
  });
  document.texts.forEach((text) => {
    if (!finitePoint(text.position) || !Number.isFinite(text.height) || text.height <= 0 || text.height > 1e6) errors.push(`${text.id} has invalid text geometry`);
    if (!text.text.trim() || text.text.length > 16384) errors.push(`${text.id} has invalid text content`);
  });
  document.dimensions.forEach((dimension) => {
    if (!finitePoint(dimension.definitionPoint) || dimension.extensionStart && !finitePoint(dimension.extensionStart) || dimension.extensionEnd && !finitePoint(dimension.extensionEnd)) errors.push(`${dimension.id} has invalid dimension geometry`);
    if (dimension.measurement !== void 0 && !Number.isFinite(dimension.measurement) || dimension.textPosition && !finitePoint(dimension.textPosition)) errors.push(`${dimension.id} has invalid dimension value or text position`);
  });
  document.leaders.forEach((leader) => {
    if (leader.vertices.length < 2 || leader.vertices.some((point) => !finitePoint(point))) errors.push(`${leader.id} has invalid leader geometry`);
  });
  document.hatches.forEach((hatch) => {
    if (!hatch.boundaries.length || hatch.boundaries.some((boundary) => boundary.length < 2 || boundary.some((point) => !finitePoint(point)))) errors.push(`${hatch.id} has invalid hatch boundaries`);
  });
  const definitionIds = new Set(document.blockDefinitions.map((definition) => definition.id));
  document.blockInstances.forEach((instance) => {
    if (!definitionIds.has(instance.definitionId)) errors.push(`${instance.id} references a missing block definition`);
    if (!finitePoint(instance.position) || !finitePoint(instance.scale) || instance.scale.x === 0 || instance.scale.y === 0) errors.push(`${instance.id} has invalid block transform`);
    if (!Number.isFinite(instance.rotation) || !Number.isFinite(instance.columnSpacing) || !Number.isFinite(instance.rowSpacing) || !Number.isInteger(instance.columns) || !Number.isInteger(instance.rows) || instance.columns < 1 || instance.rows < 1 || instance.columns * instance.rows > 25e4) errors.push(`${instance.id} has invalid block array`);
  });
  document.layouts.forEach((layout) => {
    if (!layout.name.trim() || !Number.isFinite(layout.paperWidthMm) || !Number.isFinite(layout.paperHeightMm) || layout.paperWidthMm <= 0 || layout.paperHeightMm <= 0) errors.push(`${layout.id} has invalid paper-space settings`);
    if (!/^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/.test(layout.scale) || layout.scale.split(":").some((v) => !Number.isFinite(Number(v)) || Number(v) <= 0)) errors.push(`${layout.id} has invalid plot scale`);
    if (!Number.isFinite(layout.marginMm) || layout.marginMm < 0 || layout.marginMm * 2 >= Math.min(layout.paperWidthMm, layout.paperHeightMm)) errors.push(`${layout.id} has invalid print margins`);
  });
  if (!document.layouts.some((layout) => layout.id === document.activeLayoutId)) errors.push("Active paper-space layout is missing");
  return { valid: errors.length === 0, errors, objectCount: objects.length };
}

// ../../sculptor-studio/app/cad-sheet-layout.ts
var SHEET_VIEWS = ["Front", "Top", "Right", "Iso", "Section A-A"];
function createSheetLayout(id = "production", title = "Production drawing") {
  return {
    id,
    title,
    paper: "A3",
    orientation: "landscape",
    template: "engineering",
    author: "Form Studio",
    drawingNumber: "",
    views: { Front: { x: 90, y: 155, visible: true }, Top: { x: 90, y: 65, visible: true }, Right: { x: 230, y: 155, visible: true }, Iso: { x: 230, y: 65, visible: true }, "Section A-A": { x: 350, y: 110, visible: true } },
    annotations: []
  };
}
function createDrawingBook() {
  return { schema: "form-drawing-book-v1", sheets: [createSheetLayout()] };
}
function validateDrawingBook(value) {
  const book = value;
  if (!book || book.schema !== "form-drawing-book-v1" || !Array.isArray(book.sheets) || !book.sheets.length || book.sheets.length > 100) throw new Error("Invalid drawing book");
  const ids = /* @__PURE__ */ new Set();
  const text = (v, max = 200) => typeof v === "string" && v.length <= max;
  const coordinate = (v) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 1e4;
  for (const sheet of book.sheets) {
    if (!sheet || !text(sheet.id) || !sheet.id || ids.has(sheet.id) || !text(sheet.title) || !text(sheet.author) || !text(sheet.drawingNumber) || !["A4", "A3", "A2", "Letter"].includes(sheet.paper) || !["landscape", "portrait"].includes(sheet.orientation) || !["engineering", "minimal"].includes(sheet.template) || !sheet.views || !Array.isArray(sheet.annotations) || sheet.annotations.length > 1e3) throw new Error("Invalid drawing sheet");
    ids.add(sheet.id);
    if (sheet.scale !== void 0 && (typeof sheet.scale !== "string" || drawingRatio(sheet.scale) === null)) throw new Error("Invalid sheet scale");
    if (sheet.syncDrafting !== void 0 && typeof sheet.syncDrafting !== "boolean") throw new Error("Invalid annotation sync setting");
    if (sheet.source !== void 0 && (!sheet.source || !["bim-plan", "bim-section", "fabric", "sketch", "mesh"].includes(sheet.source.kind) || !text(sheet.source.id) || !sheet.source.id || sheet.id === "production" || sheet.source.itemId !== void 0 && (!text(sheet.source.itemId) || !sheet.source.itemId))) throw new Error("Invalid sheet source");
    for (const name of SHEET_VIEWS) {
      const p = sheet.views[name];
      if (!p || !coordinate(p.x) || !coordinate(p.y) || typeof p.visible !== "boolean") throw new Error("Invalid drawing view placement");
    }
    const annotations = /* @__PURE__ */ new Set();
    for (const a of sheet.annotations) {
      if (!a || !text(a.id) || !a.id || annotations.has(a.id) || !SHEET_VIEWS.includes(a.view) || !coordinate(a.x) || !coordinate(a.y) || !["note", "width", "height", "depth", "edge", "angle", "radius", "diameter"].includes(a.kind) || !text(a.text, 1e3)) throw new Error("Invalid sheet annotation");
      if (["edge", "angle", "radius", "diameter"].includes(a.kind) && (!Array.isArray(a.edgeIds) || a.edgeIds.length !== (a.kind === "angle" ? 2 : 1) || a.edgeIds.some((id) => !text(id, 500) || !id) || new Set(a.edgeIds).size !== a.edgeIds.length)) throw new Error("Invalid dimension references");
      annotations.add(a.id);
    }
  }
  if (!ids.has("production")) throw new Error("Drawing book must retain the production sheet");
}
function drawingRatio(scale) {
  if (!/^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/.test(scale.trim())) return null;
  const [a, b] = scale.split(":").map(Number);
  return a > 0 && b > 0 && Number.isFinite(a / b) && a / b >= 1e-6 && a / b <= 1e3 ? a / b : null;
}

// ../../sculptor-studio/app/cad-project.ts
var CURRENT_PROJECT_VERSION = 17;
var OLDEST_PROJECT_VERSION = 1;
var CAD_PROJECT_LIMITS = {
  bytes: 48 * 1024 * 1024,
  entities: 25e4,
  features: 25e4,
  collectionItems: 5e5,
  nestingDepth: 48,
  stringLength: 16 * 1024 * 1024
};
var dangerousKeys2 = /* @__PURE__ */ new Set(["__proto__", "prototype", "constructor"]);
function assertSafeTree2(value, path = "project", depth = 0, counter = { value: 0 }) {
  if (depth > CAD_PROJECT_LIMITS.nestingDepth) throw new Error(`${path} exceeds the supported nesting depth`);
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error(`${path} contains a non-finite number`);
  if (typeof value === "string" && value.length > CAD_PROJECT_LIMITS.stringLength) throw new Error(`${path} contains an oversized string`);
  if (Array.isArray(value)) {
    counter.value += value.length;
    if (counter.value > CAD_PROJECT_LIMITS.collectionItems) throw new Error("Project contains too many collection items");
    value.forEach((item, index) => assertSafeTree2(item, `${path}[${index}]`, depth + 1, counter));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (dangerousKeys2.has(key)) throw new Error(`${path} contains an unsafe key`);
      assertSafeTree2(item, `${path}.${key}`, depth + 1, counter);
    }
  }
}
function validPoint(value) {
  if (!value || typeof value !== "object") return false;
  const point = value;
  return typeof point.x === "number" && Number.isFinite(point.x) && typeof point.y === "number" && Number.isFinite(point.y);
}
function validateCadModel(parsed) {
  const entities = parsed.entities;
  const features = parsed.features;
  if (entities.length > CAD_PROJECT_LIMITS.entities) throw new Error("Project contains too many CAD entities");
  if (features.length > CAD_PROJECT_LIMITS.features) throw new Error("Project contains too many CAD features");
  const ids = /* @__PURE__ */ new Set();
  entities.forEach((value, index) => {
    if (!value || typeof value !== "object") throw new Error(`Entity ${index + 1} is invalid`);
    const entity = value;
    if (typeof entity.id !== "string" || entity.id.length === 0 || entity.id.length > 200) throw new Error(`Entity ${index + 1} has an invalid id`);
    if (ids.has(entity.id)) throw new Error(`Duplicate entity id: ${entity.id}`);
    ids.add(entity.id);
    if (!(/* @__PURE__ */ new Set(["line", "rectangle", "circle"])).has(String(entity.type))) throw new Error(`Entity ${entity.id} has an unsupported type`);
    if (!validPoint(entity.a) || !validPoint(entity.b)) throw new Error(`Entity ${entity.id} has invalid geometry`);
    if (entity.rotation !== void 0 && (typeof entity.rotation !== "number" || !Number.isFinite(entity.rotation))) throw new Error(`Entity ${entity.id} has an invalid rotation`);
    if (entity.strokeStyle !== void 0 && entity.strokeStyle !== "pen" && entity.strokeStyle !== "pencil") throw new Error(`Entity ${entity.id} has an invalid stroke style`);
    if (entity.strokeWidth !== void 0 && (typeof entity.strokeWidth !== "number" || !Number.isFinite(entity.strokeWidth) || entity.strokeWidth <= 0 || entity.strokeWidth > 64)) throw new Error(`Entity ${entity.id} has an invalid stroke width`);
    if (entity.strokeOpacity !== void 0 && (typeof entity.strokeOpacity !== "number" || !Number.isFinite(entity.strokeOpacity) || entity.strokeOpacity < 0 || entity.strokeOpacity > 1)) throw new Error(`Entity ${entity.id} has an invalid stroke opacity`);
  });
  const featureIds = /* @__PURE__ */ new Set();
  features.forEach((value, index) => {
    if (!value || typeof value !== "object") throw new Error(`Feature ${index + 1} is invalid`);
    const item = value;
    if (typeof item.id !== "string" || item.id.length === 0 || item.id.length > 200) throw new Error(`Feature ${index + 1} has an invalid id`);
    if (featureIds.has(item.id)) throw new Error(`Duplicate feature id: ${item.id}`);
    featureIds.add(item.id);
    if (typeof item.type !== "string" || item.type.length === 0 || item.type.length > 80) throw new Error(`Feature ${item.id} has an invalid type`);
    if (typeof item.value !== "number" || !Number.isFinite(item.value)) throw new Error(`Feature ${item.id} has an invalid value`);
    const sources = Array.isArray(item.sourceEntityIds) ? item.sourceEntityIds : item.sourceEntityId ? [item.sourceEntityId] : [];
    if (sources.some((source) => typeof source !== "string" || source.length > 200)) throw new Error(`Feature ${item.id} has invalid references`);
  });
}
var withVersion = (version, migrate) => (project) => ({
  ...migrate(project),
  version
});
var CAD_PROJECT_MIGRATIONS = {
  1: withVersion(2, (project) => ({
    canonicalUnits: "mm",
    displayUnits: project.displayUnits ?? project.units ?? "mm",
    ...project
  })),
  2: withVersion(3, (project) => ({ layers: [], geometricConstraints: [], ...project })),
  3: withVersion(4, (project) => ({ parameters: [], gdt: [], ...project })),
  4: withVersion(5, (project) => ({ components: [], assemblyInstances: [], ...project })),
  5: withVersion(6, (project) => ({ assemblyMates: [], linkedGroups: [], importedBodies: [], ...project })),
  6: withVersion(7, (project) => ({ configurations: [], activeConfigurationId: null, ...project })),
  7: withVersion(8, (project) => ({ bimNodes: [], recipeGraphs: [], revisions: [], marketplace: [], ...project })),
  8: withVersion(9, (project) => ({ sketchPlanes: [], rollbackIndex: project.features.length, ...project })),
  9: withVersion(10, (project) => ({
    material: "Aluminum 6061",
    density: 2.7,
    drawingScale: "1:1",
    drawingRevision: "A",
    ...project
  })),
  10: withVersion(11, (project) => ({ kernel: "Open CASCADE B-Rep", ...project })),
  11: withVersion(12, (project) => ({
    appearance: {
      preset: "layer",
      baseColor: "#d7ff78",
      useLayerColor: true,
      metalness: 0.12,
      roughness: 0.48,
      clearcoat: 0.12,
      clearcoatRoughness: 0.35,
      transmission: 0,
      opacity: 1,
      environment: "studio",
      exposure: 1,
      groundShadow: true
    },
    ...project
  })),
  12: withVersion(13, (project) => ({ volumes: [], ...project })),
  13: withVersion(14, (project) => ({ drafting: createCadDraftingDocument(), ...project })),
  14: withVersion(15, (project) => ({ drawingBook: createDrawingBook(), ...project })),
  15: withVersion(16, (project) => ({ ...project })),
  16: withVersion(17, (project) => ({ ...project }))
};
function migrateCadProject(project) {
  if (project.version !== void 0 && typeof project.version !== "number") {
    throw new Error("CAD project has an invalid version");
  }
  const sourceVersion = project.version === void 0 ? OLDEST_PROJECT_VERSION : project.version;
  if (!Number.isSafeInteger(sourceVersion) || sourceVersion < OLDEST_PROJECT_VERSION) {
    throw new Error("CAD project has an invalid version");
  }
  if (sourceVersion > CURRENT_PROJECT_VERSION) {
    throw new Error("This project was created by a newer Form Studio version");
  }
  let migrated = { ...project, version: sourceVersion };
  for (let version = sourceVersion; version < CURRENT_PROJECT_VERSION; version += 1) {
    const migrate = CAD_PROJECT_MIGRATIONS[version];
    if (!migrate) throw new Error(`No migration is available for CAD project version ${version}`);
    migrated = migrate(migrated);
  }
  return migrated;
}
function stableValue2(value, keyShapes = /* @__PURE__ */ new Map()) {
  if (Array.isArray(value)) return value.map((item) => stableValue2(item, keyShapes));
  if (value && typeof value === "object") {
    const source = value;
    const input = Object.keys(source).filter((key) => key !== "checksum");
    const signature = `${input.length}:${input.join("")}`;
    const cached = keyShapes.get(signature);
    const sameShape = cached?.input.length === input.length && input.every((key, index) => key === cached.input[index]);
    const sorted = sameShape ? cached.sorted : [...input].sort((a, b) => a.localeCompare(b));
    if (!sameShape) keyShapes.set(signature, { input, sorted });
    return Object.fromEntries(sorted.map((key) => [key, stableValue2(source[key], keyShapes)]));
  }
  return value;
}
var CHECKSUM_LANES = [
  { seed: 2166136261, prime: 16777619, rotate: 5 },
  { seed: 2654435761, prime: 2246822519, rotate: 11 },
  { seed: 3266489917, prime: 374761393, rotate: 17 },
  { seed: 1103515245, prime: 668265263, rotate: 23 }
];
function rotateLeft2(value, bits) {
  return (value << bits | value >>> 32 - bits) >>> 0;
}
function avalanche2(value) {
  let mixed = value >>> 0;
  mixed ^= mixed >>> 16;
  mixed = Math.imul(mixed, 2246822507);
  mixed ^= mixed >>> 13;
  mixed = Math.imul(mixed, 3266489909);
  mixed ^= mixed >>> 16;
  return mixed >>> 0;
}
function wideChecksum(source) {
  let lane0 = CHECKSUM_LANES[0].seed >>> 0;
  let lane1 = CHECKSUM_LANES[1].seed >>> 0;
  let lane2 = CHECKSUM_LANES[2].seed >>> 0;
  let lane3 = CHECKSUM_LANES[3].seed >>> 0;
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    lane0 = rotateLeft2(Math.imul((lane0 ^ code) >>> 0, 16777619) >>> 0, 5);
    lane1 = rotateLeft2(Math.imul((lane1 ^ code) >>> 0, 2246822519) >>> 0, 11);
    lane2 = rotateLeft2(Math.imul((lane2 ^ code) >>> 0, 374761393) >>> 0, 17);
    lane3 = rotateLeft2(Math.imul((lane3 ^ code) >>> 0, 668265263) >>> 0, 23);
  }
  const lanes = [lane0, lane1, lane2, lane3];
  const mixed = lanes.map((lane, index) => avalanche2((lane ^ source.length ^ rotateLeft2(lanes[(index + 1) % lanes.length], 7)) >>> 0));
  return mixed.map((lane) => lane.toString(16).padStart(8, "0")).join("");
}
function legacyChecksum(source) {
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
function cadProjectChecksum(value) {
  return `fnv1a128-${wideChecksum(JSON.stringify(stableValue2(value)))}`;
}
function cadProjectChecksumMatches(checksum, value) {
  return checksum.startsWith("fnv1a128-") ? checksum === cadProjectChecksum(value) : checksum === legacyChecksum(JSON.stringify(stableValue2(value)));
}
function parseCadProject(contents) {
  if (new TextEncoder().encode(contents).byteLength > FORM_PROJECT_LIMITS.bytes) throw new Error("CAD project exceeds the supported file size");
  let parsed;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new Error("CAD project is not valid JSON");
  }
  if (parsed?.kind === "form-studio-project") {
    const container = parseProject(contents);
    const cad = formWorkspace(container, "cad");
    if (!cad || !cad.data || typeof cad.data !== "object" || Array.isArray(cad.data)) throw new Error("This Form project has no CAD workspace");
    parsed = cad.data;
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.entities) || !Array.isArray(parsed.features)) {
    throw new Error("Missing CAD model data");
  }
  assertSafeTree2(parsed);
  if (typeof parsed.checksum === "string" && !cadProjectChecksumMatches(parsed.checksum, parsed)) {
    throw new Error("Project integrity check failed");
  }
  validateCadModel(parsed);
  const migrated = migrateCadProject(parsed);
  if (migrated.drawingBook !== void 0) validateDrawingBook(migrated.drawingBook);
  else migrated.drawingBook = createDrawingBook();
  const drafting = migrated.drafting ?? createCadDraftingDocument();
  if (!drafting || typeof drafting !== "object" || !Array.isArray(drafting.texts) || !Array.isArray(drafting.dimensions) || !Array.isArray(drafting.leaders) || !Array.isArray(drafting.hatches) || !Array.isArray(drafting.blockDefinitions) || !Array.isArray(drafting.blockInstances) || !Array.isArray(drafting.layouts)) {
    throw new Error("Project drafting document is malformed");
  }
  const draftingValidation = validateCadDraftingDocument(drafting);
  if (!draftingValidation.valid) throw new Error(`Project drafting document is invalid: ${draftingValidation.errors.join(" \xB7 ")}`);
  return {
    canonicalUnits: "mm",
    displayUnits: migrated.units ?? "mm",
    layers: [],
    geometricConstraints: [],
    parameters: [],
    gdt: [],
    components: [],
    assemblyInstances: [],
    assemblyMates: [],
    linkedGroups: [],
    importedBodies: [],
    configurations: [],
    activeConfigurationId: null,
    bimNodes: [],
    recipeGraphs: [],
    revisions: [],
    marketplace: [],
    volumes: [],
    sketchPlanes: [],
    rollbackIndex: migrated.features.length,
    material: "Aluminum 6061",
    density: 2.7,
    drawingScale: "1:1",
    drawingRevision: "A",
    kernel: "Open CASCADE B-Rep",
    appearance: {
      preset: "layer",
      baseColor: "#d7ff78",
      useLayerColor: true,
      metalness: 0.12,
      roughness: 0.48,
      clearcoat: 0.12,
      clearcoatRoughness: 0.35,
      transmission: 0,
      opacity: 1,
      environment: "studio",
      exposure: 1,
      groundShadow: true
    },
    ...migrated,
    drafting,
    version: CURRENT_PROJECT_VERSION
  };
}
export {
  cadProjectChecksum,
  formProjectChecksum,
  parseCadProject,
  parseProject
};
