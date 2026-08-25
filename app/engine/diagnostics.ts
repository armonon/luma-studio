export type DiagnosticKind = "crash" | "rejection" | "long-task" | "recovery";

export type DiagnosticEvent = {
  id: string;
  kind: DiagnosticKind;
  timestamp: string;
  message: string;
  stack?: string;
  context?: Record<string, string | number | boolean | null>;
};

type StorageLike = Pick<Storage, "getItem" | "setItem">;

const STORAGE_KEY = "luma.diagnostics.v1";
const MAX_EVENTS = 50;

function browserStorage(): StorageLike | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

/** Remove absolute user paths and query strings before anything is persisted. */
export function sanitizeDiagnosticValue(value: unknown, limit: number) {
  return String(value ?? "Unknown error")
    .replace(/file:\/\/[^\s)]+/g, "[local-file]")
    .replace(/\/(Users|home)\/[^/\s]+\//g, "/$1/[user]/")
    .replace(/https?:\/\/([^/?#\s]+)[^\s)]*/g, "https://$1/[path]")
    .slice(0, limit);
}

function errorParts(value: unknown) {
  if (value instanceof Error) return {
    message: sanitizeDiagnosticValue(value.message || value.name, 600),
    stack: value.stack ? sanitizeDiagnosticValue(value.stack, 4000) : undefined,
  };
  return { message: sanitizeDiagnosticValue(value, 600), stack: undefined };
}

export class LocalDiagnostics {
  private memory: DiagnosticEvent[] = [];

  constructor(private readonly storage: StorageLike | null = browserStorage()) {
    this.memory = this.read();
  }

  private read() {
    if (!this.storage) return this.memory;
    try {
      const parsed = JSON.parse(this.storage.getItem(STORAGE_KEY) ?? "[]") as unknown;
      return Array.isArray(parsed) ? parsed.slice(-MAX_EVENTS) as DiagnosticEvent[] : [];
    } catch {
      return this.memory;
    }
  }

  private write(events: DiagnosticEvent[]) {
    this.memory = events.slice(-MAX_EVENTS);
    try { this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.memory)); } catch { /* private storage may be full or blocked */ }
  }

  record(kind: DiagnosticKind, value: unknown, context?: DiagnosticEvent["context"]) {
    const parts = errorParts(value);
    const event: DiagnosticEvent = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      kind,
      timestamp: new Date().toISOString(),
      ...parts,
      ...(context ? { context: { ...context } } : {}),
    };
    this.write([...this.read(), event]);
    return event;
  }

  list() { return [...this.read()]; }

  summary() {
    const events = this.read();
    return {
      events: events.length,
      crashes: events.filter((event) => event.kind === "crash" || event.kind === "rejection").length,
      recoveries: events.filter((event) => event.kind === "recovery").length,
      lastEventAt: events.at(-1)?.timestamp,
    };
  }

  exportReport(context: Record<string, unknown> = {}) {
    return new Blob([JSON.stringify({
      schema: "luma-diagnostics/1",
      createdAt: new Date().toISOString(),
      context,
      events: this.read(),
    }, null, 2)], { type: "application/json" });
  }
}

export const localDiagnostics = new LocalDiagnostics();

export function installGlobalDiagnostics(options: {
  diagnostics?: LocalDiagnostics;
  context?: () => DiagnosticEvent["context"];
  onFatal?: (event: DiagnosticEvent) => void | Promise<void>;
  onRecord?: (event: DiagnosticEvent) => void | Promise<void>;
}) {
  const diagnostics = options.diagnostics ?? localDiagnostics;
  let lastRecoveryAt = 0;
  const record = (kind: "crash" | "rejection", error: unknown) => {
    let context: DiagnosticEvent["context"];
    try { context = options.context?.(); } catch { context = undefined; }
    const event = diagnostics.record(kind, error, context);
    if (options.onRecord) void Promise.resolve(options.onRecord(event)).catch(() => undefined);
    const now = Date.now();
    if (options.onFatal && now - lastRecoveryAt > 5000) {
      lastRecoveryAt = now;
      void Promise.resolve(options.onFatal(event)).catch((recoveryError) => {
        diagnostics.record("recovery", `Emergency recovery failed: ${errorParts(recoveryError).message}`, context);
      });
    }
  };
  const onError = (event: ErrorEvent) => record("crash", event.error ?? event.message);
  const onRejection = (event: PromiseRejectionEvent) => record("rejection", event.reason);
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);

  let observer: PerformanceObserver | null = null;
  let lastLongTaskAt = 0;
  try {
    if (typeof PerformanceObserver !== "undefined" && PerformanceObserver.supportedEntryTypes.includes("longtask")) {
      observer = new PerformanceObserver((list) => {
        const duration = Math.max(0, ...list.getEntries().map((entry) => entry.duration));
        if (duration < 500 || Date.now() - lastLongTaskAt < 30_000) return;
        lastLongTaskAt = Date.now();
        diagnostics.record("long-task", `Main thread blocked for ${Math.round(duration)} ms`, options.context?.());
      });
      observer.observe({ entryTypes: ["longtask"] });
    }
  } catch { observer = null; }

  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
    observer?.disconnect();
  };
}
