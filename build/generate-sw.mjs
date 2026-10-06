/**
 * Writes public/sw.js from build/sw-template.js after `next build`.
 * The precache list is every hashed asset in .next/static (minus source maps
 * and the on-device AI runtime, which needs the network for models anyway)
 * plus the studio shells, manifests, icons, the default Lato faces and the
 * starter/sample images the studio opens with.
 */
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

const root = resolve(process.argv[2] ?? ".");
const staticDir = join(root, ".next", "static");
const EXCLUDE = [/\.map$/, /(^|\/)ort-wasm[^/]*$/, /(^|\/)ort\.[^/]*\.mjs$/, /\.txt$/];

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(path));
    else out.push(path);
  }
  return out;
}

const buildId = (await readFile(join(root, ".next", "BUILD_ID"), "utf8")).trim();
const files = (await walk(staticDir)).map(path => relative(staticDir, path).split(sep).join("/"));
const nextStatic = files.filter(path => !EXCLUDE.some(pattern => pattern.test(path))).map(path => `/_next/static/${path}`).sort();
const publicAssets = [
  "/luma.webmanifest", "/luma-iphone.webmanifest", "/luma-ipad.webmanifest", "/favicon.svg",
  "/icons/luma-192.png", "/icons/luma-512.png", "/icons/luma-maskable-192.png", "/icons/luma-maskable-512.png",
  "/fonts/Lato-Regular.ttf", "/fonts/Lato-Bold.ttf",
  // Starter document + sample strip shown when the studio opens.
  "/desert.jpg", "/film-desert.jpg", "/film-wave.jpg", "/film-sun.jpg", "/film-mountain.jpg", "/film-lake.jpg",
];
for (const asset of publicAssets) await stat(join(root, "public", asset));
const shells = ["/studio", "/iphone", "/ipad"];
const urls = [...shells, ...publicAssets, ...nextStatic];

const template = await readFile(join(root, "build", "sw-template.js"), "utf8");
const hash = createHash("sha256");
hash.update(template);
for (const asset of publicAssets) hash.update(await readFile(join(root, "public", asset)));
hash.update(buildId);
hash.update(urls.join("\n"));
const version = `${buildId.slice(0, 12)}-${hash.digest("hex").slice(0, 10)}`;
const bytes = await Promise.all(nextStatic.map(url => stat(join(staticDir, url.slice("/_next/static/".length))).then(s => s.size)));
const sw = template
  .replace('"__LUMA_SW_VERSION__"', JSON.stringify(version))
  .replace("__LUMA_PRECACHE__", JSON.stringify(urls, null, 0));
await writeFile(join(root, "public", "sw.js"), sw);
console.log(`public/sw.js ${version}: ${urls.length} precached URLs, ${(bytes.reduce((a, b) => a + b, 0) / 1048576).toFixed(1)} MB of /_next/static`);
