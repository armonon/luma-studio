export type SaveState = "saved" | "unsaved" | "saving" | "error";

/** Recovery activity must never imply the user saved a portable project file. */
export function saveStatusLabel(state: SaveState, dirty: boolean, projectSaving: boolean) {
  if (projectSaving) return "Saving project…";
  if (state === "error") return "Save needs attention";
  if (state === "saving") return "Updating recovery…";
  return dirty ? "Unsaved changes" : "No unsaved changes";
}
