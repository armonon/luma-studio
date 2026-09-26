import { infoHandlersMap } from "ag-psd/dist-es/additionalInfo.js";
import { createReader } from "ag-psd/dist-es/psdReader.js";
import { readVersionAndDescriptor } from "ag-psd/dist-es/descriptor.js";
import { parseEngineData } from "ag-psd/dist-es/engineData.js";
import { decodeEngineData, type EngineData } from "ag-psd/dist-es/text.js";

let installed = false;

/** ag-psd 31 removes ALL terminal newlines, including intentional blank
 * paragraphs. Keep its descriptor/shape parsing, but decode runs with a
 * non-newline sentinel and remove exactly the one engine terminator. */
export function decodeTextWithTerminalParagraphs(engine: EngineData, declared: string) {
  const original = engine.EngineDict.Editor.Text;
  if (!original.endsWith("\r") || original.slice(0, -1).replace(/\r/g, "\n") !== declared) {
    throw new Error("Photoshop text content disagrees with its paragraph data; no text was silently replaced");
  }
  const amended = { ...engine, EngineDict: { ...engine.EngineDict, Editor: { Text: original.slice(0, -1) + "\u0000" } } };
  const decoded = decodeEngineData(amended);
  decoded.text = declared;
  // Remove only the terminator unit, retaining empty paragraphs and styles.
  for (const runs of [decoded.styleRuns, decoded.paragraphStyleRuns]) {
    if (runs?.length && --runs[runs.length - 1].length === 0) runs.pop();
  }
  return decoded;
}

export function installPhotoshopTextCompatibility() {
  if (installed) return;
  installed = true;
  const originalRead = infoHandlersMap.TySh.read;
  infoHandlersMap.TySh.read = (reader, target, left, psd, resources) => {
    const start = reader.offset, length = left();
    let declared: string | undefined;
    const proxy = new Proxy(target, { set(object, property, value) {
      if (property === "text" && declared === undefined && typeof value?.text === "string") declared = value.text;
      return Reflect.set(object, property, value);
    } });
    originalRead(reader, proxy, left, psd, resources);
    if (!declared?.endsWith("\n") || !target.text || target.text.text === declared) return;
    // Only affected descriptors are reparsed. No image copy or byte scanning.
    if (length > 8 * 1024 * 1024) throw new Error("This Photoshop text descriptor is too large to restore safely; the original file is unchanged");
    const descriptorReader = createReader(reader.view.buffer, reader.view.byteOffset + start, length);
    descriptorReader.offset = 52; // version + 6 doubles + text version
    const descriptor = readVersionAndDescriptor(descriptorReader);
    if (descriptor["Txt "]?.replace(/\r/g, "\n") !== declared || !(descriptor.EngineData instanceof Uint8Array)) throw new Error("Invalid Photoshop text preservation descriptor");
    const decoded = decodeTextWithTerminalParagraphs(parseEngineData(descriptor.EngineData) as EngineData, declared);
    target.text = { ...target.text, ...decoded };
  };
}
