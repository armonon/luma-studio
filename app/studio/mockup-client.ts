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
  private readonly waiting = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

  constructor() {
    try {
      if (typeof Worker === "undefined") throw new Error("no worker");
      this.worker = new Worker(new URL("./mockup.worker.ts", import.meta.url), { type: "module" });
      this.worker.onmessage = (event: MessageEvent<{ id: number; ok: boolean; result?: MockupRenderResult; error?: string }>) => {
        const pending = this.waiting.get(event.data.id);
        if (!pending) return;
        this.waiting.delete(event.data.id);
        if (event.data.ok) pending.resolve(event.data.result); else pending.reject(new Error(event.data.error ?? "Mockup render failed"));
      };
      this.worker.onerror = () => { for (const pending of this.waiting.values()) pending.reject(new Error("Mockup renderer stopped")); this.waiting.clear(); };
    } catch {
      this.worker = null;
      this.fallback = createMockupRenderService();
    }
  }

  private call<T>(message: Record<string, unknown>, transfer: Transferable[] = []): Promise<T> {
    if (!this.worker) return Promise.reject(new Error("worker unavailable"));
    const id = this.next++;
    return new Promise<T>((resolve, reject) => {
      this.waiting.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.worker!.postMessage({ ...message, id }, transfer);
    });
  }

  async setArt(art: RasterImage | null) {
    if (this.fallback) { this.fallback.setArt(art); return; }
    const copy = art ? art.data.slice().buffer : null;
    await this.call({ type: "art", art: art && copy ? { width: art.width, height: art.height, data: copy } : null }, copy ? [copy] : []);
  }

  async render(request: MockupRenderRequest): Promise<MockupRenderResult> {
    if (this.fallback) return this.fallback.render(request);
    return this.call<MockupRenderResult>({ type: "render", request });
  }

  dispose() {
    this.worker?.terminate();
    for (const pending of this.waiting.values()) pending.reject(new Error("Mockups closed"));
    this.waiting.clear();
  }
}
