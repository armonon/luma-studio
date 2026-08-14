import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { asStudioCommand, listenForMenuCommands } from "../app/desktop/native-menu.ts";
import {
  DESKTOP_MENU,
  MENU_COMMAND_EVENT,
  menuCommands,
} from "../app/desktop/menu-model.ts";
import type { StudioCommand } from "../app/desktop/menu-model.ts";

// ---------------------------------------------------------------------------
// The menu exists twice: as data in app/desktop/menu-model.ts, and as the real
// native menu built in src-tauri/src/main.rs. It has to, because Tauri builds
// menus in Rust and the studio's behaviour lives in TypeScript.
//
// Two hand-maintained lists drift. These tests are the thing that stops them,
// and they are deliberately structural — an id present on one side and absent
// on the other is a structural fact, and a menu entry the user can click that
// reaches nothing is the failure being prevented.
// ---------------------------------------------------------------------------

const rust = readFileSync(new URL("../src-tauri/src/main.rs", import.meta.url), "utf8");

/** Every `item("id", "Label", accelerator)` the Rust menu builder declares. */
function rustMenuItems() {
  const body = /fn build_menu\(([\s\S]*?)\n}\n/.exec(rust);
  assert.ok(body, "build_menu not found — the native menu may have been removed");
  return [...body[1].matchAll(/item\("([a-z-]+)", "([^"]*)", (?:Some\("([^"]+)"\)|None)\)/g)]
    .map((match) => ({ id: match[1], label: match[2], accelerator: match[3] }));
}

test("every menu command is declared on both sides, in the same order", () => {
  const declared = rustMenuItems().map((entry) => entry.id);
  assert.deepEqual(declared, menuCommands(), "the Rust menu and the model disagree");
});

test("labels and accelerators match between the model and the native menu", () => {
  const native = new Map(rustMenuItems().map((entry) => [entry.id, entry]));
  for (const section of DESKTOP_MENU) {
    for (const item of section.items) {
      if (item.kind !== "command") continue;
      const counterpart = native.get(item.id);
      assert.ok(counterpart, `${item.id} is in the model but not in the native menu`);
      assert.equal(counterpart.label, item.label, `${item.id} label differs`);
      assert.equal(
        counterpart.accelerator,
        item.accelerator,
        `${item.id} accelerator differs`,
      );
    }
  }
});

test("the event name is the same string on both sides", () => {
  // The frontend listens for this and Rust emits it. A typo on either side is
  // a menu that silently does nothing at all.
  assert.match(rust, new RegExp(`MENU_COMMAND_EVENT: &str = "${MENU_COMMAND_EVENT}"`));
});

test("no command id appears twice", () => {
  const ids = menuCommands();
  assert.equal(new Set(ids).size, ids.length, "duplicate menu command");
});

test("the menu has no empty sections and no doubled separators", () => {
  for (const section of DESKTOP_MENU) {
    assert.ok(section.items.length > 0, `${section.label} is empty`);
    assert.notEqual(section.items[0].kind, "separator", `${section.label} opens with a separator`);
    assert.notEqual(
      section.items[section.items.length - 1].kind,
      "separator",
      `${section.label} ends with a separator`,
    );
    section.items.forEach((item, index) => {
      if (index === 0) return;
      assert.ok(
        !(item.kind === "separator" && section.items[index - 1].kind === "separator"),
        `${section.label} has two separators in a row at ${index}`,
      );
    });
  }
});

test("accelerators are unique, so two items cannot claim one chord", () => {
  const seen = new Map<string, StudioCommand>();
  for (const section of DESKTOP_MENU) {
    for (const item of section.items) {
      if (item.kind !== "command" || !item.accelerator) continue;
      const existing = seen.get(item.accelerator);
      assert.equal(existing, undefined, `${item.accelerator} is on both ${existing} and ${item.id}`);
      seen.set(item.accelerator, item.id);
    }
  }
});

