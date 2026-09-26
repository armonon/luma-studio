/** One encoder per Studio: recovery must not compete with Save for ZIP scratch. */
export class ProjectEncodingQueue {
  private active = false;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly maximumWaiting = 8, private readonly waitTimeoutMs = 30_000) {}

  acquire(): Promise<() => void> {
    if (!this.active) {
      this.active = true;
      return Promise.resolve(this.releaseHandle());
    }
    if (this.waiting.length >= this.maximumWaiting) return Promise.reject(new Error("Too many project saves are waiting. Keep the document open and retry."));
    return new Promise((resolve, reject) => {
      const ready = () => { clearTimeout(timer); resolve(this.releaseHandle()); };
      const timer = setTimeout(() => {
        const index = this.waiting.indexOf(ready);
        if (index >= 0) this.waiting.splice(index, 1);
        reject(new Error("Another project save is still encoding. Keep the document open and retry."));
      }, this.waitTimeoutMs);
      this.waiting.push(ready);
    });
  }

  private releaseHandle() {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.waiting.shift();
      if (next) next();
      else this.active = false;
    };
  }
}
