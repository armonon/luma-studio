/**
 * The origin this build is deployed under.
 *
 * The desktop app has no server of its own, so it calls the hosted API by
 * absolute URL; the marketing metadata needs the same origin for canonical and
 * Open Graph links. Those two used to carry separate copies of the hostname,
 * with a third inside the Tauri CSP allow-list, so moving hosts meant finding
 * all three. This is the one place to change it — `tests/desktop-config.test.ts`
 * pins the CSP to this value, since a JSON config file cannot import it.
 *
 * `NEXT_PUBLIC_SITE_URL` overrides it; `URL` is what Netlify injects.
 */
export const DEFAULT_DEPLOY_ORIGIN = "https://luma-studio-preview.armonon.chatgpt.site";

// Guarded: the desktop bundle runs outside Node and has no `process`.
const configured = typeof process !== "undefined"
  ? process.env?.NEXT_PUBLIC_SITE_URL || process.env?.URL
  : undefined;

export const DEPLOY_ORIGIN = configured || DEFAULT_DEPLOY_ORIGIN;
