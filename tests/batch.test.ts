import assert from "node:assert/strict";
import test from "node:test";
import type { Studio } from "../app/engine/studio.ts";
import { runBatch } from "../app/engine/batch.ts";

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
