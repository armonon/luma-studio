/**
 * Orders native open-document events against asynchronous startup recovery.
 *
 * macOS may deliver a Finder document before React has created the Studio, and
 * recovery may still be importing after the native listener is live. Keeping
 * those paths here guarantees that an explicit open runs after recovery and
 * therefore remains the active document the user asked for.
 */
export class StartupOpenCoordinator {
  private ready = false;
  private pending: string[] = [];

  route(path: string): string | null {
    if (!path) return null;
    if (this.ready) return path;
    if (!this.pending.includes(path)) this.pending.push(path);
    return null;
  }

  markReady(): string[] {
    this.ready = true;
    return this.pending.splice(0);
  }

  reset() {
    this.ready = false;
    this.pending.length = 0;
  }
}
