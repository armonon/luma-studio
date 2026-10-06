// Netlify build plugin: copies the live-only static files that are not
// produced by this repo's build (the Momentium marketing home, /learn
// workshops, /campaign, and the legacy shared Next.js chunks those static
// pages reference by exact filename) into the publish directory the
// official @netlify/plugin-nextjs just finished assembling.
//
// Why this exists: luma.thecreatingco.com's published site has always been
// a merge of this repo's Next.js app (/studio, /iphone, /ipad, /api/*) with
// a much larger static marketing/learning site that is not and has never
// been in this git history (see docs/release/live-static-overlay.md). The
// files under ../../../live-static mirror exactly what is published today
// (sha1-verified against the Netlify deploy API, see that doc). This plugin
// copies them in so a repo-driven `netlify deploy` does not drop them.
//
// Only `index.html` is intentionally overwritten: the Next app renders its
// own (much smaller) placeholder at "/", but the real site home has always
// been the static marketing page. Every other path here is additive only
// -- content-hashed Next asset filenames never collide with freshly built
// ones, and the marketing paths (learn/, assets/, campaign/, the top-level
// marketing css/js) do not exist anywhere in this repo's own output.
const fs = require("fs");
const path = require("path");

function copyRecursive(src, dest, { overwrite }) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry), { overwrite });
    }
    return;
  }
  if (!overwrite && fs.existsSync(dest)) {
    return; // additive only: never clobber a freshly built, same-named file
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

module.exports = {
  onPostBuild: async ({ constants, utils }) => {
    const liveStaticDir = path.join(__dirname, "..", "..", "..", "live-static");
    if (!fs.existsSync(liveStaticDir)) {
      console.log("[overlay-live-static] no live-static/ directory found, skipping");
      return;
    }
    const publishDir = constants.PUBLISH_DIR;
    if (!publishDir || !fs.existsSync(publishDir)) {
      utils.build.failPlugin(
        `[overlay-live-static] PUBLISH_DIR (${publishDir}) does not exist; expected @netlify/plugin-nextjs to have run first`
      );
      return;
    }

    let copied = 0;
    for (const entry of fs.readdirSync(liveStaticDir)) {
      const src = path.join(liveStaticDir, entry);
      const dest = path.join(publishDir, entry);
      // index.html is the one deliberate overwrite: the real site home is
      // the static marketing page, not the Next app's own placeholder.
      const overwrite = entry === "index.html";
      copyRecursive(src, dest, { overwrite });
      copied += 1;
    }
    console.log(
      `[overlay-live-static] merged ${copied} top-level live-only path(s) from live-static/ into ${publishDir}`
    );
  },
};
