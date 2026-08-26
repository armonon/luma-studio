export function decodeUpdaterPublicKey(value) {
  if (typeof value !== "string" || value.length < 80 || /placeholder|replace|example/i.test(value)) {
    throw new Error("LUMA_UPDATER_PUBKEY must be the real base64-encoded minisign public key");
  }
  let decoded;
  try {
    decoded = Buffer.from(value, "base64").toString("utf8");
  } catch {
    throw new Error("LUMA_UPDATER_PUBKEY is not valid base64");
  }
  if (!/^untrusted comment: minisign public key/m.test(decoded) || !/^RW[A-Za-z0-9+/]{40,}={0,2}$/m.test(decoded)) {
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
