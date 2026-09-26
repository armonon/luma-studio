// Explicit maintenance command; normal application/build operation never downloads fonts.
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { BUNDLED_FONTS, bundledFontFile } from "../app/engine/bundled-fonts.ts";
const revision = "e44c4b011a820c2cbe2fd2cfa8052037d7edb571";
const root = new URL("../public/fonts/", import.meta.url);
await mkdir(root, { recursive: true });
const manifest: Array<{ file: string; source: string; sha256: string; bytes: number }> = [];
for (const font of BUNDLED_FONTS) {
  for (const name of [...font.faces.map(face => bundledFontFile(font.family, face)), "OFL.txt"]) {
    const source = `https://raw.githubusercontent.com/google/fonts/${revision}/ofl/${font.slug}/${name}`;
    const response = await fetch(source);
    if (!response.ok) throw new Error(`${response.status}: ${source}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 2 * 1024 * 1024) throw new Error("Font exceeds asset budget");
    if (name === "OFL.txt" && !bytes.toString().includes("SIL OPEN FONT LICENSE")) throw new Error("Missing OFL license");
    const file = name === "OFL.txt" ? `${font.slug}-OFL.txt` : name;
    await writeFile(new URL(file, root), bytes);
    manifest.push({ file, source, sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length });
  }
}
await writeFile(new URL("manifest.json", root), JSON.stringify({ revision, files: manifest }, null, 2) + "\n");
console.log(`${BUNDLED_FONTS.length} bundled families, ${manifest.reduce((sum, item) => sum + item.bytes, 0)} bytes including licenses`);
