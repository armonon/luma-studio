import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { decodeUpdaterPublicKey, validateUpdaterEndpoint } from "./release-config.mjs";

const output = resolve(process.argv[2] ?? "src-tauri/tauri.release.conf.json");
const pubkey = process.env.LUMA_UPDATER_PUBKEY;
const endpoint = process.env.LUMA_UPDATER_ENDPOINT;
const identity = process.env.APPLE_SIGNING_IDENTITY;
const crashEndpoint = process.env.NEXT_PUBLIC_LUMA_CRASH_ENDPOINT;

decodeUpdaterPublicKey(pubkey);
const validatedEndpoint = validateUpdaterEndpoint(endpoint);
const validatedCrashEndpoint = validateUpdaterEndpoint(crashEndpoint);
const crashOrigin = new URL(validatedCrashEndpoint).origin;
if (!identity || identity === "-" || !/^Developer ID Application: .+\([A-Z0-9]{10}\)$/.test(identity)) {
  throw new Error("APPLE_SIGNING_IDENTITY must name a Developer ID Application certificate and 10-character Team ID");
}

const config = {
  app: {
    security: {
      csp: `default-src 'self' customprotocol: asset:; connect-src 'self' ipc: http://ipc.localhost https://ipc.localhost ${crashOrigin} https://huggingface.co https://*.huggingface.co https://luma-studio-preview.armonon.chatgpt.site; img-src 'self' asset: http://asset.localhost blob: data:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'`,
    },
  },
  bundle: {
    createUpdaterArtifacts: true,
    macOS: { signingIdentity: identity },
  },
  plugins: {
    updater: {
      pubkey,
      endpoints: [validatedEndpoint],
    },
  },
};

await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
console.log(`Wrote release-only Tauri configuration to ${output}`);
