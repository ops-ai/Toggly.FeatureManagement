const assert = require('node:assert/strict');
const esbuild = require('esbuild');
(async () => {
  // Peer-floor host proves install + ESM resolve against RN 0.70 without Metro
  // (@react-native/metro-config starts at 0.72; full Metro stays on the current host).
  const result = await esbuild.build({
    stdin: {
      contents: "export { TogglyService } from '@ops-ai/react-native-toggly-core'",
      resolveDir: __dirname,
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    mainFields: ['module', 'main'],
    outfile: 'core-consumer.mjs',
    metafile: true,
  });
  assert.ok(Object.keys(result.metafile.inputs).some(path => path.includes('react-native-toggly-core/dist/esm/')));
  const { TogglyService } = await import('./core-consumer.mjs');
  const client = new TogglyService({ featureDefaults: { on: true } });
  await client.init();
  assert.equal(await client.isFeatureOn('on'), true);
  client.dispose();
  console.log('Packed peer-floor ESM consumer passed on React Native 0.70.15 (Metro deferred to current host).');
})().catch(error => { console.error(error); process.exitCode = 1; });
