const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { getDefaultConfig } = require('@react-native/metro-config');
const { loadConfig } = require('metro-config');
const Metro = require('metro');
const esbuild = require('esbuild');
(async () => {
  // ESM is the bundler entry point advertised by the package's module field.
  const result = await esbuild.build({ stdin: { contents: "export { TogglyService } from '@ops-ai/react-native-toggly-core'", resolveDir: __dirname }, bundle: true, platform: 'node', format: 'esm', mainFields: ['module', 'main'], outfile: 'core-consumer.mjs', metafile: true });
  assert.ok(Object.keys(result.metafile.inputs).some(path => path.includes('react-native-toggly-core/dist/esm/')));
  const { TogglyService } = await import('./core-consumer.mjs');
  const client = new TogglyService({ featureDefaults: { on: true } });
  await client.init(); assert.equal(await client.isFeatureOn('on'), true); client.dispose();
  const config = await loadConfig({ cwd: __dirname }, getDefaultConfig(__dirname));
  config.maxWorkers = 1;
  config.resolver.useWatchman = false;
  config.watcher = { ...config.watcher, healthCheck: { enabled: false } };
  for (const platform of ['ios', 'android']) {
    const output = `${platform}.bundle`;
    await Metro.runBuild(config, { entry: 'entry.js', bundleOut: output, platform, dev: false, minify: false });
    const bundle = readFileSync(output, 'utf8');
    assert.ok(bundle.includes('/api/frontend/telemetry'));
    assert.ok(bundle.includes('TogglyProvider'));
    assert.ok(!bundle.includes('attachBrowserLifecycle'));
  }
  console.log('Packed ESM consumer and React Native iOS/Android Metro bundles passed; portable reporter included, browser adapter absent.');
})().catch(error => { console.error(error); process.exitCode = 1; });
