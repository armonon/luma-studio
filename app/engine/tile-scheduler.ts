export type SchedulableTileRequest = {
  key: string;
  priority: number;
};

export class TileRequestCancelledError extends Error {
  constructor(readonly key: string) {
    super(`Tile request cancelled: ${key}`);
    this.name = "TileRequestCancelledError";
  }
}

type QueueItem<TRequest extends SchedulableTileRequest, TResult> = {
  request: TRequest;
  sequence: number;
  controller: AbortController;
  promise: Promise<TResult>;
  resolve: (value: TResult) => void;
  reject: (reason: unknown) => void;
  state: "queued" | "running";
};

export type TileSchedulerStats = {
  concurrency: number;
  queued: number;
  inFlight: number;
  peakInFlight: number;
  completed: number;
  cancelled: number;
  failed: number;
  deduplicated: number;
};

/** Priority scheduler with request deduplication and abortable viewport churn. */
export class CancellableTileScheduler<TRequest extends SchedulableTileRequest, TResult> {
  private readonly items = new Map<string, QueueItem<TRequest, TResult>>();
  private sequence = 0;
  private inFlight = 0;
  private peakInFlight = 0;
  private completed = 0;
  private cancelled = 0;
  private failed = 0;
  private deduplicated = 0;

  constructor(
    readonly concurrency: number,
    private readonly worker: (request: TRequest, signal: AbortSignal) => Promise<TResult>,
  ) {
    if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 128) {
      throw new Error("concurrency must be an integer between 1 and 128");
    }
  }

  request(request: TRequest, consumerSignal?: AbortSignal): Promise<TResult> {
    if (!request.key) throw new Error("request key cannot be empty");
    if (!Number.isFinite(request.priority)) throw new Error("request priority must be finite");
    const existing = this.items.get(request.key);
    if (existing) {
      this.deduplicated += 1;
      if (request.priority > existing.request.priority) {
        existing.request = request;
      }
      return this.bindConsumer(existing.promise, request.key, consumerSignal);
    }

    let resolve!: (value: TResult) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<TResult>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    const item: QueueItem<TRequest, TResult> = {
      request,
      sequence: this.sequence++,
      controller: new AbortController(),
      promise,
      resolve,
      reject,
      state: "queued",
    };
    this.items.set(request.key, item);
    this.pump();
    return this.bindConsumer(promise, request.key, consumerSignal);
  }

  reprioritize(key: string, priority: number) {
    if (!Number.isFinite(priority)) throw new Error("priority must be finite");
    const item = this.items.get(key);
    if (!item) return false;
    item.request = { ...item.request, priority };
    this.pump();
    return true;
  }

  cancel(key: string) {
    const item = this.items.get(key);
    if (!item) return false;
    item.controller.abort();
    if (item.state === "queued") {
      this.items.delete(key);
      this.cancelled += 1;
      item.reject(new TileRequestCancelledError(key));
      this.pump();
    }
    return true;
  }

  /** Cancels queued and in-flight work no longer referenced by a viewport plan. */
  retain(keys: ReadonlySet<string>) {
    let cancelled = 0;
    for (const key of [...this.items.keys()]) {
      if (!keys.has(key) && this.cancel(key)) cancelled += 1;
    }
    return cancelled;
  }

  cancelAll() { return this.retain(new Set()); }

  stats(): TileSchedulerStats {
    let queued = 0;
    for (const item of this.items.values()) if (item.state === "queued") queued += 1;
    return {
      concurrency: this.concurrency,
      queued,
      inFlight: this.inFlight,
      peakInFlight: this.peakInFlight,
      completed: this.completed,
      cancelled: this.cancelled,
      failed: this.failed,
      deduplicated: this.deduplicated,
    };
  }

  private pump() {
    while (this.inFlight < this.concurrency) {
      const next = [...this.items.values()]
        .filter((item) => item.state === "queued")
        .sort((a, b) => b.request.priority - a.request.priority || a.sequence - b.sequence)[0];
      if (!next) return;
      next.state = "running";
      this.inFlight += 1;
      this.peakInFlight = Math.max(this.peakInFlight, this.inFlight);
      void Promise.resolve()
        .then(() => this.worker(next.request, next.controller.signal))
        .then((result) => {
          if (next.controller.signal.aborted) {
            this.cancelled += 1;
            next.reject(new TileRequestCancelledError(next.request.key));
          } else {
            this.completed += 1;
            next.resolve(result);
          }
        }, (error: unknown) => {
          if (next.controller.signal.aborted) {
            this.cancelled += 1;
            next.reject(new TileRequestCancelledError(next.request.key));
          } else {
            this.failed += 1;
            next.reject(error);
          }
        })
        .finally(() => {
          this.items.delete(next.request.key);
          this.inFlight -= 1;
          this.pump();
        });
    }
  }

  private bindConsumer(promise: Promise<TResult>, key: string, signal?: AbortSignal) {
    if (!signal) return promise;
    if (signal.aborted) return Promise.reject(new TileRequestCancelledError(key));
    return new Promise<TResult>((resolve, reject) => {
      const abort = () => reject(new TileRequestCancelledError(key));
      signal.addEventListener("abort", abort, { once: true });
      void promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    });
  }
}
