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

/** WebKit requires the Window receiver for animation-frame host methods. */
export function browserFrameCoalescer<T>(apply: (value: T) => void, clock: Pick<Window, "requestAnimationFrame" | "cancelAnimationFrame"> = window) {
  return new FrameCoalescer<T>(callback => clock.requestAnimationFrame(callback), id => clock.cancelAnimationFrame(id), apply);
}
