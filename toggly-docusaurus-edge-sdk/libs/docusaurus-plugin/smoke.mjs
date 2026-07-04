const appKey = process.env.TOGGLY_SMOKE_APP_KEY_FRONTEND;

if (!appKey) {
  console.warn('SKIPPED: TOGGLY_SMOKE_APP_KEY_FRONTEND not configured');
  process.exit(0);
}

const { createTogglyClient } = await import('./dist/lib/toggly-client.js');

const client = createTogglyClient({
  baseURI: 'https://definitions.toggly.io',
  // Note: URL is constructed as baseURI/{appKey}/{environment}
  appKey,
  environment: 'Production',
  featureFlagsRefreshInterval: 0,
});

const flagOn = await client.getFlag('FlagOn');
const flagOff = await client.getFlag('FlagOff');

if (flagOn !== true) {
  throw new Error(`Expected FlagOn=true, received ${flagOn}`);
}

if (flagOff !== false) {
  throw new Error(`Expected FlagOff=false, received ${flagOff}`);
}
