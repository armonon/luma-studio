import { BlnM } from "ag-psd/dist-es/descriptor.js";
import { infoHandlersMap } from "ag-psd/dist-es/additionalInfo.js";

let installed = false;
let failure: string | undefined;

/** Photoshop also writes its four-character vivid-light enum in effect
 * descriptors. ag-psd accepts the long spelling only, then silently falls back
 * to legacy lrFX when the modern descriptor throws, losing strokes and other
 * properties. Preserve the known alias; surface all remaining effect failures
 * outside the codec's catch-and-ignore boundary. Reads are synchronous. */
export function readWithPhotoshopEffectCompatibility<T>(read: () => T): T {
  if (!installed) {
    installed = true;
    const decode = BlnM.decode;
    BlnM.decode = value => value === "BlnM.vLit" ? "vivid light" : decode(value);
    for (const key of ["lrFX", "lfx2", "lmfx"]) {
      const handler = infoHandlersMap[key], original = handler.read;
      handler.read = (...args) => {
        try { return original(...args); }
        catch (error) {
          failure ??= `${key}: ${String(error).slice(0, 512)}`;
          throw error;
        }
      };
    }
  }
  const outerFailure = failure;
  failure = undefined;
  try {
    const result = read();
    if (failure) throw new Error(`Photoshop layer effects could not be read safely (${failure}); no legacy substitute was accepted`);
    return result;
  } finally { failure = outerFailure; }
}
