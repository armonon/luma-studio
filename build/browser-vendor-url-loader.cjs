// Browser-only vendor modules must resolve runtime URLs against the running
// page or worker, never Webpack's build-machine file URL. Preserve static
// new URL(asset, import.meta.url) expressions so Webpack still emits and
// rewrites their WASM/worker assets with content-hashed public URLs.
module.exports = function browserVendorUrlLoader(source) {
  const assets = [];
  const protectedSource = source.replace(
    /new URL\(\s*(["'])([^"']+)\1\s*,\s*import\.meta\.url\s*\)/g,
    (expression, quote, asset) => {
      if (asset === "." || asset === "./") return expression;
      const marker = `__LUMA_STATIC_VENDOR_ASSET_${assets.length}__`;
      assets.push(expression);
      return marker;
    },
  );
  return protectedSource.replaceAll("import.meta.url", "globalThis.location.href")
    .replace(/__LUMA_STATIC_VENDOR_ASSET_(\d+)__/g, (_, index) => assets[Number(index)]);
};
