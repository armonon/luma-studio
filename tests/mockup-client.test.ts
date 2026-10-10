import test from "node:test";
import assert from "node:assert/strict";
import { MockupClient } from "../app/studio/mockup-client";
import { MOCKUP_SCENES } from "../app/engine/mockup-scenes";

const request = { scene: "tshirt" as const, size: 160, color: "#ffffff", placement: MOCKUP_SCENES[0].defaultPlacement, cache: true };
function setup() {
  const sent: { id: number; type: string }[] = [];
  let terminated = false;
  const worker = { postMessage: (message: typeof sent[number]) => sent.push(message), terminate: () => { terminated = true; }, onmessage: null, onerror: null, onmessageerror: null } as unknown as Worker;
  const client = new MockupClient(() => worker);
  const reply = (result?: unknown) => worker.onmessage!({ data: { id: sent.at(-1)!.id, ok: true, result } } as MessageEvent);
  return { client, worker, sent, reply, terminated: () => terminated };
}

test("worker preview returns complete pixels and disposal ignores late results", async () => {
  const { client, reply } = setup();
  const expected = { width: 160, height: 160, data: new Uint8ClampedArray(160 ** 2 * 4).fill(255), quad: [], printAspect: 1 };
  const render = client.render(request); reply(expected);
  assert.equal((await render).data.length, expected.data.length);
  const pending = client.render(request);
  const rejected = assert.rejects(pending, /closed/);
  client.dispose(); reply(expected); await rejected;
});

test("worker failure settles every request and rejects future requests until recreated", async () => {
  const { client, worker, terminated } = setup();
  const first = assert.rejects(client.render(request), /stopped/);
  const second = assert.rejects(client.setArt(null), /stopped/);
  worker.onerror!({} as ErrorEvent);
  await first; await second; assert.equal(terminated(), true);
  await assert.rejects(client.render(request), /Retry the preview/);
});

test("incomplete pixels are an actionable error rather than a blank canvas", async () => {
  const { client, reply } = setup();
  const rejected = assert.rejects(client.render(request), /incomplete/);
  reply({ width: 160, height: 160, data: new Uint8ClampedArray(0) });
  await rejected; client.dispose();
});

test("a silent worker has a bounded timeout and is released", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { client, terminated } = setup();
  const rejected = assert.rejects(client.render(request), /timed out/);
  t.mock.timers.tick(60000); await rejected;
  assert.equal(terminated(), true);
});

test("worker-unavailable fallback still produces a nonblank scene", async () => {
  const client = new MockupClient(() => { throw new Error("Unavailable"); });
  const result = await client.render(request);
  assert.equal(result.data.length, 160 ** 2 * 4);
  assert.equal(result.data[3], 255);
  assert.ok(result.data.some((v, i) => i % 4 !== 3 && v !== result.data[0]));
  client.dispose();
});
