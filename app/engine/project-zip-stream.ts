import type JSZip from "jszip";

type EntryStream = JSZip.JSZipObject & {
  internalStream(type: "uint8array"): JSZip.JSZipStreamHelper<Uint8Array>;
};

/** One owned output allocation; avoid accumulating then concatenating a large source asset. */
export function readProjectEntryBytes(entry: JSZip.JSZipObject, size: number, maximumBytes: number): Promise<Uint8Array<ArrayBuffer>> {
  if (!Number.isSafeInteger(size) || size < 0 || size > maximumBytes) return Promise.reject(new Error("Invalid project asset allocation"));
  return new Promise((resolve, reject) => {
    let output: Uint8Array<ArrayBuffer> | null = new Uint8Array(size);
    const stream = (entry as EntryStream).internalStream("uint8array");
    let offset = 0, settled = false;
    const fail = (error: unknown) => { if (settled) return; settled = true; stream.pause(); output = null; reject(error); };
    stream.on("data", chunk => {
      if (settled) return;
      if (offset + chunk.byteLength > size) { fail(new Error(`Project entry exceeds its admitted size: ${entry.name}`)); return; }
      output!.set(chunk, offset); offset += chunk.byteLength;
    });
    stream.on("error", fail);
    stream.on("end", () => {
      if (settled) return;
      if (offset !== size) { fail(new Error(`Project entry size mismatch: ${entry.name}`)); return; }
      settled = true; resolve(output!); output = null;
    });
    stream.resume();
  });
}

/** Inspect every decompressed byte without retaining an entire asset in memory. */
export function inspectProjectEntry(entry: JSZip.JSZipObject, maximumBytes: number, expectedBytes?: number): Promise<{ size: number; prefix: Uint8Array }> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) return Promise.reject(new Error("Invalid project entry ceiling"));
  return new Promise((resolve, reject) => {
    const stream = (entry as EntryStream).internalStream("uint8array");
    const prefix = new Uint8Array(32);
    let size = 0, copied = 0, settled = false;
    const fail = (error: unknown) => { if (settled) return; settled = true; stream.pause(); reject(error); };
    stream.on("data", chunk => {
      if (settled) return;
      size += chunk.byteLength;
      if (!Number.isSafeInteger(size) || size > maximumBytes || (expectedBytes !== undefined && size > expectedBytes)) {
        fail(new Error(`Project entry exceeds its admitted size: ${entry.name}`)); return;
      }
      const take = Math.min(32 - copied, chunk.byteLength);
      if (take) { prefix.set(chunk.subarray(0, take), copied); copied += take; }
    });
    stream.on("error", fail);
    stream.on("end", () => {
      if (settled) return;
      if (expectedBytes !== undefined && size !== expectedBytes) { fail(new Error(`Project entry size mismatch: ${entry.name}`)); return; }
      settled = true; resolve({ size, prefix: prefix.slice(0, copied) });
    });
    stream.resume();
  });
}

/** Enforce the output ceiling while producing chunks, not after a giant buffer exists. */
export function generateBoundedProjectZip(zip: JSZip, maximumBytes: number, level: number): Promise<Blob> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) return Promise.reject(new Error("Invalid project archive ceiling"));
  return new Promise((resolve, reject) => {
    const stream = zip.generateInternalStream({ type: "uint8array", streamFiles: true, compression: "DEFLATE", compressionOptions: { level } });
    const chunks: BlobPart[] = [];
    let size = 0, settled = false;
    const fail = (error: unknown) => { if (settled) return; settled = true; stream.pause(); chunks.length = 0; reject(error); };
    stream.on("data", chunk => {
      if (settled) return;
      size += chunk.byteLength;
      if (!Number.isSafeInteger(size) || size > maximumBytes) { fail(new Error("Luma project exceeds the archive limit")); return; }
      // JSZip owns each emitted chunk; Blob snapshots its contents on completion.
      chunks.push(chunk as Uint8Array<ArrayBuffer>);
    });
    stream.on("error", fail);
    stream.on("end", () => {
      if (settled) return;
      try { const result = new Blob(chunks, { type: "application/x-luma-project" }); chunks.length = 0; settled = true; resolve(result); }
      catch (error) { fail(error); }
    });
    stream.resume();
  });
}
