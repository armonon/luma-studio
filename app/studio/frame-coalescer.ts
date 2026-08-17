/** Keeps only the latest high-frequency input and applies it once per frame. */
export class FrameCoalescer<T> {
  private frame: number | null = null;
  private pending: T | undefined;

  constructor(
    private readonly schedule: (callback: () => void) => number,
    private readonly cancelFrame: (frame: number) => void,
    private readonly apply: (value: T) => void,
  ) {}

  push(value: T) {
    this.pending = value;
    if (this.frame !== null) return;
    this.frame = this.schedule(() => {
      this.frame = null;
      const next = this.pending;
      this.pending = undefined;
      if (next !== undefined) this.apply(next);
    });
  }

  flush() {
    if (this.frame !== null) this.cancelFrame(this.frame);
    this.frame = null;
    const next = this.pending;
    this.pending = undefined;
    if (next !== undefined) this.apply(next);
  }

  cancel() {
    if (this.frame !== null) this.cancelFrame(this.frame);
    this.frame = null;
    this.pending = undefined;
  }
}
