const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { decodeBody } = require('./collector.cjs');

test('collector decodes plain and gzip JSON and preserves raw request bytes', () => {
  const plain = decodeBody({}, Buffer.from(JSON.stringify({ plain: true })));
  const zipped = zlib.gzipSync(Buffer.from(JSON.stringify({ zipped: true })));
  const compressed = decodeBody({ 'content-encoding': 'gzip' }, zipped);
  assert.deepEqual([plain.body, compressed.body], [{ plain: true }, { zipped: true }]);
  assert.ok(compressed.rawBody.length > 0);
  assert.equal(compressed.bodyText, '{"zipped":true}');
});

test('Gatsby plugin endpoints target only the local collector', () => {
  const config = require('../gatsby-config');
  const plugin = config.plugins.find(item => item.resolve === '@ops-ai/gatsby-feature-flags-toggly');
  assert.equal(plugin.options.metricsBaseUrl, 'http://127.0.0.1:8838/metrics');
  assert.equal(plugin.options.baseURI, 'http://127.0.0.1:8838/definitions');
  assert.equal(plugin.options.enableTelemetry, true);
  assert.equal(plugin.options.appKey, 'sample-browser-key');
  assert.equal(plugin.options.identity, 'sample-user-42');
  assert.equal(config.plugins.some(item => String(item).includes('file:') || String(item).includes('.tgz')), false);
});
