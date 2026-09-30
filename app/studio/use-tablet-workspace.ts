"use client";

import { useSyncExternalStore } from "react";
import { TABLET_DRAW_KEY, tabletInterface } from "./tablet-input";
import { PHONE_DRAW_KEY, phoneInterface } from "./phone-workspace";

function subscribe(callback: () => void) {
  const query = window.matchMedia("(any-pointer: coarse)");
  query.addEventListener("change", callback);
  window.addEventListener("storage", callback);
  window.addEventListener("luma-tablet-preference", callback);
  window.addEventListener("resize", callback);
  return () => {
    query.removeEventListener("change", callback);
    window.removeEventListener("storage", callback);
    window.removeEventListener("luma-tablet-preference", callback);
    window.removeEventListener("resize", callback);
  };
}
function readTablet() {
  return tabletInterface(navigator.maxTouchPoints, window.matchMedia("(any-pointer: coarse)").matches,
    navigator.platform, new URLSearchParams(window.location.search).get("interface"));
}
function readPhone() {
  return phoneInterface(navigator.maxTouchPoints, window.matchMedia("(any-pointer: coarse)").matches,
    navigator.platform, screen.width, screen.height, new URLSearchParams(window.location.search).get("interface"));
}
const fingerFallback = new Map<string, boolean>();
function readFingerDrawing(key: string, defaultValue: boolean) {
  if (fingerFallback.has(key)) return fingerFallback.get(key)!;
  try { const value = localStorage.getItem(key); return value === null ? defaultValue : value === "true"; } catch { return defaultValue; }
}
export function useTabletWorkspace(forcePhone = false) {
  const detectedTablet = useSyncExternalStore(subscribe, readTablet, () => false);
  const detectedPhone = useSyncExternalStore(subscribe, readPhone, () => false);
  const phone = forcePhone || detectedPhone;
  const key = phone ? PHONE_DRAW_KEY : TABLET_DRAW_KEY;
  const drawWithTouch = useSyncExternalStore(subscribe, () => readFingerDrawing(key, phone), () => phone);
  const toggleFingerDrawing = () => {
    const next = !readFingerDrawing(key, phone);
    try { localStorage.setItem(key, String(next)); fingerFallback.delete(key); } catch { fingerFallback.set(key, next); }
    window.dispatchEvent(new Event("luma-tablet-preference"));
  };
  return { tablet: detectedTablet || phone, phone, drawWithTouch, toggleFingerDrawing };
}
