import { resolveShortcut, type WorkflowPreferences } from "../engine/workflow-preferences";
import { TOOL_REGISTRY, toolsForWorkspace, type Tool, type WorkspaceMode } from "./tool-registry";
import { DESKTOP_TOOL_RAIL } from "./desktop-presentation";

/** Desktop's cross-workspace rail needs cross-workspace shortcuts too.
 * Preserve current-workspace priority when legacy defaults share a letter.
 */
export function resolveToolKey(
  key: string,
  workspace: WorkspaceMode,
  preferences: Pick<WorkflowPreferences<WorkspaceMode, Tool>, "hiddenTools" | "shortcutOverrides">,
  acrossWorkspaces: boolean,
) {
  const candidates = [
    ...toolsForWorkspace(workspace),
    ...(acrossWorkspaces ? DESKTOP_TOOL_RAIL.map(id => TOOL_REGISTRY[id]) : []),
    ...(acrossWorkspaces ? Object.values(TOOL_REGISTRY).filter(tool => tool.workspace !== workspace) : []),
  ];
  return candidates.find(tool => !preferences.hiddenTools.includes(tool.id)
    && resolveShortcut(tool.id, tool.shortcut, preferences).toLowerCase() === key.toLowerCase());
}
