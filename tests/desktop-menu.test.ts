import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  asStudioCommand,
  listenForMenuCommands,
  listenForOpenFile,
  publishRecentFiles,
} from "../app/desktop/native-menu.ts";
import {
  loadRecentFiles,
  saveRecentFiles,
  withRecentFile,
} from "../app/desktop/recent-files.ts";
import {
  DESKTOP_MENU,
  MAX_RECENT_FILES,
  MENU_COMMAND_EVENT,
  OPEN_FILE_EVENT,
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
const studioPage = readFileSync(new URL("../app/studio/studio-client.tsx", import.meta.url), "utf8");

test("Cocoa termination is intercepted before Tao's non-cancellable termination notification", () => {
  const guard = readFileSync(new URL("../src-tauri/src/termination.rs", import.meta.url), "utf8");
  assert.match(rust, /termination::install\(app.handle\(\)\)/);
  assert.match(guard, /sel!\(applicationShouldTerminate:\)/);
  assert.match(guard, /request_exit_confirmation\(app\)/);
  assert.match(guard, /ALLOW_APP_EXIT.load/);
  assert.match(guard, /0 \/\/ NSTerminateCancel/);
  assert.match(studioPage, /if \(!startupReadyRef.current\) \{ void cancelNativeClose\(\)/);
  assert.match(studioPage, /if \(!startupReadyRef.current \|\| projectSavingRef.current \|\| nativeOpeningRef.current\) return/);
});

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

test("the event names are the same strings on both sides", () => {
  // The frontend listens for these and Rust emits them. A typo on either side
  // is a menu, or a double-clicked document, that silently does nothing.
  assert.match(rust, new RegExp(`MENU_COMMAND_EVENT: &str = "${MENU_COMMAND_EVENT}"`));
  assert.match(rust, new RegExp(`OPEN_FILE_EVENT: &str = "${OPEN_FILE_EVENT}"`));
});

test("the recent-file cap is the same number on both sides", () => {
  // Rust truncates the list it is given and TypeScript truncates before
  // sending. Disagreeing means the menu quietly holds fewer than the app
  // remembers, or the app persists entries the menu will never show.
  assert.match(rust, new RegExp(`MAX_RECENT_FILES: usize = ${MAX_RECENT_FILES};`));
});

test("recent-file menu ids are namespaced away from the fixed commands", () => {
  // A path is not a command. Without a prefix a document called "undo" would
  // be indistinguishable from the Undo item.
  const prefix = /RECENT_FILE_PREFIX: &str = "([^"]+)"/.exec(rust);
  assert.ok(prefix, "the prefix constant is what keeps paths and commands apart");
  assert.match(rust, new RegExp(`strip_prefix\\(RECENT_FILE_PREFIX\\)`),
    "and the handler has to actually use it to route them");
  for (const command of menuCommands()) {
    assert.ok(!command.startsWith(prefix[1]), `${command} collides with the recent-file namespace`);
  }
});

test("the file associations cover the formats the app can open", () => {
  const config = JSON.parse(
    readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"),
  ) as { bundle: { fileAssociations?: Array<{ ext: string[] }> } };
  const associations = config.bundle.fileAssociations ?? [];
  const extensions = new Set(associations.flatMap((entry) => entry.ext));
  // Registering a type the app cannot open is worse than not registering it:
  // the OS hands us the document and we fail in front of the user.
  for (const ext of ["luma", "psd", "psb", "png", "jpg", "webp"]) {
    assert.ok(extensions.has(ext), `${ext} should open in Luma but is not associated`);
  }
});

test("local macOS bundles receive a complete ad-hoc signature", () => {
  const config = JSON.parse(
    readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"),
  ) as { bundle: { macOS?: { signingIdentity?: string } } };
  const bundle = config.bundle;
  assert.equal(bundle.macOS?.signingIdentity, "-");
});

test("packaged configuration excludes localhost while development opts in explicitly", () => {
  const config = JSON.parse(
    readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"),
  ) as { build: { devUrl?: string; beforeDevCommand?: string }; app: { security: { csp: string } }; bundle: { createUpdaterArtifacts?: boolean }; plugins?: { updater?: { pubkey?: string; endpoints?: string[] } } };
  const development = JSON.parse(
    readFileSync(new URL("../src-tauri/tauri.dev.conf.json", import.meta.url), "utf8"),
  ) as { build: { devUrl?: string; beforeDevCommand?: string }; app: { security: { csp: string } } };
  assert.equal(config.build.devUrl, undefined);
  assert.equal(config.build.beforeDevCommand, undefined);
  assert.doesNotMatch(config.app.security.csp, /localhost:3000/);
  assert.notEqual(config.bundle.createUpdaterArtifacts, true, "unsigned local builds cannot request updater artifacts");
  assert.equal(config.plugins?.updater?.pubkey, "", "local builds keep the updater inert without a fake signing key");
  assert.deepEqual(config.plugins?.updater?.endpoints, []);
  assert.equal(development.build.devUrl, "http://localhost:3000");
  assert.match(development.app.security.csp, /localhost:3000/);
});

