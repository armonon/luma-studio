import { recolorPixels, type RecolorParams } from "../engine/recolor";
self.onmessage = (event: MessageEvent<{ pixels: Uint8ClampedArray; params: RecolorParams; selection?: Uint8Array }>) => {
  try {
    const result=recolorPixels(event.data.pixels,event.data.params,event.data.selection);
    self.postMessage(result,{transfer:[result.pixels.buffer,result.mask.buffer]});
  } catch(error) { self.postMessage({error:error instanceof Error?error.message:"Preview failed"}); }
};
