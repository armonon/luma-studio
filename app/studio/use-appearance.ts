"use client";

import { useSyncExternalStore } from "react";

type Appearance = "dark" | "light";
const KEY = "luma-creatingco-appearance";
const CHANGE = "luma-appearance-change";
let fallback: Appearance = "dark";
let volatile: Appearance | null = null;

function read(): Appearance {
  if (volatile) return volatile;
  try { return window.localStorage.getItem(KEY) === "light" ? "light" : "dark"; }
  catch { return fallback; }
}

function subscribe(update: () => void) {
  const storage = (event: StorageEvent) => { if (event.key === KEY || event.key === null) { volatile = null; update(); } };
  window.addEventListener("storage", storage);
  window.addEventListener(CHANGE, update);
  return () => { window.removeEventListener("storage", storage); window.removeEventListener(CHANGE, update); };
}

export function useAppearance() {
  const appearance = useSyncExternalStore(subscribe, read, () => "dark" as Appearance);
  const setAppearance = (next: Appearance) => {
    fallback = next;
    try { window.localStorage.setItem(KEY, next); volatile = null; } catch { volatile = next; }
    window.dispatchEvent(new Event(CHANGE));
  };
  return [appearance, setAppearance] as const;
}
