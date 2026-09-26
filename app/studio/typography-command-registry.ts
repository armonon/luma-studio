import type { TextRunStyle } from "@/app/engine/document";
import type { ResolvedTextRunStyle } from "@/app/engine/text-model";

export type TypographyCommandId = "type.bold" | "type.italic" | "type.underline" | "type.smallCaps" | "type.oldStyleNumbers" | "type.ligatures";

export type TypographyCommandDefinition = Readonly<{
  id: TypographyCommandId;
  label: string;
  shortcut: string;
  patch: (style: ResolvedTextRunStyle) => TextRunStyle;
}>;

export const TYPOGRAPHY_COMMANDS: Readonly<Record<TypographyCommandId, TypographyCommandDefinition>> = Object.freeze({
  "type.bold": { id: "type.bold", label: "Bold", shortcut: "CmdOrCtrl+B", patch: (style) => ({ fontWeight: style.fontWeight >= 700 ? 400 : 700, axes: { ...style.axes, wght: style.fontWeight >= 700 ? 400 : 700 } }) },
  "type.italic": { id: "type.italic", label: "Italic", shortcut: "CmdOrCtrl+I", patch: (style) => ({ fontStyle: style.fontStyle === "italic" ? "normal" : "italic" }) },
  "type.underline": { id: "type.underline", label: "Underline", shortcut: "CmdOrCtrl+U", patch: (style) => ({ decoration: style.decoration === "underline" ? "none" : "underline" }) },
  "type.smallCaps": { id: "type.smallCaps", label: "Small caps", shortcut: "", patch: (style) => ({ features: { ...style.features, smcp: !style.features.smcp } }) },
  "type.oldStyleNumbers": { id: "type.oldStyleNumbers", label: "Old-style numbers", shortcut: "", patch: (style) => ({ features: { ...style.features, onum: !style.features.onum } }) },
  "type.ligatures": { id: "type.ligatures", label: "Standard ligatures", shortcut: "", patch: (style) => ({ features: { ...style.features, liga: style.features.liga === false } }) },
});

export function typographyCommandForKeyboard(event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey">): TypographyCommandId | null {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return null;
  if (event.key.toLowerCase() === "b") return "type.bold";
  if (event.key.toLowerCase() === "i") return "type.italic";
  if (event.key.toLowerCase() === "u") return "type.underline";
  return null;
}

export function executeTypographyCommand(id: TypographyCommandId, style: ResolvedTextRunStyle, apply: (patch: TextRunStyle) => void) {
  const command = TYPOGRAPHY_COMMANDS[id];
  apply(command.patch(style));
  return command;
}
