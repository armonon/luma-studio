import { MENU_COMMAND_EVENT, OPEN_FILE_EVENT, menuCommands } from "./menu-model";
import type { StudioCommand } from "./menu-model";

type Unlisten = () => void;

type TauriWindow = Window & {
  __TAURI__?: {
    event?: {
      listen?: (
        event: string,
        handler: (message: { payload: unknown }) => void,
      ) => Promise<Unlisten>;
    };
    core?: { invoke?: (command: string, payload?: unknown) => Promise<unknown> };
  };
};

const KNOWN = new Set<string>(menuCommands());

/**
 * Narrow an id that arrived from the native menu.
 *
 * The payload crosses a process boundary as a bare string, so it is untrusted
 * in the ordinary way: the compiler cannot vouch for it, and an id the Rust
 * side declares but this build does not know about would otherwise be handed
 * to an exhaustive switch that has no arm for it.
 */
export function asStudioCommand(value: unknown): StudioCommand | null {
  return typeof value === "string" && KNOWN.has(value) ? (value as StudioCommand) : null;
}

/**
 * Subscribe to the desktop menu bar.
 *
 * Returns a teardown function, and is a no-op returning one anyway outside
 * Tauri — the studio component mounts identically in both editions, so the
 * caller should not have to branch.
 *
 * `listen` is async and the caller is a synchronous effect cleanup, so an
 * unsubscribe that arrives before the subscription resolves has to be
 * remembered rather than dropped; otherwise a fast unmount leaks a listener
 * that keeps firing into a dead component.
 */
export function listenForMenuCommands(dispatch: (command: StudioCommand) => void): Unlisten {
  return subscribe(MENU_COMMAND_EVENT, (payload) => {
    const command = asStudioCommand(payload);
    if (command) dispatch(command);
  });
}

function subscribe(event: string, handle: (payload: unknown) => void): Unlisten {
  const listen = (window as TauriWindow).__TAURI__?.event?.listen;
  if (!listen) return () => {};

  let cancelled = false;
  let unlisten: Unlisten | null = null;

  void listen(event, (message) => {
    handle(message.payload);
  }).then((stop) => {
    if (cancelled) stop();
    else unlisten = stop;
  }).catch(() => {
    // A menu that cannot subscribe is a menu that does nothing; the studio's
    // own keyboard shortcuts still work, so this must not take the app down.
  });

  return () => {
    cancelled = true;
    unlisten?.();
    unlisten = null;
  };
}

/**
 * Subscribe to documents the OS wants opened.
 *
 * A file double-clicked in the Finder, one passed on the command line, and one
 * chosen from Open Recent all arrive here — they are the same request, and
 * routing them through one channel is what stops Open Recent growing its own
 * half-working open path.
 */
export function listenForOpenFile(open: (path: string) => void): Unlisten {
  return subscribe(OPEN_FILE_EVENT, (payload) => {
    if (typeof payload === "string" && payload) open(payload);
  });
}

/** Hand the native menu the Open Recent list so it can rebuild the submenu. */
export function publishRecentFiles(files: readonly string[]) {
  const invoke = (window as TauriWindow).__TAURI__?.core?.invoke;
  // Outside Tauri there is no menu to update, and a rejected invoke must not
  // surface as an unhandled rejection while someone is opening a file.
  void invoke?.("set_recent_files", { files: [...files] })?.catch(() => {});
}
