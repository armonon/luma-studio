type Invoke = (command: string, payload?: Record<string, unknown>) => Promise<unknown>;

export type DesktopUpdate = {
  currentVersion: string;
  version: string;
  date?: string;
  body?: string;
};

export type DesktopUpdateResult =
  | { status: "unavailable" }
  | { status: "current" }
  | { status: "cancelled"; update: DesktopUpdate }
  | { status: "installing"; update: DesktopUpdate };

type UpdateFlowOptions = {
  invoke?: Invoke;
  confirmInstall?: (update: DesktopUpdate) => boolean | Promise<boolean>;
  beforeInstall?: (update: DesktopUpdate) => void | Promise<void>;
  onStatus?: (message: string) => void;
};

function nativeInvoke(): Invoke | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as Window & {
    __TAURI__?: { core?: { invoke?: Invoke } };
  }).__TAURI__?.core?.invoke;
}

function parseUpdate(value: unknown): DesktopUpdate | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.currentVersion !== "string" || typeof candidate.version !== "string") {
    throw new Error("The update service returned malformed version metadata.");
  }
  return {
    currentVersion: candidate.currentVersion,
    version: candidate.version,
    ...(typeof candidate.date === "string" ? { date: candidate.date } : {}),
    ...(typeof candidate.body === "string" ? { body: candidate.body } : {}),
  };
}

/**
 * Complete native update flow with explicit consent before download/install.
 * Browser builds return `unavailable`; release desktop builds use the native
 * updater, whose Rust side verifies the signed artifact before replacing it.
 */
export async function runDesktopUpdateFlow(options: UpdateFlowOptions = {}): Promise<DesktopUpdateResult> {
  const invoke = options.invoke ?? nativeInvoke();
  if (!invoke) return { status: "unavailable" };

  options.onStatus?.("Checking for updates…");
  let update: DesktopUpdate | null;
  try {
    update = parseUpdate(await invoke("check_desktop_update"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/empty endpoint|no endpoint|unavailable/i.test(message)) return { status: "unavailable" };
    throw error;
  }
  if (!update) return { status: "current" };

  const confirmInstall = options.confirmInstall ?? ((candidate) => window.confirm(
    `Luma Studio ${candidate.version} is available. Download, verify, install, and restart now?`,
  ));
  if (!(await confirmInstall(update))) return { status: "cancelled", update };

  await options.beforeInstall?.(update);
  options.onStatus?.(`Downloading and verifying Luma Studio ${update.version}…`);
  await invoke("install_desktop_update", { expectedVersion: update.version });
  return { status: "installing", update };
}
