export function decodeUpdaterPublicKey(value) {
  if (typeof value !== "string" || value.length < 80 || value.length > 4096 || /placeholder|replace|example/i.test(value)) {
    throw new Error("LUMA_UPDATER_PUBKEY must be the real base64-encoded minisign public key");
  }
  let decoded;
  try {
    const encoded = value.replace(/\s/g, "");
    const bytes = Buffer.from(encoded, "base64");
    if (bytes.toString("base64") !== encoded) throw new Error("Noncanonical base64");
    decoded = bytes.toString("utf8");
  } catch {
    throw new Error("LUMA_UPDATER_PUBKEY is not valid base64");
  }
  const lines = decoded.trim().split(/\r?\n/);
  const key = Buffer.from(lines[1] ?? "", "base64");
  // Match minisign-verify's 2-byte algorithm + 8-byte key ID + 32-byte key.
  // A plausible-looking RW... string alone is not a usable updater key.
  if (lines.length !== 2 || !/^untrusted comment: minisign public key(?: |$)/.test(lines[0])
    || key.length !== 42 || key.toString("base64") !== lines[1]
    || key[0] !== 0x45 || (key[1] !== 0x64 && key[1] !== 0x44)
    || key.subarray(10).every(byte => byte === 0)) {
    throw new Error("LUMA_UPDATER_PUBKEY does not decode to a minisign public key");
  }
  return decoded;
}

export function validateUpdaterEndpoint(value) {
  let endpoint;
  try { endpoint = new URL(value); } catch { throw new Error("LUMA_UPDATER_ENDPOINT must be a valid URL"); }
  if (endpoint.protocol !== "https:") throw new Error("LUMA_UPDATER_ENDPOINT must use HTTPS");
  if (endpoint.username || endpoint.password || endpoint.hash) {
    throw new Error("LUMA_UPDATER_ENDPOINT cannot contain credentials or a fragment");
  }
  return endpoint.toString();
}

export function validUpdaterConfiguration(config) {
  try {
    decodeUpdaterPublicKey(config?.pubkey);
    return Array.isArray(config?.endpoints) && config.endpoints.length > 0 &&
      config.endpoints.every((endpoint) => validateUpdaterEndpoint(endpoint));
  } catch {
    return false;
  }
}
