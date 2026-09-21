import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readdir, readFile } from 'node:fs/promises';
import { createRequestHandler } from 'react-router';
import * as build from './build/server/index.js';

const handler = createRequestHandler(build, 'production');

test('packed framework build hydrates flags and identity from the loader', async () => {
  const response = await handler(new Request('http://localhost/'));
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /server rendered feature/);
  assert.match(html, /id="hidden">false</);
  // Hydrated loader snapshot should carry the request identity and flag keys.
  assert.match(html, /host-user-1/);
  assert.match(html, /Visible/);
  assert.match(html, /Hidden/);
});

test('packed action denies a disabled feature through the real framework handler', async () => {
  const response = await handler(
    new Request('http://localhost/?index', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: '',
    }),
  );
  assert.equal(response.status, 403);
});

test('browser production chunks exclude server-only modules', async () => {
  const files = await readdir('build/client/assets');
  const source = (
    await Promise.all(
      files.filter((f) => f.endsWith('.js')).map((f) => readFile(`build/client/assets/${f}`, 'utf8')),
    )
  ).join('\n');
  assert.equal(
    /from[\"']ws[\"']|require\([\"']ws[\"']\)|grpc-js|createServerClient|node:fs|node:crypto|\/api\/usage\/stats|\/api\/metrics|protobufjs|UsageBatcher|MetricsBatcher/.test(
      source,
    ),
    false,
    'server implementation leaked into browser chunks',
  );
});
