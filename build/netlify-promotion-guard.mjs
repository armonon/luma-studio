// Netlify ignore commands return 0 to skip and 1 to build.
// Preview builds remain available; production requires an explicit release decision.
const preview = process.env.CONTEXT === 'deploy-preview';
const qualified = process.env.LUMA_PRODUCTION_BUILDS === 'on';
console.log(preview || qualified
  ? 'Building the preview or explicitly qualified release.'
  : 'Preserving production until the live overlay and runtime are qualified.');
process.exit(preview || qualified ? 1 : 0);
