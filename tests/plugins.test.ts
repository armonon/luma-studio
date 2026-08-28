import assert from "node:assert/strict";
import test from "node:test";
import {
  LUMA_API_VERSION,
  Studio,
  isCompatibleApiVersion,
  type LumaPlugin,
} from "../app/engine/studio.ts";
import {
  createDeclarativePlugin,
  parseLumaPluginPackage,
} from "../app/engine/plugin-package.ts";

// Studio is DOM-optional: render and export need a canvas, but document,
// history and plugin work do not. A bare stub is enough for these.
function studio() {
  return new Studio(64, 48, {} as HTMLCanvasElement);
}

function plugin(id: string, overrides: Partial<LumaPlugin> = {}): LumaPlugin {
  return { id, name: id, activate: () => undefined, ...overrides };
}

test("register / list / unregister round-trips", () => {
  const s = studio();
  const off = s.registerPlugin(plugin("a", { name: "Alpha", version: "1.2.3" }));
  assert.deepEqual(s.listPlugins(), [{ id: "a", name: "Alpha", version: "1.2.3" }]);
  off();
  assert.deepEqual(s.listPlugins(), []);
  s.dispose();
});

test("listPlugins never leaks the plugin object or its dispose handle", () => {
  const s = studio();
  s.registerPlugin(plugin("a", { activate: () => () => {} }));
  const [entry] = s.listPlugins() as unknown as Array<Record<string, unknown>>;
  assert.deepEqual(Object.keys(entry).sort(), ["id", "name", "version"]);
  assert.equal("activate" in entry, false);
  assert.equal("dispose" in entry, false);
  s.dispose();
});

test("duplicate ids are rejected", () => {
  const s = studio();
  s.registerPlugin(plugin("dup"));
  assert.throws(() => s.registerPlugin(plugin("dup")), /already registered/i);
  s.dispose();
});

test("a plugin whose dispose throws can still be unregistered", () => {
  const s = studio();
  s.registerPlugin(plugin("bad", {
    activate: () => () => { throw new Error("boom"); },
  }));

  // The throw must not prevent removal, and must not be re-thrown at the
  // caller — otherwise the plugin is wedged in the map forever and every
  // retry fails at the same line.
  assert.doesNotThrow(() => s.unregisterPlugin("bad"));
  assert.deepEqual(s.listPlugins(), [], "plugin must be gone despite the throw");
  s.dispose();
});

test("one plugin's throwing dispose does not strand the others", () => {
  const s = studio();
  const disposed: string[] = [];
  s.registerPlugin(plugin("first", { activate: () => () => { disposed.push("first"); } }));
  s.registerPlugin(plugin("bad", { activate: () => () => { throw new Error("boom"); } }));
  s.registerPlugin(plugin("last", { activate: () => () => { disposed.push("last"); } }));

  assert.doesNotThrow(() => s.dispose());
  assert.deepEqual(
    disposed.sort(),
    ["first", "last"],
    "plugins after the throwing one must still be disposed",
  );
});

test("a throwing dispose does not leak subscribers on teardown", () => {
  const s = studio();
  let notified = 0;
  s.subscribe(() => { notified += 1; });
  s.registerPlugin(plugin("bad", { activate: () => () => { throw new Error("boom"); } }));

  s.dispose();
  const before = notified;
  // After dispose, nothing should still be wired to this Studio. Registering
  // would emit; if subscribers survived teardown the count moves.
  s.registerPlugin(plugin("later"));
  assert.equal(notified, before, "subscribers must be cleared even if a dispose threw");
});

test("a plugin whose activate throws is not registered", () => {
  const s = studio();
  assert.throws(() => s.registerPlugin(plugin("explodes", {
    activate: () => { throw new Error("nope"); },
  })));
  assert.deepEqual(s.listPlugins(), []);
  // The id must remain claimable after a failed activation.
  assert.doesNotThrow(() => s.registerPlugin(plugin("explodes")));
  s.dispose();
});

test("isCompatibleApiVersion treats the 0.x minor as the breaking axis", () => {
  assert.equal(isCompatibleApiVersion("0.3", "0.3"), true);
  assert.equal(isCompatibleApiVersion("0.3.9", "0.3.1"), true, "patch is not breaking");
  assert.equal(isCompatibleApiVersion(" 0.3 ", "0.3"), true, "whitespace tolerated");
  assert.equal(isCompatibleApiVersion("0.2", "0.3"), false);
  assert.equal(isCompatibleApiVersion("1.0", "0.3"), false);
});

test("a plugin targeting a different API version is rejected at register time", () => {
  const s = studio();
  assert.throws(
    () => s.registerPlugin(plugin("stale", { apiVersion: "0.1" })),
    /targets Luma API 0\.1/,
  );
  assert.deepEqual(s.listPlugins(), []);
  s.dispose();
});

test("a plugin targeting the current API version registers", () => {
  const s = studio();
  assert.doesNotThrow(() => s.registerPlugin(plugin("ok", { apiVersion: LUMA_API_VERSION })));
  assert.equal(s.listPlugins().length, 1);
  s.dispose();
});

