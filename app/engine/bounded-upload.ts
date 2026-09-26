/** Bound bytes as they arrive, including chunked requests and extra fields. */
export class UploadLimitError extends Error {}
export class UploadTimeoutError extends Error {}

/** Small JSON/text endpoints must enforce admission before materializing a body. */
export async function readBoundedText(request: Request, maximumBytes: number, timeoutMs = 4000): Promise<string> {
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maximumBytes)) {
    throw new UploadLimitError("The total upload exceeds the request limit.");
  }
  if (!request.body) return "";
  const reader = request.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectAbort: (reason: Error) => void = () => {};
  const abort = () => rejectAbort(new Error("Upload interrupted"));
  const deadline = new Promise<never>((_, reject) => {
    rejectAbort = reject;
    timer = setTimeout(() => reject(new UploadTimeoutError("Upload timed out")), timeoutMs);
  });
  request.signal.addEventListener("abort", abort, { once: true });
  try {
    if (request.signal.aborted) throw new Error("Upload interrupted");
    let received = 0, text = "";
    const decoder = new TextDecoder("utf-8", { fatal: true });
    while (true) {
      const { value, done } = await Promise.race([reader.read(), deadline]);
      if (done) return text + decoder.decode();
      received += value.byteLength;
      if (received > maximumBytes) throw new UploadLimitError("The total upload exceeds the request limit.");
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener("abort", abort);
    // A stalled/malicious source may never resolve cancellation; do not await it.
    void reader.cancel().catch(() => {});
  }
}

export async function readBoundedFormData(request: Request, maximumBytes: number): Promise<FormData> {
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maximumBytes)) {
    throw new UploadLimitError("The total upload exceeds the request limit.");
  }
  if (!request.body) throw new Error("An upload body is required.");
  let received = 0;
  let exceeded = false;
  const bounded = request.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      received += chunk.byteLength;
      if (received > maximumBytes) {
        exceeded = true;
        throw new UploadLimitError("The total upload exceeds the request limit.");
      }
      controller.enqueue(chunk);
    },
  }));
  try {
    return await new Response(bounded, { headers: { "content-type": request.headers.get("content-type") ?? "" } }).formData();
  } catch (error) {
    if (exceeded) throw new UploadLimitError("The total upload exceeds the request limit.");
    throw error;
  }
}
