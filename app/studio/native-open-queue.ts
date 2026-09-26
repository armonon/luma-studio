/** Bounded, pauseable FIFO for OS open events and the native file picker. */
export class NativeOpenQueue {
  private pending: string[] = [];
  private active: string | null = null;
  private paused = true;
  private stopped = false;

  constructor(private readonly open: (request: string, isActive: () => boolean) => Promise<void>, private readonly onError: (error: unknown) => void, private readonly limit = 32) {}

  enqueue(request: string): "queued" | "duplicate" | "full" | "disposed" {
    if (this.stopped) return "disposed";
    if (this.active === request || this.pending.includes(request)) return "duplicate";
    if (this.pending.length + Number(this.active !== null) >= this.limit) return "full";
    this.pending.push(request);
    void this.drain();
    return "queued";
  }

  setPaused(paused: boolean) { this.paused = paused; if (!paused) void this.drain(); }
  dispose() { this.stopped = true; this.pending.length = 0; }

  private async drain() {
    if (this.active !== null || this.paused || this.stopped) return;
    while (!this.paused && !this.stopped && this.pending.length) {
      const request = this.pending.shift()!;
      this.active = request;
      try { await this.open(request, () => !this.stopped); }
      catch (error) { if (!this.stopped) this.onError(error); }
      finally { this.active = null; }
    }
  }
}
