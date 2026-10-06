// Stand-in for Node-only optional imports that Turbopack (`next build`, used by
// `npm run build:netlify`) would otherwise try to resolve:
// - Paper.js's jsdom canvas adapter (only runs when jsdom is installed; it is not)
// - harfbuzzjs's `import("module")`, which only runs under Node, never in the browser
// The Vite/vinext build avoids both via the packages' "browser" fields.
module.exports = {};
