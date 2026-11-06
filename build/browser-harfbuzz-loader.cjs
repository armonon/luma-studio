// Emscripten uses import.meta.url both for its script directory and as the
// statically analyzable base of its WASM asset. Webpack must keep the latter
// so it emits a content-hashed asset, while browser script URLs must describe
// the running page/worker rather than the build machine's source pathname.
module.exports = function browserHarfBuzzLoader(source) {
  const requireBase = 'createRequire(import.meta.url)';
  const scriptBase = 'var _scriptName=import.meta.url';
  if (!source.includes(requireBase) || !source.includes(scriptBase)) {
    throw new Error('Review the HarfBuzz browser loader for the installed vendor version');
  }
  return source
    .replace(requireBase, 'createRequire(globalThis.location.href)')
    .replace(scriptBase, 'var _scriptName=globalThis.location.href');
};