test("apiVersion is optional and omitting it still registers", () => {
  const s = studio();
  assert.doesNotThrow(() => s.registerPlugin(plugin("legacy")));
  s.dispose();
});

test("declarative plugin packages install actions without executing code", () => {
  const pkg = parseLumaPluginPackage(JSON.stringify({
    schema: "luma-plugin/1",
    manifest: { id: "pro.detail", name: "Pro Detail", version: "1.0.0", apiVersion: LUMA_API_VERSION },
    actions: [{
      name: "Editorial Detail",
      steps: [
        { op: "convertSmartObject" },
        { op: "addSmartFilter", kind: "high-pass", params: { radius: 3 } },
      ],
    }],
  }));
  const s = studio();
  s.actions.start("Local action");
  s.actions.stop();
  s.registerPlugin(createDeclarativePlugin(pkg));
  assert.deepEqual(s.actions.list().map((action) => action.name), ["Local action", "Editorial Detail"]);
  assert.equal(s.actions.list()[1].sourcePluginId, "pro.detail");
  s.actions.fromJSON(JSON.stringify([{ name: "Project action", steps: [] }, s.actions.list()[1]]));
  assert.deepEqual(
    s.actions.list().map((action) => action.name),
    ["Project action", "Editorial Detail"],
    "opening a project preserves the live plugin action without duplicating its serialized copy",
  );
  s.unregisterPlugin("pro.detail");
  assert.deepEqual(s.actions.list().map((action) => action.name), ["Project action"], "unloading removes only contributed actions");
  s.dispose();
});

test("declarative packages reject unsafe or malformed action payloads", () => {
  const base = {
    schema: "luma-plugin/1",
    manifest: { id: "safe.plugin", name: "Safe", version: "1.0.0", apiVersion: LUMA_API_VERSION },
  };
  assert.throws(() => parseLumaPluginPackage(JSON.stringify({
    ...base,
    actions: [{ name: "Run code", steps: [{ op: "eval", source: "alert(1)" }] }],
  })), /unsupported operation/);
  assert.throws(() => parseLumaPluginPackage(JSON.stringify({
    ...base,
    actions: [{ name: "Bad filter", steps: [{ op: "addSmartFilter", kind: "unknown", params: {} }] }],
  })), /filter kind/);
  assert.throws(() => parseLumaPluginPackage(JSON.stringify({
    ...base,
    actions: [{ name: "NaN blur", steps: [{ op: "blur", radius: "lots" }] }],
  })), /finite number/);
});

test("a plugin package cannot parse into an action its own installer would refuse", () => {
  // Two validators guarded the same data and had drifted apart. validateStep
  // asks only that a step's numbers be finite; isSafeAction, which the action
  // recorder enforces at install time, bounds each one. A blur of radius 1e9
  // therefore parsed as a valid package and only blew up midway through
  // activation, where the failure is far harder to attribute.
  const packageJson = (steps: unknown[]) => JSON.stringify({
    schema: "luma-plugin/1",
    manifest: { id: "range.demo", name: "Range Demo", version: "1.0.0", apiVersion: LUMA_API_VERSION },
    actions: [{ name: "Out of range", steps }],
  });

  assert.throws(() => parseLumaPluginPackage(packageJson([{ op: "blur", radius: 1e9 }])), /out of range/);
  assert.throws(() => parseLumaPluginPackage(packageJson([{ op: "hue", degrees: 1e12 }])), /out of range/);
  assert.throws(() => parseLumaPluginPackage(packageJson([{ op: "sharpen", radius: 4, amount: 500 }])), /out of range/);
  // The same ops stay parseable at sane values.
  assert.doesNotThrow(() => parseLumaPluginPackage(packageJson([{ op: "blur", radius: 8 }])));
});

test("a plugin that fails partway through activation leaves nothing installed", () => {
  // activate() installs actions in a loop, and install() validates, so it can
  // refuse one partway down the list. The earlier actions stayed installed
  // while the teardown that would have removed them was never returned — a
  // half-live plugin with no way to unload it.
  const pkg = parseLumaPluginPackage(JSON.stringify({
    schema: "luma-plugin/1",
    manifest: { id: "partial.demo", name: "Partial", version: "1.0.0", apiVersion: LUMA_API_VERSION },
    actions: [
      { name: "First", steps: [{ op: "desaturate", amount: 1 }] },
      { name: "Second", steps: [{ op: "blur", radius: 8 }] },
    ],
  }));

  const s = studio();
  const install = s.actions.install.bind(s.actions);
  let installs = 0;
  s.actions.install = ((action, sourcePluginId) => {
    installs += 1;
    if (installs === 2) throw new Error("simulated refusal on the second action");
    return install(action, sourcePluginId);
  }) as typeof s.actions.install;

  assert.throws(() => createDeclarativePlugin(pkg).activate(s), /simulated refusal/);
  assert.deepEqual(s.actions.list(), [], "the first action must not survive the failed activation");
  s.dispose();
});