test("accelerators are cross-platform, not hard-coded to one modifier", () => {
  // "Cmd+S" would work on macOS and be unreachable on Windows. Tauri resolves
  // CmdOrCtrl per platform, so the definition stays single.
  for (const section of DESKTOP_MENU) {
    for (const item of section.items) {
      if (item.kind !== "command" || !item.accelerator) continue;
      assert.doesNotMatch(
        item.accelerator,
        /(^|\+)(Cmd|Command|Ctrl|Control)\+/,
        `${item.id} uses a platform-specific modifier: ${item.accelerator}`,
      );
    }
  }
});

// --- the event bridge -------------------------------------------------------

type Listener = (message: { payload: unknown }) => void;

/** Stand in for Tauri's global, with control over when `listen` resolves. */
function fakeTauri() {
  let handler: Listener | null = null;
  let resolveListen: ((stop: () => void) => void) | null = null;
  let stopped = 0;
  const globalWindow = globalThis as unknown as { window?: unknown };
  const previous = globalWindow.window;
  globalWindow.window = {
    __TAURI__: {
      event: {
        listen: (_event: string, incoming: Listener) => new Promise<() => void>((resolve) => {
          handler = incoming;
          resolveListen = resolve;
        }),
      },
    },
  };
  return {
    fire: (payload: unknown) => handler?.({ payload }),
    settle: () => resolveListen?.(() => { stopped += 1; }),
    stopped: () => stopped,
    restore: () => { globalWindow.window = previous; },
  };
}

test("only ids this build knows about reach the studio", () => {
  // The payload crosses a process boundary as a bare string. An id the native
  // side declares but this build has no arm for would otherwise be handed
  // straight to an exhaustive switch.
  assert.equal(asStudioCommand("undo"), "undo");
  assert.equal(asStudioCommand("open"), "open");
  assert.equal(asStudioCommand("not-a-command"), null);
  assert.equal(asStudioCommand(""), null);
  assert.equal(asStudioCommand(42), null);
  assert.equal(asStudioCommand(null), null);
  assert.equal(asStudioCommand({ id: "undo" }), null);
});

test("menu commands dispatch, and unknown ones are dropped rather than thrown", () => {
  const tauri = fakeTauri();
  try {
    const seen: string[] = [];
    listenForMenuCommands((command) => seen.push(command));
    tauri.fire("undo");
    tauri.fire("nonsense");
    tauri.fire("zoom-fit");
    assert.deepEqual(seen, ["undo", "zoom-fit"]);
  } finally {
    tauri.restore();
  }
});

test("unsubscribing before the subscription resolves still tears it down", async () => {
  // `listen` is async and the caller is a synchronous effect cleanup, so a
  // fast unmount would otherwise leak a listener firing into a dead component.
  const tauri = fakeTauri();
  try {
    const stop = listenForMenuCommands(() => {});
    stop();
    tauri.settle();
    // The unlisten arrives in a `.then`, so give the microtask queue a turn.
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(tauri.stopped(), 1, "the late-arriving unlisten should have been called");
  } finally {
    tauri.restore();
  }
});

test("unsubscribing after the subscription resolves tears it down too", async () => {
  const tauri = fakeTauri();
  try {
    const stop = listenForMenuCommands(() => {});
    tauri.settle();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(tauri.stopped(), 0, "nothing should have stopped yet");
    stop();
    assert.equal(tauri.stopped(), 1);
  } finally {
    tauri.restore();
  }
});

test("outside Tauri the subscription is a no-op that still returns a teardown", () => {
  // The studio component mounts identically in both editions; the web build
  // must not have to branch around this.
  const globalWindow = globalThis as unknown as { window?: unknown };
  const previous = globalWindow.window;
  globalWindow.window = {};
  try {
    const stop = listenForMenuCommands(() => assert.fail("nothing should dispatch"));
    assert.equal(typeof stop, "function");
    stop();
  } finally {
    globalWindow.window = previous;
  }
});
