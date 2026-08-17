import assert from "node:assert/strict";
import test from "node:test";
import { StartupOpenCoordinator } from "../app/studio/startup-open-coordinator.ts";

test("Finder files wait for recovery and then drain in arrival order", () => {
  const startup = new StartupOpenCoordinator();
  assert.equal(startup.route("/tmp/first.psd"), null);
  assert.equal(startup.route("/tmp/second.luma"), null);
  assert.deepEqual(startup.markReady(), ["/tmp/first.psd", "/tmp/second.luma"]);
  assert.deepEqual(startup.markReady(), []);
  assert.equal(startup.route("/tmp/live.psb"), "/tmp/live.psb");
});

test("duplicate startup events open once and reset starts a fresh gate", () => {
  const startup = new StartupOpenCoordinator();
  startup.route("/tmp/art.psd");
  startup.route("/tmp/art.psd");
  assert.deepEqual(startup.markReady(), ["/tmp/art.psd"]);
  startup.reset();
  assert.equal(startup.route("/tmp/next.psd"), null);
  assert.deepEqual(startup.markReady(), ["/tmp/next.psd"]);
});
