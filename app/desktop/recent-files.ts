import { MAX_RECENT_FILES } from "./menu-model";

const STORAGE_KEY = "luma.recent-files.v1";

/**
 * The Open Recent list.
 *
 * The frontend owns it because only the frontend knows which opens actually
 * succeeded — a path that failed to parse should not persist as a suggestion.
 * The native side is told the whole list rather than being asked to track it,
 * which keeps the ordering rules in one place.
 */

/** Move `path` to the front, drop any earlier copy, and cap the length. */
export function withRecentFile(existing: readonly string[], path: string): string[] {
  const trimmed = path.trim();
  if (!trimmed) return [...existing];
  return [trimmed, ...existing.filter((entry) => entry !== trimmed)].slice(0, MAX_RECENT_FILES);
}

/** Read the stored list, tolerating anything that is not the shape expected. */
export function loadRecentFiles(storage: Pick<Storage, "getItem"> | null): string[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Written by an older build, or edited by hand: keep the strings, drop the
    // rest, rather than throwing on the way into the app.
    return parsed.filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
      .slice(0, MAX_RECENT_FILES);
  } catch {
    return [];
  }
}

export function saveRecentFiles(storage: Pick<Storage, "setItem"> | null, files: readonly string[]) {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(files.slice(0, MAX_RECENT_FILES)));
  } catch {
    // A full or disabled store must not break opening a document.
  }
}
