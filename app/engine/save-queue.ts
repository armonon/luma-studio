export type SaveQueueState = "idle" | "producing" | "committing" | "error" | "cancelled";

export type SaveQueueOptions<T> = {
  produce(revision: number): Promise<T>;
  commit(value: T, revision: number): Promise<void>;
  onState?(state: SaveQueueState, error?: unknown): void;
};

export type RecoveryPressure = {
  documentPixels: number;
  estimatedResidentBytes: number;
  layers: number;
};

/**
 * Debounce recovery more aggressively when encoding itself is expensive.
 * Lifecycle events still flush immediately; this only prevents a large,
 * actively edited project from continuously rebuilding ZIP archives.
 */
export function recoveryCheckpointDelayMs(pressure: RecoveryPressure) {
  if (pressure.documentPixels >= 400_000_000 || pressure.estimatedResidentBytes >= 1024 * 1024 * 1024 || pressure.layers >= 2_000) {
    return 8_000;
  }
  if (pressure.documentPixels >= 100_000_000 || pressure.estimatedResidentBytes >= 384 * 1024 * 1024 || pressure.layers >= 500) {
    return 4_000;
  }
  return 1_600;
}

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
    let latestFailed = false;
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
        latestFailed = false;
      } catch (error) {
        if (revision === this.requestedRevision) this.settledRevision = revision;
        latestFailed = revision === this.requestedRevision;
        this.options.onState?.("error", error);
      }
    }
    if (!this.cancelled && !latestFailed) this.options.onState?.("idle");
  }
}
