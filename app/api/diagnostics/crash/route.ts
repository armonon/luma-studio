import { sanitizeDiagnosticValue } from "@/app/engine/diagnostics";
import { readBoundedText, UploadLimitError, UploadTimeoutError } from "@/app/engine/bounded-upload";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 32 * 1024;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT = 20;
const MAX_RATE_KEYS = 5000;
const DESKTOP_ORIGINS = new Set([
  "tauri://localhost",
  "http://tauri.localhost",
  "https://tauri.localhost",
  "http://localhost:3000",
]);

type RateWindow = { resetAt: number; used: number };
const rateWindows = new Map<string, RateWindow>();
let inFlight = 0;
const MAX_IN_FLIGHT = 4;

function allowedOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin || DESKTOP_ORIGINS.has(origin);
}

function respond(request: Request, body: BodyInit | null, init: ResponseInit) {
  const headers = new Headers(init.headers);
  headers.set("cache-control", "no-store");
  const origin = request.headers.get("origin");
  if (origin && DESKTOP_ORIGINS.has(origin)) {
    headers.set("access-control-allow-origin", origin);
    headers.append("vary", "Origin");
  }
  return new Response(body, { ...init, headers });
}

function json(request: Request, value: unknown, status: number) {
  return respond(request, JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function webhookUrl() {
  const value = process.env.LUMA_CRASH_WEBHOOK_URL;
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

/**
 * Identify the caller for rate limiting.
 *
 * Both of these headers are set by the client unless something in front of
 * this route overwrites them, so a sender that rotates `x-forwarded-for` gets
 * a fresh bucket per request and the limit does nothing. Trust them only when
 * the deployment says a proxy is stripping and rewriting them; otherwise every
 * request shares one bucket, which is strictly safer than a bypassable one.
 */
function clientKey(request: Request) {
  if (process.env.LUMA_TRUSTED_PROXY !== "1") return "shared";
  return (request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown").trim().slice(0, 80);
}

/**
 * The ceiling no amount of key rotation can climb past.
 *
 * Generous enough that a genuine fleet behind a trusted proxy will not hit it,
 * low enough that it still bounds what this route will forward upstream.
 */
const GLOBAL_RATE_LIMIT = RATE_LIMIT * 50;
let globalWindow: RateWindow = { resetAt: 0, used: 0 };

function acquireGlobal(now: number) {
  if (now >= globalWindow.resetAt) globalWindow = { resetAt: now + RATE_WINDOW_MS, used: 0 };
  if (globalWindow.used >= GLOBAL_RATE_LIMIT) return Math.max(1, Math.ceil((globalWindow.resetAt - now) / 1000));
  globalWindow.used++;
  return 0;
}

function acquire(key: string, now = Date.now()) {
  if (rateWindows.size >= MAX_RATE_KEYS && !rateWindows.has(key)) {
    for (const [candidate, window] of rateWindows) if (now >= window.resetAt) rateWindows.delete(candidate);
    while (rateWindows.size >= MAX_RATE_KEYS) rateWindows.delete(rateWindows.keys().next().value!);
  }
  let window = rateWindows.get(key);
  if (!window || now >= window.resetAt) {
    window = { resetAt: now + RATE_WINDOW_MS, used: 0 };
    rateWindows.set(key, window);
  }
  if (window.used >= RATE_LIMIT) return Math.max(1, Math.ceil((window.resetAt - now) / 1000));
  window.used++;
  return 0;
}

function sanitizedPayload(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Crash report must be an object");
  const report = value as Record<string, unknown>;
  if (report.schema !== "luma-crash/1" || (report.edition !== "web" && report.edition !== "pro")) {
    throw new Error("Unsupported crash report schema");
  }
  if (!report.event || typeof report.event !== "object" || Array.isArray(report.event)) throw new Error("Crash event is required");
  const event = report.event as Record<string, unknown>;
  if (event.kind !== "crash" && event.kind !== "rejection") throw new Error("Unsupported crash event kind");
  if (typeof event.id !== "string" || !event.id || event.id.length > 120) throw new Error("Crash event id is invalid");
  // Date.parse is not a validator. Its legacy fallback ignores anything inside
  // parentheses, so "2020-01-01 (arbitrary attacker text)" parses fine — and
  // the raw string was what got forwarded, the one field on the report that
  // skipped sanitizeDiagnosticValue. Forward the normalized instant instead.
  if (typeof event.timestamp !== "string") throw new Error("Crash timestamp is invalid");
  const timestamp = Date.parse(event.timestamp);
  if (!Number.isFinite(timestamp)) throw new Error("Crash timestamp is invalid");
  const context = event.context && typeof event.context === "object" && !Array.isArray(event.context)
    ? Object.fromEntries(Object.entries(event.context as Record<string, unknown>).slice(0, 32).map(([key, item]) => [
      sanitizeDiagnosticValue(key, 80),
      typeof item === "number" || typeof item === "boolean" || item === null
        ? item
        : sanitizeDiagnosticValue(item, 300),
    ]))
    : undefined;
  return {
    schema: "luma-crash/1",
    release: sanitizeDiagnosticValue(report.release, 100),
    edition: report.edition,
    event: {
      id: sanitizeDiagnosticValue(event.id, 120),
      kind: event.kind,
      timestamp: new Date(timestamp).toISOString(),
      message: sanitizeDiagnosticValue(event.message, 600),
      ...(event.stack ? { stack: sanitizeDiagnosticValue(event.stack, 4000) } : {}),
      ...(context ? { context } : {}),
    },
  };
}

export function resetCrashIngestRateLimitsForTests() {
  rateWindows.clear();
  globalWindow = { resetAt: 0, used: 0 };
  inFlight = 0;
}

export function OPTIONS(request: Request) {
  if (!allowedOrigin(request)) return json(request, { error: "Origin not allowed" }, 403);
  return respond(request, null, {
    status: 204,
    headers: {
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
      "access-control-max-age": "86400",
    },
  });
}

export async function POST(request: Request) {
  if (!allowedOrigin(request)) return json(request, { error: "Origin not allowed" }, 403);
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return json(request, { error: "Crash report is too large" }, 413);

  const now = Date.now();
  const retryAfter = inFlight >= MAX_IN_FLIGHT ? 2 : acquireGlobal(now) || acquire(clientKey(request), now);
  if (retryAfter) return respond(request, JSON.stringify({ error: "Crash report rate limit reached" }), {
    status: 429,
    headers: { "content-type": "application/json", "retry-after": String(retryAfter) },
  });
  inFlight++;
  try {
  let text: string;
  try { text = await readBoundedText(request, MAX_BODY_BYTES); }
  catch (error) {
    return json(request, { error: error instanceof UploadLimitError ? "Crash report is too large" : "Invalid or interrupted crash report" },
      error instanceof UploadLimitError ? 413 : error instanceof UploadTimeoutError ? 408 : 400);
  }
  let payload;
  try { payload = sanitizedPayload(JSON.parse(text)); } catch (error) {
    return json(request, { error: error instanceof Error ? error.message : "Invalid crash report" }, 400);
  }

  const destination = webhookUrl();
  if (!destination) return json(request, { error: "Crash collection is not configured" }, 503);
  const receiptId = crypto.randomUUID();
  let upstream: Response;
  try {
    upstream = await fetch(destination, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(process.env.LUMA_CRASH_WEBHOOK_TOKEN ? { authorization: `Bearer ${process.env.LUMA_CRASH_WEBHOOK_TOKEN}` } : {}),
      },
      body: JSON.stringify({ ...payload, receiptId, receivedAt: new Date().toISOString() }),
      signal: AbortSignal.timeout(4000),
      redirect: "error",
    });
  } catch {
    return json(request, { error: "Crash collector unavailable" }, 502);
  }
  if (!upstream.ok) return json(request, { error: "Crash collector rejected the report" }, 502);
  return json(request, { accepted: true, receiptId }, 202);
  } finally { inFlight--; }
}
