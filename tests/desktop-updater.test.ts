import assert from "node:assert/strict";
import test from "node:test";
import { runDesktopUpdateFlow } from "../app/desktop/desktop-updater.ts";

test("desktop updater distinguishes unavailable and current builds", async () => {
  assert.deepEqual(await runDesktopUpdateFlow({ invoke: undefined }), { status: "unavailable" });
  assert.deepEqual(await runDesktopUpdateFlow({ invoke: async () => null }), { status: "current" });
  assert.deepEqual(await runDesktopUpdateFlow({
    invoke: async () => { throw new Error("Update service unavailable: empty endpoints"); },
  }), { status: "unavailable" });
});

test("desktop updater requires consent and installs the exact checked version", async () => {
  const calls: Array<{ command: string; payload?: Record<string, unknown> }> = [];
  const update = { currentVersion: "0.6.0", version: "0.6.1", date: "2026-08-25", body: "Safety fixes" };
  const invoke = async (command: string, payload?: Record<string, unknown>) => {
    calls.push({ command, payload });
    return command === "check_desktop_update" ? update : command === "prepare_desktop_update" ? "1" : null;
  };
  const cancelled = await runDesktopUpdateFlow({ invoke, confirmInstall: () => false });
  assert.equal(cancelled.status, "cancelled");
  assert.deepEqual(calls.map((call) => call.command), ["check_desktop_update"]);

  calls.length = 0;
  const statuses: string[] = [];
  const order: string[] = [];
  const installed = await runDesktopUpdateFlow({
    invoke: async (command, payload) => { order.push(command); return invoke(command, payload); },
    confirmInstall: () => { order.push("consent"); return true; },
    beforeInstall: () => { order.push("checkpoint"); return () => {}; },
    onStatus: (message) => statuses.push(message),
  });
  assert.equal(installed.status, "installing");
  assert.deepEqual(calls, [
    { command: "check_desktop_update", payload: undefined },
    { command: "prepare_desktop_update", payload: { expectedVersion: "0.6.1" } },
    { command: "install_desktop_update", payload: { token: "1" } },
  ]);
  assert.match(statuses.at(-1) ?? "", /Installing verified/);
  assert.deepEqual(order, ["check_desktop_update", "consent", "prepare_desktop_update", "checkpoint", "install_desktop_update"]);
});

test("updater rejects malformed values instead of reporting an up-to-date build", async () => {
  for (const value of [undefined, false, 0, "", [], {}, { currentVersion: "", version: "x" },
    { currentVersion: "0.6.0", version: "0.6.1\n" }]) {
    await assert.rejects(runDesktopUpdateFlow({ invoke: async () => value }), /malformed version metadata/);
  }
});

test("updater serializes checks and never unlocks another running flow", async () => {
  let finish!: (value: null) => void;
  const first = runDesktopUpdateFlow({ invoke: () => new Promise(resolve => { finish = resolve; }) });
  let invoked = false, phaseChanged = false;
  assert.deepEqual(await runDesktopUpdateFlow({ invoke: async () => { invoked = true; }, onPhase: () => { phaseChanged = true; } }), { status: "busy" });
  assert.equal(invoked, false); assert.equal(phaseChanged, false);
  finish(null); assert.deepEqual(await first, { status: "current" });
  assert.deepEqual(await runDesktopUpdateFlow({ invoke: async () => null }), { status: "current" });
});

for (const failure of ["prepare_desktop_update", "checkpoint", "install_desktop_update"]) {
  test(`updater retains the workspace and permits retry after ${failure} failure`, async () => {
    const calls: string[] = [], phases: string[] = [];
    await assert.rejects(runDesktopUpdateFlow({
      invoke: async command => {
        calls.push(command);
        if (command === failure) throw new Error(`Injected ${failure} failure`);
        if (command === "check_desktop_update") return { currentVersion: "0.6.0", version: "0.6.1" };
        if (command === "prepare_desktop_update") return "42";
        return null;
      },
      confirmInstall: () => true,
      beforeInstall: () => { calls.push("checkpoint"); if (failure === "checkpoint") throw new Error("Injected checkpoint failure"); return () => {}; },
      onPhase: phase => phases.push(phase),
    }), /Injected/);
    assert.equal(phases.at(-1), "idle");
    if (failure !== "install_desktop_update") assert.ok(!calls.includes("install_desktop_update"));
    if (failure !== "prepare_desktop_update") assert.equal(calls.at(-1), "discard_desktop_update");
    assert.deepEqual(await runDesktopUpdateFlow({ invoke: async () => null }), { status: "current" });
  });
}

test("updater refuses installation without a checkpoint owner", async () => {
  const calls: string[] = [];
  await assert.rejects(runDesktopUpdateFlow({ invoke: async command => { calls.push(command); return { currentVersion: "0.6.0", version: "0.6.1" }; }, confirmInstall: () => true }), /protected workspace checkpoint/);
  assert.deepEqual(calls, ["check_desktop_update"]);
});

test("desktop updater rejects malformed native metadata before consent or install", async () => {
  let confirmed = false;
  await assert.rejects(() => runDesktopUpdateFlow({
    invoke: async () => ({ version: "0.6.1" }),
    confirmInstall: () => { confirmed = true; return true; },
  }), /malformed version metadata/);
  assert.equal(confirmed, false);
});
