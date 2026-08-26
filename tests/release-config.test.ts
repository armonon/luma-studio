import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeUpdaterPublicKey,
  validateUpdaterEndpoint,
  validUpdaterConfiguration,
} from "../build/release-config.mjs";

const minisign = Buffer.from(
  `untrusted comment: minisign public key 0123456789ABCDEF\nRW${"A".repeat(50)}\n`,
).toString("base64");

test("release updater configuration accepts only HTTPS and a decoded minisign key", () => {
  assert.match(decodeUpdaterPublicKey(minisign), /minisign public key/);
  assert.equal(validateUpdaterEndpoint("https://updates.example.test/luma/{{target}}/{{arch}}"), "https://updates.example.test/luma/%7B%7Btarget%7D%7D/%7B%7Barch%7D%7D");
  assert.equal(validUpdaterConfiguration({ pubkey: minisign, endpoints: ["https://updates.example.test/latest.json"] }), true);
  assert.equal(validUpdaterConfiguration({ pubkey: "BASE64_PLACEHOLDER", endpoints: ["https://updates.example.test"] }), false);
  assert.equal(validUpdaterConfiguration({ pubkey: minisign, endpoints: ["http://updates.example.test"] }), false);
  assert.throws(() => validateUpdaterEndpoint("https://user:secret@updates.example.test/latest#fragment"), /credentials or a fragment/);
});
