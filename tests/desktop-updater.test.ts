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
    return command === "check_desktop_update" ? update : null;
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
    beforeInstall: () => { order.push("checkpoint"); },
    onStatus: (message) => statuses.push(message),
  });
  assert.equal(installed.status, "installing");
  assert.deepEqual(calls, [
    { command: "check_desktop_update", payload: undefined },
    { command: "install_desktop_update", payload: { expectedVersion: "0.6.1" } },
  ]);
  assert.match(statuses.at(-1) ?? "", /Downloading and verifying/);
  assert.deepEqual(order, ["check_desktop_update", "consent", "checkpoint", "install_desktop_update"]);
});

test("desktop updater rejects malformed native metadata before consent or install", async () => {
  let confirmed = false;
  await assert.rejects(() => runDesktopUpdateFlow({
    invoke: async () => ({ version: "0.6.1" }),
    confirmInstall: () => { confirmed = true; return true; },
  }), /malformed version metadata/);
  assert.equal(confirmed, false);
});
