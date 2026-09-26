import assert from "node:assert/strict";
import test from "node:test";
import type { Studio } from "../app/engine/studio.ts";
import { runBatch } from "../app/engine/batch.ts";
import type { BatchRuntime } from "../app/engine/batch.ts";
import JSZip from "jszip";

function runtime(overrides: Partial<BatchRuntime> = {}): BatchRuntime {
  return {
    loadImage: async () => ({ naturalWidth: 4, naturalHeight: 4 }) as HTMLImageElement,
    createStudio: () => ({ openImage: () => ({ id: "layer" }), dispose: () => {}, replay: () => {} }) as unknown as Studio,
    encodePng: async () => new Blob(["png"]),
    ...overrides,
  };
}

test("batch stops at retained-output budget and archives completed files with an honest report", async () => {
  let disposed = 0;
  const statuses: string[] = [];
  const result = await runBatch(["a", "b", "c"].map(name => new File([name], `${name}.png`)), null, undefined, runtime({
    createStudio: () => ({ openImage: () => ({ id: "x" }), dispose: () => { disposed++; } }) as unknown as Studio,
  }), { maxOutputBytes: 4, onItem: (i, status) => { statuses[i] = status; } });
  assert.deepEqual(statuses, ["succeeded", "failed", "skipped"]);
  assert.equal(disposed, 2);
  assert.equal(result.succeeded, 1);
  assert.equal(result.skipped, 1);
  assert.match(result.stoppedReason!, /safety limit/);
  const zip = await JSZip.loadAsync(await result.archive.arrayBuffer());
  assert.ok(zip.file("a.png"));
  assert.equal(zip.file("b.png"), null);
  const report = JSON.parse(await zip.file("luma-batch-report.json")!.async("string"));
  assert.equal(report.failed.length, 1);
  assert.equal(report.outputBytes, 3);
});

test("cancelling during decode prevents edits and skips remaining inputs", async () => {
  const controller = new AbortController();
  let decoded = 0;
  const statuses: string[] = [];
  const result = await runBatch([new File([], "a.png"), new File([], "b.png")], null, undefined, runtime({
    loadImage: async () => { decoded++; controller.abort(); return {} as HTMLImageElement; },
    createStudio: () => { throw Error("must not create a worker after cancellation"); },
  }), { signal: controller.signal, onItem: (i, status) => { statuses[i] = status; } });
  assert.equal(decoded, 1);
  assert.equal(result.cancelled, true);
  assert.equal(result.succeeded, 0);
  assert.equal(result.skipped, 2);
  assert.deepEqual(statuses, ["skipped", "skipped"]);
});

test("cancelling during export disposes the worker and does not retain late output", async () => {
  const controller = new AbortController();
  let disposed = false;
  const result = await runBatch([new File([], "a.png")], null, undefined, runtime({
    createStudio: () => ({ openImage: () => ({ id: "x" }), dispose: () => { disposed = true; } }) as unknown as Studio,
    encodePng: async () => { controller.abort(); return new Blob(["png"]); },
  }), { signal: controller.signal });
  assert.equal(disposed, true);
  assert.equal(result.succeeded, 0);
  assert.equal(result.skipped, 1);
});

test("batch rejects excessive queues and malformed actions before decoding", async () => {
  const noDecode = runtime({ loadImage: async () => { throw Error("must not decode"); } });
  await assert.rejects(runBatch(Array.from({ length: 201 }, () => new File([], "x.png")), null, undefined, noDecode), /at most 200/);
  await assert.rejects(runBatch([], { name: "bad", steps: [{ op: "fill", color: "red", opacity: 2 }] }, undefined, noDecode), /malformed/);
  await assert.rejects(runBatch([], null, undefined, noDecode, { maxOutputBytes: Infinity }), /budget/);
});

test("batch output names cannot create ZIP paths", async () => {
  const result = await runBatch([new File([], "../folder/image.jpg"), new File([], "../folder/image.png")], null, undefined, runtime());
  const zip = await JSZip.loadAsync(await result.archive.arrayBuffer());
  const names = Object.keys(zip.files);
  assert.equal(names.length, 3);
  assert.ok(names.every(name => !/[\\/]/.test(name) && !name.startsWith("..")));
});

test("batch processing isolates each file, disposes workers, and reports failures", async () => {
  const files = [new File(["a"], "same.jpg"), new File(["bad"], "bad.jpg"), new File(["b"], "same.png")];
  let created = 0;
  let disposed = 0;
  let replayed = 0;
  const result = await runBatch(files, { name: "Test", steps: [{ op: "selectAll" }] }, undefined, {
    loadImage: async (file) => {
      if (file.name === "bad.jpg") throw new Error("decode failed");
      return { width: 4, height: 4, naturalWidth: 4, naturalHeight: 4 } as HTMLImageElement;
    },
    createStudio: () => {
      created += 1;
      return {
        openImage: () => ({ id: `layer-${created}` }),
        replay: () => { replayed += 1; },
        dispose: () => { disposed += 1; },
      } as unknown as Studio;
    },
    encodePng: async () => new Blob(["png"], { type: "image/png" }),
  });
  assert.equal(result.succeeded, 2);
  assert.deepEqual(result.failed, [{ name: "bad.jpg", message: "decode failed" }]);
  assert.equal(created, 2);
  assert.equal(disposed, 2);
  assert.equal(replayed, 2);
  assert.ok(result.archive.size > 0);
});
