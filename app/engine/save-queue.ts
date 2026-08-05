export type SaveQueueState = "idle" | "producing" | "committing" | "error" | "cancelled";

export type SaveQueueOptions<T> = {
  produce(revision: number): Promise<T>;
  commit(value: T, revision: number): Promise<void>;
  onState?(state: SaveQueueState, error?: unknown): void;
};

/**
 * Serializes autosaves and skips snapshots superseded while they are encoding.
 * This prevents a slow, older project archive from overwriting newer recovery.
 */
export class CoalescedSaveQueue<T> {
  private requestedRevision = 0;
  private settledRevision = 0;
  private running: Promise<void> | null = null;
  private cancelled = false;

  constructor(private readonly options: SaveQueueOptions<T>) {}

  request() {
    if (this.cancelled) return this.requestedRevision;
    this.requestedRevision += 1;
    if (!this.running) {
      this.running = this.drain().finally(() => { this.running = null; });
    }
    return this.requestedRevision;
  }

  async waitForIdle() {
    await this.running;
  }

  cancel() {
    this.cancelled = true;
    this.options.onState?.("cancelled");
  }

  private async drain() {
    while (!this.cancelled && this.settledRevision < this.requestedRevision) {
      const revision = this.requestedRevision;
      try {
        this.options.onState?.("producing");
        const value = await this.options.produce(revision);
        if (this.cancelled) return;
        if (revision !== this.requestedRevision) continue;

        this.options.onState?.("committing");
        await this.options.commit(value, revision);
        this.settledRevision = revision;
      } catch (error) {
        if (revision === this.requestedRevision) this.settledRevision = revision;
        this.options.onState?.("error", error);
      }
    }
    if (!this.cancelled) this.options.onState?.("idle");
  }
}
