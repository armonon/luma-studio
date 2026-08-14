import { MENU_COMMAND_EVENT, menuCommands } from "./menu-model";
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
  const listen = (window as TauriWindow).__TAURI__?.event?.listen;
  if (!listen) return () => {};

  let cancelled = false;
  let unlisten: Unlisten | null = null;

  void listen(MENU_COMMAND_EVENT, (message) => {
    const command = asStudioCommand(message.payload);
    if (command) dispatch(command);
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
