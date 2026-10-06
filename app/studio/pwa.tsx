"use client";
/**
 * Installable + offline Luma (see build/sw-template.js for the worker).
 *
 * - Registers /sw.js only on the hosted web build (not the desktop shell, not
 *   `next dev`), so local development and Tauri are unaffected.
 * - Two user-driven states, never a silent swap mid-edit:
 *     "ready offline" — shown once, after the first install finishes;
 *     "update available" — a new deploy is waiting; nothing activates until
 *     the user clicks Reload.
 * - `useInstallPrompt` exposes Chrome/Edge/Android's install prompt; Safari
 *   and Firefox never fire it, so the menu item simply does not appear there.
 */
import { useCallback, useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

function serviceWorkerAllowed() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return false;
  if ((window as Window & { __TAURI__?: unknown }).__TAURI__) return false;
  if (!/^https?:$/.test(location.protocol)) return false;
  if (process.env.NODE_ENV !== "production") return false;
  return location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1";
}

export function usePwaUpdate() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [offlineReady, setOfflineReady] = useState(false);

  useEffect(() => {
    if (!serviceWorkerAllowed()) return;
    let cancelled = false;
    // A controller at page load means this is a returning visitor; only then
    // is a newly installed worker an *update* rather than the first install.
    const hadController = Boolean(navigator.serviceWorker.controller);
    const track = (worker: ServiceWorker | null) => {
      if (!worker) return;
      const settle = () => {
        if (cancelled || worker.state !== "installed") return;
        if (hadController) setWaiting(worker);
        else setOfflineReady(true);
      };
      settle();
      worker.addEventListener("statechange", settle);
    };
    let reloading = false;
    const onControllerChange = () => {
      // Only reload when the user asked for the update.
      if (reloading || !sessionStorage.getItem("luma-sw-reload")) return;
      reloading = true;
      sessionStorage.removeItem("luma-sw-reload");
      location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    const start = () => navigator.serviceWorker.register("/sw.js", { scope: "/" }).then((registration) => {
      if (cancelled) return;
      if (registration.waiting && hadController) setWaiting(registration.waiting);
      track(registration.installing);
      registration.addEventListener("updatefound", () => track(registration.installing));
    }).catch((error) => console.warn("Offline support unavailable", error));
    // Let the editor finish its own startup before precaching in the background.
    const timer = window.setTimeout(start, 2500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  const reload = useCallback(() => {
    if (!waiting) return;
    sessionStorage.setItem("luma-sw-reload", "1");
    waiting.postMessage({ type: "SKIP_WAITING" });
  }, [waiting]);
  const dismiss = useCallback(() => { setWaiting(null); setOfflineReady(false); }, []);
  return { needRefresh: Boolean(waiting), offlineReady, reload, dismiss };
}

export function useInstallPrompt() {
  const [event, setEvent] = useState<BeforeInstallPromptEvent | null>(null);
  useEffect(() => {
    const capture = (e: Event) => { e.preventDefault(); setEvent(e as BeforeInstallPromptEvent); };
    const installed = () => setEvent(null);
    window.addEventListener("beforeinstallprompt", capture);
    window.addEventListener("appinstalled", installed);
    return () => {
      window.removeEventListener("beforeinstallprompt", capture);
      window.removeEventListener("appinstalled", installed);
    };
  }, []);
  const install = useCallback(async () => {
    if (!event) return;
    await event.prompt();
    await event.userChoice.catch(() => null);
    setEvent(null);
  }, [event]);
  return { canInstall: Boolean(event), install };
}

export function PwaToast({ needRefresh, offlineReady, reload, dismiss }: ReturnType<typeof usePwaUpdate>) {
  if (!needRefresh && !offlineReady) return null;
  return (
    <div className="luma-pwa-toast" role="status">
      <span>{needRefresh ? "A new version of Luma is ready." : "Luma now works offline on this device."}</span>
      {needRefresh && <button type="button" onClick={reload}>Reload</button>}
      <button type="button" className="luma-pwa-dismiss" onClick={dismiss} aria-label="Dismiss">×</button>
    </div>
  );
}
