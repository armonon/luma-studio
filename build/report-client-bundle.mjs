import fs from "node:fs";
import path from "node:path";
import {
  brotliCompressSync,
  constants,
  gzipSync,
} from "node:zlib";

const clientRoot = path.resolve("dist/client");
const manifestPath = path.join(clientRoot, ".vite/manifest.json");
const check = process.argv.includes("--check");

if (!fs.existsSync(manifestPath)) {
  throw new Error("Client manifest is missing. Run the production build first.");
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const initialKeys = new Set();

function visit(key) {
  if (initialKeys.has(key)) return;
  const entry = manifest[key];
  if (!entry) throw new Error(`Bundle manifest entry is missing: ${key}`);
  initialKeys.add(key);
  for (const dependency of entry.imports ?? []) visit(dependency);
}

// Vinext boots through the browser entry and then hydrates the route entry.
// Use their static dependency union; dynamicImports are intentionally excluded.
visit("virtual:vinext-app-browser-entry");
visit("app/studio/page.tsx");

const files = [...initialKeys].map((key) => manifest[key].file);
const assetDirectory = path.join(clientRoot, "assets");
for (const name of fs.readdirSync(assetDirectory)) {
  if (name.endsWith(".css")) files.push(`assets/${name}`);
}

const totals = files.reduce(
  (result, file) => {
    const bytes = fs.readFileSync(path.join(clientRoot, file));
    result.raw += bytes.length;
    result.gzip += gzipSync(bytes, { level: 9 }).length;
    result.brotli += brotliCompressSync(bytes, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 5 },
    }).length;
    return result;
  },
  { raw: 0, gzip: 0, brotli: 0 },
);

const studioEntry = manifest["app/studio/page.tsx"];
const studioEntryBytes = fs.statSync(path.join(clientRoot, studioEntry.file)).size;
const summary = {
  ...totals,
  jsRequests: initialKeys.size,
  cssRequests: files.length - initialKeys.size,
  studioEntryBytes,
};

console.log(JSON.stringify(summary, null, 2));

if (check) {
  const failures = [];
  if (totals.brotli > 300_000) failures.push(`initial Brotli ${totals.brotli} > 300000`);
  if (totals.gzip > 320_000) failures.push(`initial gzip ${totals.gzip} > 320000`);
  if (initialKeys.size > 6) failures.push(`initial JS requests ${initialKeys.size} > 6`);
  if (studioEntryBytes > 650_000) failures.push(`studio route entry ${studioEntryBytes} > 650000`);
  if (failures.length) {
    console.error(`Bundle budget failed:\n- ${failures.join("\n- ")}`);
    process.exitCode = 1;
  }
}