test("web, native shell, and packaged app share one release version", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
  const tauri = JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8")) as { version: string };
  const cargo = readFileSync(new URL("../src-tauri/Cargo.toml", import.meta.url), "utf8");
  const cargoVersion = /^version = "([^"]+)"$/m.exec(cargo)?.[1];
  assert.match(pkg.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  assert.equal(tauri.version, pkg.version);
  assert.equal(cargoVersion, pkg.version);
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

test("native accelerators do not also activate single-letter tools", () => {
  const modifierGuard = studioPage.indexOf("if (e.metaKey || e.ctrlKey || e.altKey) return;");
  const toolLookup = studioPage.indexOf("const t = resolveToolKey(", modifierGuard);
  assert.ok(modifierGuard >= 0 && toolLookup > modifierGuard, "modifier guard must precede tool lookup");
  assert.match(
    studioPage,
    /\(e\.key === "\[" \|\| e\.key === "\]"\) && !e\.metaKey && !e\.ctrlKey && !e\.altKey/,
  );
});

test("secondary desktop dialogs have working Escape dismissal paths", () => {
  assert.match(studioPage, /e\.key === "Escape" && showFilters/);
  assert.match(studioPage, /e\.key === "Escape" && showBatch && !batchProgress/);
});

test("native update installation cannot bypass unsaved-document protection", () => {
  const command = studioPage.indexOf('case "check-for-updates"');
  const initialDirtyGuard = studioPage.indexOf("studio?.dirtyDocuments().length", command);
  const updateFlow = studioPage.indexOf("runDesktopUpdateFlow", initialDirtyGuard);
  const consentDirtyGuard = studioPage.indexOf("studio?.dirtyDocuments().length", updateFlow);
  const confirmation = studioPage.indexOf("window.confirm", consentDirtyGuard);
  const recoveryCheckpoint = studioPage.indexOf("studio.checkpointForRestart(writeRecoveryWorkspace)", confirmation);
  const installLock = studioPage.indexOf("desktopUpdateInstallingRef.current = locked", updateFlow);
  assert.ok(command >= 0 && initialDirtyGuard > command && updateFlow > initialDirtyGuard,
    "the update flow must refuse to start while any document is dirty");
  assert.ok(consentDirtyGuard > updateFlow && confirmation > consentDirtyGuard,
    "documents must be checked again after the network request and before install consent");
  assert.ok(recoveryCheckpoint > confirmation && installLock > updateFlow && installLock < confirmation,
    "update phases must lock editing and the engine must revalidate the workspace checkpoint");
});

// --- the event bridge -------------------------------------------------------

type Listener = (message: { payload: unknown }) => void;

/** Stand in for Tauri's global, with control over when `listen` resolves. */
function fakeTauri(pendingFiles: string[] = []) {
  const handlers = new Map<string, Listener>();
  let resolveListen: ((stop: () => void) => void) | null = null;
  let stopped = 0;
  const invokes: string[] = [];
  const globalWindow = globalThis as unknown as { window?: unknown };
  const previous = globalWindow.window;
  globalWindow.window = {
    __TAURI__: {
      event: {
        listen: (event: string, incoming: Listener) => new Promise<() => void>((resolve) => {
          handlers.set(event, incoming);
          resolveListen = resolve;
        }),
      },
      core: {
        invoke: async (command: string) => {
          invokes.push(command);
          if (command === "take_pending_open_files") return pendingFiles.splice(0);
          return undefined;
        },
      },
    },
  };
  return {
    fire: (payload: unknown, event: string = MENU_COMMAND_EVENT) => handlers.get(event)?.({ payload }),
    settle: () => resolveListen?.(() => { stopped += 1; }),
    stopped: () => stopped,
    invokes: () => [...invokes],
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

// --- open recent ------------------------------------------------------------

test("opening a document moves it to the front without duplicating it", () => {
  let list = withRecentFile([], "/a.psd");
  list = withRecentFile(list, "/b.psd");
  assert.deepEqual(list, ["/b.psd", "/a.psd"], "newest first");

  list = withRecentFile(list, "/a.psd");
  assert.deepEqual(list, ["/a.psd", "/b.psd"], "reopening moves it up rather than adding a second entry");
});

test("the recent list is capped, and the oldest falls off the end", () => {
  let list: string[] = [];
  for (let index = 0; index < MAX_RECENT_FILES + 5; index += 1) list = withRecentFile(list, `/doc-${index}.psd`);
  assert.equal(list.length, MAX_RECENT_FILES);
  assert.equal(list[0], `/doc-${MAX_RECENT_FILES + 4}.psd`, "the newest is first");
  assert.ok(!list.includes("/doc-0.psd"), "the oldest has fallen off");
});

test("an empty path is not a document and never joins the list", () => {
  assert.deepEqual(withRecentFile(["/a.psd"], ""), ["/a.psd"]);
  assert.deepEqual(withRecentFile(["/a.psd"], "   "), ["/a.psd"]);
});

test("a stored list survives being garbage", () => {
  // Written by an older build, or edited by hand. Recents are a convenience;
  // none of this may throw on the way into the app.
  const read = (raw: string | null) => loadRecentFiles({ getItem: () => raw });
  assert.deepEqual(read(null), []);
  assert.deepEqual(read("not json"), []);
  assert.deepEqual(read('{"not":"an array"}'), []);
  assert.deepEqual(read('["/a.psd", 42, null, "", "/b.psd"]'), ["/a.psd", "/b.psd"],
    "the strings survive and the rest is dropped");
  assert.equal(read(JSON.stringify(Array.from({ length: 50 }, (_, i) => `/d${i}`))).length, MAX_RECENT_FILES);
});

test("storage that refuses to co-operate does not break opening a document", () => {
  const hostile = {
    getItem: () => { throw new Error("disabled"); },
    setItem: () => { throw new Error("quota"); },
  };
  assert.deepEqual(loadRecentFiles(hostile), []);
  assert.doesNotThrow(() => saveRecentFiles(hostile, ["/a.psd"]));
  // No storage at all is the headless and web-SSR case.
  assert.deepEqual(loadRecentFiles(null), []);
  assert.doesNotThrow(() => saveRecentFiles(null, ["/a.psd"]));
});

test("a file the OS asks us to open arrives as a path", () => {
  const tauri = fakeTauri();
  try {
    const opened: string[] = [];
    listenForOpenFile((path) => opened.push(path));
    tauri.fire("/Users/someone/Artwork.psd", OPEN_FILE_EVENT);
    // A payload that is not a usable path is dropped rather than opened.
    tauri.fire("", OPEN_FILE_EVENT);
    tauri.fire(42, OPEN_FILE_EVENT);
    assert.deepEqual(opened, ["/Users/someone/Artwork.psd"]);
  } finally {
    tauri.restore();
  }
});

test("cold-launch files drain only after the live listener is installed", async () => {
  const tauri = fakeTauri(["/tmp/cold.psd", "", "/tmp/cold.luma"]);
  try {
    const opened: string[] = [];
    listenForOpenFile((path) => opened.push(path));
    assert.deepEqual(opened, [], "the native queue must not drain before listen resolves");
    assert.deepEqual(tauri.invokes(), []);
    tauri.settle();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(tauri.invokes(), ["take_pending_open_files"]);
    assert.deepEqual(opened, ["/tmp/cold.psd", "/tmp/cold.luma"]);
    tauri.fire("/tmp/live.psb", OPEN_FILE_EVENT);
    assert.deepEqual(opened, ["/tmp/cold.psd", "/tmp/cold.luma", "/tmp/live.psb"]);
  } finally {
    tauri.restore();
  }
});

test("an unmounted open listener ignores a late cold-launch drain", async () => {
  const tauri = fakeTauri(["/tmp/cold.psd"]);
  try {
    const opened: string[] = [];
    const stop = listenForOpenFile((path) => opened.push(path));
    tauri.settle();
    await Promise.resolve();
    stop();
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(opened, []);
  } finally {
    tauri.restore();
  }
});

test("menu commands and opened files do not arrive on each other's channel", () => {
  // Both are subscriptions on the same bus. Crossing them would make every
  // Open Recent pick look like an unknown command, and silently do nothing.
  const tauri = fakeTauri();
  try {
    const commands: string[] = [];
    const opened: string[] = [];
    listenForMenuCommands((command) => commands.push(command));
    listenForOpenFile((path) => opened.push(path));
    tauri.fire("undo", MENU_COMMAND_EVENT);
    tauri.fire("/tmp/a.psd", OPEN_FILE_EVENT);
    assert.deepEqual(commands, ["undo"]);
    assert.deepEqual(opened, ["/tmp/a.psd"]);
  } finally {
    tauri.restore();
  }
});

test("publishing the recent list outside Tauri is a silent no-op", () => {
  const globalWindow = globalThis as unknown as { window?: unknown };
  const previous = globalWindow.window;
  globalWindow.window = {};
  try {
    assert.doesNotThrow(() => publishRecentFiles(["/a.psd"]));
  } finally {
    globalWindow.window = previous;
  }
});

test("a rejected publish does not surface as an unhandled rejection", () => {
  // It fires while someone is opening a document; a failed menu rebuild must
  // not become a crash in the middle of that.
  const globalWindow = globalThis as unknown as { window?: unknown };
  const previous = globalWindow.window;
  globalWindow.window = {
    __TAURI__: { core: { invoke: () => Promise.reject(new Error("no menu")) } },
  };
  try {
    assert.doesNotThrow(() => publishRecentFiles(["/a.psd"]));
  } finally {
    globalWindow.window = previous;
  }
});
