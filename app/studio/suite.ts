"use client";
/**
 * thecreateco suite kit integration (shared menu + Locker).
 *
 * The kit is one cross-origin script (https://thecreatingco.com/suite/v1/suite.js).
 * Luma must keep working without it — offline, blocked, or slow — so every
 * call here is guarded and nothing in the editor waits on it.
 */
import { useEffect, useRef, useSyncExternalStore } from "react";

export const SUITE_SCRIPT = "https://thecreatingco.com/suite/v1/suite.js";

export type LockerEntry = { id: string; name: string; type: string; size?: number; app?: string; created?: number; meta?: Record<string, unknown> };
export type LockerFile = LockerEntry & { blob: Blob };
type Locker = {
  save(input: { name: string; type: string; blob: Blob; meta?: Record<string, unknown> }): Promise<string>;
  onOpen(handler: (file: LockerFile) => void | Promise<void>): void;
};
type Tcc = { ready: Promise<Tcc>; locker: Locker; version?: string };
type TccWindow = Window & { TCC?: Tcc };

/** Insert the kit's script tag once (hosted web build only). */
export function useSuiteKit(enabled: boolean) {
  useEffect(() => {
    if (!enabled || typeof document === "undefined") return;
    if (document.querySelector(`script[src="${SUITE_SCRIPT}"]`)) return;
    const script = document.createElement("script");
    script.src = SUITE_SCRIPT;
    script.defer = true;
    script.dataset.app = "luma";
    // CORS mode (the kit sends ACAO *) so the offline copy kept by Luma's
    // service worker is a normal response, not an opaque one.
    script.crossOrigin = "anonymous";
    // A missing kit is expected offline; swallow the load error quietly.
    script.onerror = () => { script.dataset.failed = "true"; };
    document.head.appendChild(script);
  }, [enabled]);
}

export function currentTcc(): Tcc | null {
  if (typeof window === "undefined") return null;
  const tcc = (window as TccWindow).TCC;
  return tcc && tcc.locker && typeof tcc.locker.save === "function" ? tcc : null;
}

/** True once the kit has loaded; re-renders when it arrives. */
export function useLockerAvailable() {
  return useSyncExternalStore(
    (notify) => { window.addEventListener("tcc:ready", notify); return () => window.removeEventListener("tcc:ready", notify); },
    () => Boolean(currentTcc()),
    () => false,
  );
}

/**
 * Save straight from a click handler: on partitioned origins (Netlify drafts,
 * localhost) the kit opens a small first-party popup, which browsers only
 * allow during the user's gesture — so no awaits before calling this.
 */
export function saveToLocker(blob: Blob, name: string, meta?: Record<string, unknown>) {
  const tcc = currentTcc();
  if (!tcc) return Promise.reject(new Error("Locker isn't reachable right now (it loads from thecreatingco.com). Your file was still downloaded."));
  return tcc.locker.save({ name, type: blob.type || mimeForName(name), blob, meta: { from: "Luma", ...meta } });
}

/** Subscribe to files sent to Luma ("Send to Luma" / ?tcc-open=). */
export function useLockerOpen(enabled: boolean, handler: (file: LockerFile) => Promise<void>) {
  const latest = useRef(handler);
  useEffect(() => { latest.current = handler; });
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const register = (tcc: Tcc | null) => {
      if (!active || !tcc) return;
      // The kit replays a file that arrived before this handler registered.
      tcc.locker.onOpen(async (file) => { if (active) await latest.current(file); });
    };
    const ready = () => register(currentTcc());
    const tcc = currentTcc();
    if (tcc) tcc.ready.then(register).catch(() => {});
    else window.addEventListener("tcc:ready", ready, { once: true });
    return () => { active = false; window.removeEventListener("tcc:ready", ready); };
  }, [enabled]);
}

export function mimeForName(name: string) {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return ({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", svg: "image/svg+xml", pdf: "application/pdf", zip: "application/zip", luma: "application/x-luma-project", psd: "image/vnd.adobe.photoshop", psb: "image/vnd.adobe.photoshop", otf: "font/otf", ttf: "font/ttf" } as Record<string, string>)[ext] ?? "application/octet-stream";
}

export function isFontFile(file: { name: string; type: string }) {
  return /^font\/(otf|ttf|sfnt)$/.test(file.type) || /\.(otf|ttf)$/i.test(file.name);
}
