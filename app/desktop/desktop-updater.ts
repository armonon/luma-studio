type Invoke = (command: string, payload?: Record<string, unknown>) => Promise<unknown>;

export type DesktopUpdate = {
  currentVersion: string;
  version: string;
  date?: string;
  body?: string;
};

export type DesktopUpdateResult =
  | { status: "busy" }
  | { status: "unavailable" }
  | { status: "current" }
  | { status: "cancelled"; update: DesktopUpdate }
  | { status: "installing"; update: DesktopUpdate };

type UpdateFlowOptions = {
  invoke?: Invoke;
  confirmInstall?: (update: DesktopUpdate) => boolean | Promise<boolean>;
  beforeInstall?: (update: DesktopUpdate) => (() => void) | Promise<() => void>;
  onStatus?: (message: string) => void;
  onPhase?: (phase: "checking" | "downloading" | "checkpointing" | "installing" | "idle") => void;
};

let updateInFlight = false;

function nativeInvoke(): Invoke | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as Window & {
    __TAURI__?: { core?: { invoke?: Invoke } };
  }).__TAURI__?.core?.invoke;
}

function parseUpdate(value: unknown): DesktopUpdate | null {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The update service returned malformed version metadata.");
  const candidate = value as Record<string, unknown>;
  if (![candidate.currentVersion, candidate.version].every(value => typeof value === "string" && value.length > 0 && value.length <= 128 && value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value))) {
    throw new Error("The update service returned malformed version metadata.");
  }
  return {
    currentVersion: candidate.currentVersion as string,
    version: candidate.version as string,
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
  if (updateInFlight) return { status: "busy" };
  updateInFlight = true;
  let token: string | undefined;
  let installed = false;
  try {
  options.onPhase?.("checking");
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
  if (!options.beforeInstall) throw new Error("A protected workspace checkpoint is required before installing updates.");

  options.onPhase?.("downloading");
  options.onStatus?.(`Downloading and verifying Luma Studio ${update.version}…`);
  const prepared = await invoke("prepare_desktop_update", { expectedVersion: update.version });
  if (typeof prepared !== "string" || !/^[0-9]{1,20}$/u.test(prepared)) throw new Error("The update service returned an invalid installation ticket.");
  token = prepared;
  // The checkpoint must follow the network wait, not precede it. Nothing is
  // replaced until all open documents have been revalidated after the write.
  options.onPhase?.("checkpointing");
  const assertCheckpoint = await options.beforeInstall(update);
  if (typeof assertCheckpoint !== "function") throw new Error("The workspace checkpoint did not provide a restart guard.");
  options.onPhase?.("installing");
  options.onStatus?.(`Installing verified Luma Studio ${update.version}…`);
  assertCheckpoint();
  await invoke("install_desktop_update", { token });
  installed = true;
  return { status: "installing", update };
  } finally {
    if (token && !installed) {
      try { await invoke("discard_desktop_update", { token }); } catch { /* Preserve the original error; native tickets expire. */ }
    }
    updateInFlight = false;
    if (!installed) options.onPhase?.("idle");
  }
}
