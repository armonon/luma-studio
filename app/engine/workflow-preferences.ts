export type WorkflowPreferences<Workspace extends string, Tool extends string> = {
  readonly version: 1;
  readonly workspaceOrder: readonly Workspace[];
  readonly hiddenTools: readonly Tool[];
  readonly shortcutOverrides: Readonly<Partial<Record<Tool, string>>>;
  readonly contextualInspector: boolean;
};

export function defaultWorkflowPreferences<Workspace extends string, Tool extends string>(
  workspaces: readonly Workspace[],
): WorkflowPreferences<Workspace, Tool> {
  return {
    version: 1,
    workspaceOrder: [...workspaces],
    hiddenTools: [],
    shortcutOverrides: {} as Partial<Record<Tool, string>>,
    contextualInspector: true,
  };
}

export function normalizeWorkflowPreferences<Workspace extends string, Tool extends string>(
  input: unknown,
  workspaces: readonly Workspace[],
  tools: readonly Tool[],
): WorkflowPreferences<Workspace, Tool> {
  const fallback = defaultWorkflowPreferences<Workspace, Tool>(workspaces);
  if (!input || typeof input !== "object") return fallback;
  const candidate = input as Record<string, unknown>;
  const validWorkspaces = new Set(workspaces);
  const validTools = new Set(tools);
  const requestedOrder = Array.isArray(candidate.workspaceOrder)
    ? candidate.workspaceOrder.filter((value): value is Workspace => typeof value === "string" && validWorkspaces.has(value as Workspace))
    : [];
  const workspaceOrder = [...new Set(requestedOrder), ...workspaces.filter((workspace) => !requestedOrder.includes(workspace))];
  const hiddenTools = Array.isArray(candidate.hiddenTools)
    ? [...new Set(candidate.hiddenTools.filter((value): value is Tool => typeof value === "string" && validTools.has(value as Tool)))]
    : [];
  const shortcutOverrides: Partial<Record<Tool, string>> = {};
  if (candidate.shortcutOverrides && typeof candidate.shortcutOverrides === "object") {
    for (const [tool, shortcut] of Object.entries(candidate.shortcutOverrides as Record<string, unknown>)) {
      if (!validTools.has(tool as Tool) || typeof shortcut !== "string") continue;
      const normalized = normalizeShortcut(shortcut);
      if (normalized && !reservedShortcutReason(normalized)) shortcutOverrides[tool as Tool] = normalized;
    }
  }
  return {
    version: 1,
    workspaceOrder,
    hiddenTools,
    shortcutOverrides,
    contextualInspector: candidate.contextualInspector !== false,
  };
}

export function normalizeShortcut(value: string) {
  const normalized = value.trim().toUpperCase();
  return /^[A-Z0-9]$/.test(normalized) ? normalized : null;
}

export function reservedShortcutReason(value: string) {
  const normalized = normalizeShortcut(value);
  if (normalized === "0") return "0 is reserved for Fit Canvas";
  if (normalized === "1") return "1 is reserved for 100% Zoom";
  return null;
}

export function resolveShortcut<Tool extends string>(
  tool: Tool,
  fallback: string,
  preferences: Pick<WorkflowPreferences<string, Tool>, "shortcutOverrides">,
) {
  return preferences.shortcutOverrides[tool] ?? fallback.toUpperCase();
}

export function shortcutConflict<Tool extends string>(
  tools: readonly (readonly [Tool, string])[],
  target: Tool,
  shortcut: string,
  preferences: Pick<WorkflowPreferences<string, Tool>, "shortcutOverrides">,
) {
  const normalized = normalizeShortcut(shortcut);
  if (!normalized) return null;
  return tools.find(([tool, fallback]) => (
    tool !== target && resolveShortcut(tool, fallback, preferences) === normalized
  ))?.[0] ?? null;
}
