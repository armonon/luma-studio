import { createMockupRenderService, type MockupRenderRequest, type MockupRenderResult } from "./mockup-renderer";
import type { RasterImage } from "../engine/mockup";

/**
 * Runs mockup synthesis in a worker so a 2000 px export never freezes the
 * studio; falls back to the main thread where workers are unavailable.
 */
export class MockupClient {
  private worker: Worker | null = null;
  private fallback: ReturnType<typeof createMockupRenderService> | null = null;
  private next = 1;
  private readonly waiting = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private stopped = false;

  constructor(createWorker = () => new Worker(new URL("./mockup.worker.ts", import.meta.url), { type: "module" })) {
    try {
      this.worker = createWorker();
      this.worker.onmessage = (event: MessageEvent<{ id: number; ok: boolean; result?: MockupRenderResult; error?: string }>) => {
        const pending = this.waiting.get(event.data.id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.waiting.delete(event.data.id);
        if (event.data.ok) pending.resolve(event.data.result); else pending.reject(new Error(event.data.error ?? "Mockup render failed"));
      };
      this.worker.onerror = () => this.stop(new Error("Mockup renderer stopped. Retry the preview."));
      this.worker.onmessageerror = () => this.stop(new Error("Mockup preview could not be read. Retry the preview."));
    } catch {
      this.worker = null;
      this.fallback = createMockupRenderService();
    }
  }

  private call<T>(message: Record<string, unknown>, transfer: Transferable[] = []): Promise<T> {
    if (!this.worker) return Promise.reject(new Error("worker unavailable"));
    const id = this.next++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => this.stop(new Error("Mockup renderer timed out. Retry the preview.")), 60000);
      this.waiting.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      try { this.worker!.postMessage({ ...message, id }, transfer); }
      catch { this.stop(new Error("Mockup renderer could not start. Retry the preview.")); }
    });
  }

  async setArt(art: RasterImage | null) {
    if (this.stopped) throw new Error("Mockup renderer stopped. Retry the preview.");
    if (this.fallback) { this.fallback.setArt(art); return; }
    const copy = art ? art.data.slice().buffer : null;
    await this.call({ type: "art", art: art && copy ? { width: art.width, height: art.height, data: copy } : null }, copy ? [copy] : []);
  }

  async render(request: MockupRenderRequest): Promise<MockupRenderResult> {
    if (this.stopped) throw new Error("Mockup renderer stopped. Retry the preview.");
    if (this.fallback) return this.fallback.render(request);
    const result = await this.call<MockupRenderResult>({ type: "render", request });
    if (result.width !== request.size || result.height !== request.size || result.data?.length !== request.size ** 2 * 4)
      throw new Error("Mockup preview was incomplete. Retry the preview.");
    return result;
  }

  private stop(error: Error) {
    this.stopped = true;
    this.worker?.terminate();
    this.worker = null;
    for (const pending of this.waiting.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.waiting.clear();
  }

  dispose() { this.stop(new Error("Mockups closed")); }
}
