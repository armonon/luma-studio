import { parseLegacyCanvasFont } from "./text-model";
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const number = (v: unknown, min: number, max: number) => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
const string = (v: unknown, max = 1024) => typeof v === "string" && v.length > 0 && v.length <= max;
const color = (v: unknown) => typeof v === "string" && v.length <= 80 && (/^#[a-f\d]{3,8}$/i.test(v) || /^(?:rgb|hsl)a?\([\d\s.,%+-]+\)$/i.test(v));
function requireValue(ok: unknown, field: string): asserts ok { if (!ok) throw new Error(`Invalid Form text ${field}`); }
function style(v: unknown) {
  requireValue(record(v), "style");
  for (const [key, min, max] of [["fontSize", 1, 2000], ["fontWeight", 1, 1000], ["fontStretch", 50, 200], ["tracking", -1000, 5000], ["baselineShift", -100000, 100000]] as const) if (v[key] !== undefined) requireValue(number(v[key], min, max), key);
  if (v.fontFamily !== undefined) requireValue(string(v.fontFamily, 512), "font family");
  if (v.color !== undefined) requireValue(color(v.color), "color");
  if (v.fontStyle !== undefined) requireValue(["normal", "italic", "oblique"].includes(String(v.fontStyle)), "font style");
  if (v.decoration !== undefined) requireValue(["none", "underline", "line-through"].includes(String(v.decoration)), "decoration");
  for (const key of ["axes", "features"]) if (v[key] !== undefined) {
    const entries = v[key]; requireValue(record(entries) && Object.keys(entries).length <= 64, key);
    for (const [tag, value] of Object.entries(entries)) requireValue(/^[a-zA-Z\d]{4}$/.test(tag) && (key === "axes" ? number(value, -100000, 100000) : typeof value === "boolean"), key);
  }
}
/** Admission is intentionally smaller than the exchange envelope's transport limit. */
export function validateReturnedFormText(value: Record<string, unknown>) {
  requireValue(string(value.id, 256) && string(value.name, 1024), "identity length");
  requireValue(record(value.source) && string(value.source.layerId, 256) && number(value.updatedAt, 0, Number.MAX_SAFE_INTEGER), "identity");
  const t = value.typography; requireValue(record(t), "story");
  requireValue(typeof t.text === "string" && t.text.length <= 32768 && string(t.font) && color(t.color), "story/font/color");
  requireValue(/\d+(?:\.\d+)?px\s+\S/.test(t.font as string), "font format (pixel sizes required)");
  requireValue(number(parseLegacyCanvasFont(t.font as string).fontSize, 1, 2000), "font size");
  requireValue(["left", "center", "right", "start", "end"].includes(String(t.align)) && number(t.lineHeight, 0.1, 20), "alignment/leading");
  if (t.layout !== undefined) requireValue(["point", "paragraph", "vertical"].includes(String(t.layout)), "layout (path text needs its source path)");
  for (const key of ["x", "y", "boxWidth", "boxHeight"]) if (t[key] !== undefined) requireValue(number(t[key], key === "x" || key === "y" ? -1000000 : 1, 1000000), key);
  if (t.justify !== undefined) requireValue(typeof t.justify === "boolean", "justification");
  if (t.layout === "paragraph") requireValue(number(t.boxWidth, 1, 1000000) && number(t.boxHeight, 1, 1000000), "paragraph frame");
  if (t.direction !== undefined) requireValue(["auto", "ltr", "rtl"].includes(String(t.direction)), "direction");
  if (t.writingMode !== undefined) requireValue(["horizontal-tb", "vertical-rl", "vertical-lr"].includes(String(t.writingMode)), "writing mode");
  if (t.language !== undefined) requireValue(string(t.language, 128), "language");
  for (const key of ["tracking", "paragraphSpacing"]) if (t[key] !== undefined) requireValue(number(t[key], key === "tracking" ? -1000 : 0, key === "tracking" ? 5000 : 20), key);
  if (t.defaultStyle !== undefined) style(t.defaultStyle);
  if (t.runs !== undefined) {
    requireValue(Array.isArray(t.runs) && t.runs.length <= 256, "run budget (256)");
    for (const run of t.runs) { requireValue(record(run) && Number.isInteger(run.start) && Number.isInteger(run.end) && number(run.start, 0, t.text.length) && number(run.end, Number(run.start) + 1, t.text.length), "run range"); style(run.style); }
  }
  // These need a richer exchange schema to avoid silently changing frame/path layout.
  requireValue(t.paragraphs === undefined || Array.isArray(t.paragraphs) && t.paragraphs.length === 0, "paragraph overrides are not supported by this return workflow");
  if (t.appearance !== undefined) {
    requireValue(record(t.appearance), "appearance");
    for (const key of ["fills", "strokes"]) {
      const entries = t.appearance[key]; requireValue(Array.isArray(entries) && entries.length <= 16, "appearance budget");
      for (const entry of entries) requireValue(record(entry) && color(entry.color) && number(entry.opacity, 0, 1) && typeof entry.enabled === "boolean" && (key === "fills" || number(entry.width, 0, 1000)), "appearance entry");
    }
  }
  const s = value.spatial; requireValue(record(s) && s.schemaVersion === 1 && typeof s.enabled === "boolean" && record(s.transform) && record(s.material) && record(s.extrusion), "spatial settings");
  for (const key of ["rotationX", "rotationY", "rotationZ"]) requireValue(number(s.transform[key], -180, 180), key);
  requireValue(number(s.transform.perspective, 0, 100) && number(s.extrusion.depth, 0, 1000) && number(s.extrusion.bevel, 0, 100), "extrusion/perspective");
  requireValue(color(s.material.frontColor) && color(s.material.sideColor) && number(s.material.roughness, 0, 1) && number(s.material.metalness, 0, 1), "material");
  if (s.link !== undefined) requireValue(record(s.link) && s.link.application === "form-studio" && string(s.link.projectId, 256) && string(s.link.objectId, 256) && typeof s.link.autoUpdate === "boolean", "link");
}
