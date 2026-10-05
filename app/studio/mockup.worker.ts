/// <reference lib="webworker" />
import { createMockupRenderService, type MockupRenderRequest } from "./mockup-renderer";
import type { RasterImage } from "../engine/mockup";

type Message =
  | { id: number; type: "art"; art: { width: number; height: number; data: ArrayBuffer } | null }
  | { id: number; type: "render"; request: MockupRenderRequest };

const service = createMockupRenderService();
const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = (event: MessageEvent<Message>) => {
  const message = event.data;
  try {
    if (message.type === "art") {
      const art: RasterImage | null = message.art ? { width: message.art.width, height: message.art.height, data: new Uint8ClampedArray(message.art.data) } : null;
      service.setArt(art);
      scope.postMessage({ id: message.id, ok: true });
      return;
    }
    const result = service.render(message.request);
    scope.postMessage({ id: message.id, ok: true, result }, [result.data.buffer]);
  } catch (error) {
    scope.postMessage({ id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
