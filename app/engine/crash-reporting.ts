import { type DiagnosticEvent, sanitizeDiagnosticValue } from "./diagnostics";

type FetchLike = typeof fetch;
type StorageLike = Pick<Storage, "getItem" | "setItem">;

export type CrashReporterOptions = {
  endpoint?: string | null;
  release: string;
  edition: "web" | "pro";
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  storage?: StorageLike | null;
};

function safeEndpoint(value: string | null | undefined) {
  if (!value) return null;
  try {
    const endpoint = new URL(value);
    return endpoint.protocol === "https:" ? endpoint.toString() : null;
  } catch {
    return null;
  }
}

function sanitizedEvent(event: DiagnosticEvent): DiagnosticEvent {
  return {
    ...event,
    message: sanitizeDiagnosticValue(event.message, 600),
    stack: event.stack ? sanitizeDiagnosticValue(event.stack, 4000) : undefined,
    context: event.context ? Object.fromEntries(
      Object.entries(event.context).slice(0, 32).map(([key, value]) => [
        sanitizeDiagnosticValue(key, 80),
        typeof value === "string" ? sanitizeDiagnosticValue(value, 300) : value,
      ]),
    ) : undefined,
  };
}

/** Best-effort transport: reporting can never block recovery or throw into the app. */
export class RemoteCrashReporter {
  readonly endpoint: string | null;
  private readonly sent: Set<string>;
  private readonly storage: StorageLike | null;
  private readonly storageKey: string;

  constructor(private readonly options: CrashReporterOptions) {
    this.endpoint = safeEndpoint(options.endpoint);
    this.storage = options.storage === undefined ? browserStorage() : options.storage;
    this.storageKey = `luma.crash.receipts.v1:${sanitizeDiagnosticValue(options.release, 100)}`;
    this.sent = new Set(this.readReceipts());
  }

  get enabled() { return !!this.endpoint; }

  async report(event: DiagnosticEvent) {
    if (!this.endpoint || this.sent.has(event.id) || (event.kind !== "crash" && event.kind !== "rejection")) return false;
    this.sent.add(event.id);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 4000);
    try {
      const response = await (this.options.fetchImpl ?? fetch)(this.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          schema: "luma-crash/1",
          release: sanitizeDiagnosticValue(this.options.release, 100),
          edition: this.options.edition,
          event: sanitizedEvent(event),
        }),
        credentials: "omit",
        referrerPolicy: "no-referrer",
        keepalive: true,
        signal: controller.signal,
      });
      if (response.ok) this.rememberReceipt(event.id);
      else this.sent.delete(event.id);
      return response.ok;
    } catch {
      this.sent.delete(event.id);
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Retry locally retained fatal events after startup without duplicating receipts. */
  async flush(events: readonly DiagnosticEvent[]) {
    let delivered = 0;
    for (const event of events.slice(-50)) if (await this.report(event)) delivered++;
    return delivered;
  }

  private readReceipts() {
    try {
      const value = JSON.parse(this.storage?.getItem(this.storageKey) ?? "[]") as unknown;
      return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string").slice(-100) : [];
    } catch { return []; }
  }

  private rememberReceipt(id: string) {
    try {
      const ids = [...this.sent].filter((candidate) => candidate !== id).slice(-99);
      ids.push(id);
      this.storage?.setItem(this.storageKey, JSON.stringify(ids));
    } catch {
      // Private/locked storage must not make reporting fatal.
    }
  }
}

function browserStorage(): StorageLike | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

function readEnv(): Record<string, string | undefined> {
  try {
    if (typeof process === "undefined" || !process.env) return {};
    // Keep direct property reads so Next can inline NEXT_PUBLIC values in the
    // browser bundle; returning process.env wholesale leaves them undefined.
    return {
      NEXT_PUBLIC_LUMA_CRASH_ENDPOINT: process.env.NEXT_PUBLIC_LUMA_CRASH_ENDPOINT,
      NEXT_PUBLIC_LUMA_RELEASE: process.env.NEXT_PUBLIC_LUMA_RELEASE,
    };
  } catch { return {}; }
}

export function createCrashReporterFromEnv(
  edition: "web" | "pro",
  env: Record<string, string | undefined> = readEnv(),
) {
  return new RemoteCrashReporter({
    endpoint: env.NEXT_PUBLIC_LUMA_CRASH_ENDPOINT,
    release: env.NEXT_PUBLIC_LUMA_RELEASE ?? "development",
    edition,
  });
}
