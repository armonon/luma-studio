import type { Layer, TextSpatialStyle, TextStyle } from "./document";
import { DEFAULT_TEXT_SPATIAL, withTextSpatial } from "./text-3d";
import { resolvedDefaultTextStyle } from "./text-model";
import { validateReturnedFormText } from "./form-text-validation";
import { validateFormTextOutlines, type FormTextOutlines } from "./form-text-outlines";
import type { ShapedOutlines } from "./text-outline-model";

export const LUMA_FORM_TEXT_SCHEMA = "luma-form/text-object@1" as const;
export const LUMA_FORM_TEXT_LIMITS = { bytes: 4 * 1024 * 1024, textLength: 1_000_000, runs: 100_000 } as const;

export type LumaFormTextAsset = {
  schema: typeof LUMA_FORM_TEXT_SCHEMA;
  id: string;
  name: string;
  source: { application: "luma-studio"; layerId: string };
  typography: Pick<TextStyle, "text" | "font" | "color" | "align" | "lineHeight" | "tracking" | "paragraphSpacing" | "layout" | "direction" | "writingMode" | "language" | "defaultStyle" | "runs" | "paragraphs" | "appearance" | "x" | "y" | "boxWidth" | "boxHeight" | "justify">;
  spatial: TextSpatialStyle;
  updatedAt: number;
  geometry?: FormTextOutlines;
};

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

export function formTextAssetFromLayer(layer: Layer, now = Date.now()): LumaFormTextAsset {
  if (layer.kind !== "text" || !layer.text) throw new Error("Only editable text layers can be sent to Form Studio");
  const style = layer.text;
  const origin = style.formOrigin;
  if (origin && (![origin.assetId, origin.layerId].every(value => typeof value === "string" && value.length > 0 && value.length <= 256))) throw new Error("Invalid Form source identity");
  const defaultStyle = resolvedDefaultTextStyle(style);
  return {
    schema: LUMA_FORM_TEXT_SCHEMA,
    id: origin?.assetId ?? `luma-text-${layer.id}`,
    name: layer.name,
    source: { application: "luma-studio", layerId: origin?.layerId ?? layer.id },
    typography: {
      text: style.text,
      x: style.x, y: style.y, boxWidth: style.boxWidth, boxHeight: style.boxHeight, justify: style.justify,
      font: style.font,
      color: style.color,
      align: style.align,
      lineHeight: style.lineHeight,
      tracking: style.tracking,
      paragraphSpacing: style.paragraphSpacing,
      layout: style.layout,
      direction: style.direction,
      writingMode: style.writingMode,
      language: style.language,
      defaultStyle,
      runs: style.runs?.map((run) => ({ ...run, style: { ...run.style, axes: { ...run.style.axes }, features: { ...run.style.features } } })),
      paragraphs: style.paragraphs?.map((paragraph) => ({ ...paragraph, style: { ...paragraph.style } })),
      appearance: style.appearance ? {
        fills: style.appearance.fills.map((fill) => ({ ...fill })),
        strokes: style.appearance.strokes.map((stroke) => ({ ...stroke })),
      } : undefined,
    },
    spatial: withTextSpatial(layer.spatial ?? style.spatial, { enabled: true }),
    updatedAt: now,
  };
}

export function serializeFormTextAsset(asset: LumaFormTextAsset) {
  const source = `${JSON.stringify(asset)}\n`;
  if (new TextEncoder().encode(source).byteLength > LUMA_FORM_TEXT_LIMITS.bytes) throw new Error("Form text asset exceeds the 4 MiB exchange budget");
  return source;
}

/** Shape a snapshot: exports cannot race with subsequent document edits. */
export async function formTextAssetWithOutlines(layer: Layer, shape: (text: TextStyle) => Promise<ShapedOutlines>): Promise<LumaFormTextAsset> {
  const asset = formTextAssetFromLayer(layer);
  const text = structuredClone(layer.text!);
  const style = resolvedDefaultTextStyle(text);
  if (text.appearance || style.decoration !== "none") throw new Error("Form glyph geometry does not flatten appearance stacks or decorations. Remove them before exporting.");
  const outlines = await shape(text);
  asset.geometry = { schema: "luma-form/glyph-outlines@1", sourceKey: JSON.stringify(asset.typography), paths: outlines.paths };
  validateFormTextOutlines(asset.geometry, asset.typography);
  serializeFormTextAsset(asset);
  return asset;
}

export function parseFormTextAsset(source: string): LumaFormTextAsset {
  if (new TextEncoder().encode(source).byteLength > LUMA_FORM_TEXT_LIMITS.bytes) throw new Error("Form text asset is too large");
  let value: unknown;
  try { value = JSON.parse(source); } catch { throw new Error("Form text asset is not valid JSON"); }
  if (!isRecord(value) || value.schema !== LUMA_FORM_TEXT_SCHEMA || !isRecord(value.typography) || !isRecord(value.spatial)) throw new Error("Unsupported Form text asset");
  if (typeof value.id !== "string" || typeof value.name !== "string" || !isRecord(value.source) || value.source.application !== "luma-studio") throw new Error("Form text asset identity is invalid");
  if (typeof value.typography.text !== "string" || value.typography.text.length > LUMA_FORM_TEXT_LIMITS.textLength) throw new Error("Form text story is invalid");
  if (value.typography.runs !== undefined && (!Array.isArray(value.typography.runs) || value.typography.runs.length > LUMA_FORM_TEXT_LIMITS.runs)) throw new Error("Form text run collection is invalid");
  validateReturnedFormText(value);
  if (value.geometry !== undefined) validateFormTextOutlines(value.geometry, value.typography);
  return value as unknown as LumaFormTextAsset;
}

export function linkTextLayerToForm(layer: Layer, asset: LumaFormTextAsset, project: { projectId: string; revisionId?: string; objectId?: string; uri?: string }): TextStyle {
  if (layer.kind !== "text" || !layer.text) throw new Error("Only editable text layers can be linked to Form Studio");
  return {
    ...layer.text,
    spatial: withTextSpatial(layer.text.spatial ?? asset.spatial ?? DEFAULT_TEXT_SPATIAL, {
      enabled: true,
      link: {
        application: "form-studio",
        projectId: project.projectId,
        revisionId: project.revisionId,
        objectId: project.objectId ?? asset.id,
        uri: project.uri,
        autoUpdate: false,
        lastSyncedAt: asset.updatedAt,
      },
    }),
  };
}
