import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync } from "node:crypto";
import {
  decodeUpdaterPublicKey,
  validateUpdaterEndpoint,
  validUpdaterConfiguration,
} from "../build/release-config.mjs";

const publicKey = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "der" });
const binaryKey = Buffer.concat([Buffer.from("Ed"), Buffer.alloc(8, 1), publicKey.subarray(-32)]);
const keyFile = `untrusted comment: minisign public key 0101010101010101\n${binaryKey.toString("base64")}\n`;
const minisign = Buffer.from(keyFile).toString("base64");

test("release keys reject malformed base64, truncated keys, wrong algorithms and placeholder bytes", () => {
  assert.throws(() => decodeUpdaterPublicKey(`${minisign}!`), /base64/);
  for (const key of [binaryKey.subarray(0, 39), Buffer.alloc(42), Buffer.concat([Buffer.from("Ex"), binaryKey.subarray(2)]), Buffer.concat([Buffer.from("Ed"), Buffer.alloc(40)])]) {
    const malformed = Buffer.from(`untrusted comment: minisign public key TEST\n${key.toString("base64")}\n`).toString("base64");
    assert.equal(validUpdaterConfiguration({ pubkey: malformed, endpoints: ["https://updates.example.test/latest.json"] }), false);
  }
});

test("generated release CSP retains canonical model and shaping permissions", () => {
  const output = join(mkdtempSync(join(tmpdir(), "luma-release-policy-")), "release.json");
  execFileSync(process.execPath, ["build/generate-tauri-release-config.mjs", output], { env: {
    ...process.env, LUMA_UPDATER_PUBKEY: minisign, LUMA_UPDATER_ENDPOINT: "https://updates.example.test/latest.json",
    NEXT_PUBLIC_LUMA_CRASH_ENDPOINT: "https://crashes.example.test/ingest", APPLE_SIGNING_IDENTITY: "Developer ID Application: Test (ABCDEFGHIJ)",
  } });
  const csp = JSON.parse(readFileSync(output, "utf8")).app.security.csp;
  assert.match(csp, /https:\/\/us\.aws\.cdn\.hf\.co/);
  assert.match(csp, /https:\/\/crashes\.example\.test/);
  assert.match(csp, /'wasm-unsafe-eval'/);
  assert.doesNotMatch(csp, /'unsafe-eval'/);
});

test("release updater configuration accepts only HTTPS and a decoded minisign key", () => {
  assert.match(decodeUpdaterPublicKey(minisign), /minisign public key/);
  assert.equal(validateUpdaterEndpoint("https://updates.example.test/luma/{{target}}/{{arch}}"), "https://updates.example.test/luma/%7B%7Btarget%7D%7D/%7B%7Barch%7D%7D");
  assert.equal(validUpdaterConfiguration({ pubkey: minisign, endpoints: ["https://updates.example.test/latest.json"] }), true);
  assert.equal(validUpdaterConfiguration({ pubkey: "BASE64_PLACEHOLDER", endpoints: ["https://updates.example.test"] }), false);
  assert.equal(validUpdaterConfiguration({ pubkey: minisign, endpoints: ["http://updates.example.test"] }), false);
  assert.throws(() => validateUpdaterEndpoint("https://user:secret@updates.example.test/latest#fragment"), /credentials or a fragment/);
});
