/**
 * Mockup rendering service shared by the worker and the main-thread fallback.
 * Scene synthesis is the expensive part (hundreds of ms at export sizes), so
 * scenes are cached by id/size/colour; export-size scenes are not retained.
 */
import { renderMockup, type MockupPlacement, type MockupSceneId, type Quad, type RasterImage } from "../engine/mockup";
import { createMockupScene } from "../engine/mockup-scenes";

export type MockupRenderRequest = {
  scene: MockupSceneId;
  size: number;
  color: string;
  placement: MockupPlacement;
  inkOpacity?: number;
  /** Keep the synthesized scene for later renders (previews), or drop it (exports). */
  cache: boolean;
};
export type MockupRenderResult = { width: number; height: number; data: Uint8ClampedArray; quad: Quad; printAspect: number };

const MAX_CACHED = 14;

export function createMockupRenderService() {
  const scenes = new Map<string, ReturnType<typeof createMockupScene>>();
  let art: RasterImage | null = null;
  return {
    setArt(next: RasterImage | null) { art = next; },
    render(request: MockupRenderRequest): MockupRenderResult {
      const key = `${request.scene}|${request.size}|${request.color}`;
      let scene = scenes.get(key);
      if (!scene) {
        scene = createMockupScene(request.scene, { size: request.size, color: request.color });
        if (request.cache) {
          scenes.set(key, scene);
          while (scenes.size > MAX_CACHED) scenes.delete(scenes.keys().next().value!);
        }
      } else { scenes.delete(key); scenes.set(key, scene); }
      const data = renderMockup(scene, art, request.placement, { inkOpacity: request.inkOpacity });
      return { width: scene.width, height: scene.height, data, quad: scene.quad, printAspect: scene.printAspect };
    },
  };
}
