import { DESKTOP_MENU, type StudioCommand } from "./menu-model";

/** One accelerator table for the web fallback and native-menu event arbitration. */
export function commandForShortcut(event: { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }): StudioCommand | null {
  if (!event.metaKey && !event.ctrlKey) return null;
  for (const section of DESKTOP_MENU) for (const item of section.items) {
    if (item.kind !== "command" || !item.accelerator) continue;
    const parts = item.accelerator.split("+");
    if (parts.includes("Alt") !== event.altKey) continue;
    const key = parts.at(-1)!.toLowerCase();
    const plus = key === "plus";
    if (!plus && parts.includes("Shift") !== event.shiftKey) continue;
    if (plus ? event.key === "+" || event.key === "=" : event.key.toLowerCase() === key) return item.id;
  }
  return null;
}
