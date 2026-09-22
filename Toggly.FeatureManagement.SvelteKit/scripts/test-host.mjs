import { mkdtemp, cp, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import { chromium } from '@playwright/test';
import { run, cleanupAll, closeBrowser, stopChild } from './host-resources.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const temporary = await mkdtemp(join(tmpdir(), 'toggly-sveltekit-host-'));
const host = join(temporary, 'host');
let app;
let server;
let sockets;
let browser;
let failure;
console.log('Owned packed host root:', temporary);
const pending = [];
try {
  await run(process.execPath, [join(root, 'scripts/host-resource-controls.mjs')], root, {}, 90000);
  await run('npm', ['run', 'build'], root);
  await run(process.execPath, [join(root, 'tests/offline-process.mjs')], root);
  await run('npm', ['pack', '--pack-destination', temporary], root);
  await cp(join(root, 'tests/host'), host, { recursive: true });
  const archive = join(
    temporary,
    `ops-ai-toggly-sveltekit-${JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version}.tgz`,
  );
  await run('npm', ['install', '--package-lock-only', '--ignore-scripts', archive], host);
  await run('npm', ['ci', '--no-audit', '--no-fund'], host);
  await run(
    'npm',
    [
      'ls',
      '@ops-ai/toggly-client-telemetry',
      '@sveltejs/kit',
      'svelte',
      '@sveltejs/adapter-node',
      '--json',
    ],
    host,
  );
  const lock = JSON.parse(await readFile(join(host, 'package-lock.json'), 'utf8'));
  console.log(
    'Packed provenance',
    JSON.stringify({
      archiveSha256: createHash('sha256')
        .update(await readFile(archive))
        .digest('hex'),
      lockSha256: createHash('sha256')
        .update(await readFile(join(host, 'package-lock.json')))
        .digest('hex'),
      node: process.version,
      playwright: JSON.parse(
        await readFile(join(root, 'node_modules/@playwright/test/package.json'), 'utf8'),
      ).version,
    }),
  );
  const reporter = lock.packages['node_modules/@ops-ai/toggly-client-telemetry'];
  if (reporter?.version !== '1.1.0' || !reporter.resolved.startsWith('https://registry.npmjs.org/'))
    throw new Error('Reporter must come from the public registry');
  await run('npm', ['run', 'check'], host);
  const built = await run('npm', ['run', 'build'], host);
  if (built.includes('externalized for browser compatibility'))
    throw new Error('A Node module leaked into the browser build');
  async function inspect(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await inspect(path);
      else if (entry.name.endsWith('.js')) {
        const body = await readFile(path, 'utf8');
        if (
          /backend-private-fixture|server-secret|toggly-node-core|node:crypto|node:module|@grpc|definitions-signed/.test(
            body,
          )
        )
          throw new Error(`Server secret/import leaked: ${path}`);
      }
    }
  }
  await inspect(join(host, '.svelte-kit/output/client'));
  await run(
    process.execPath,
    [
      '--conditions=browser',
      '--input-type=module',
      '-e',
      "try { await import('@ops-ai/toggly-sveltekit/server'); process.exitCode = 1; } catch(error) { if (error.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error; }",
    ],
    host,
  );
  let pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  let jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  jwk.kid =
    createHash('sha1')
      .update(Buffer.from(jwk.x, 'base64url'))
      .update(Buffer.from(jwk.y, 'base64url'))
      .digest('hex')
      .toUpperCase() + 'ES256';
  jwk.alg = 'ES256';
  const sign = async (defs) => {
    const raw = JSON.stringify(defs);
    const timestamp = Math.floor(Date.now() / 1000);
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(raw + '|' + timestamp),
    );
    const signature = Buffer.from(
      await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, digest),
    ).toString('base64');
    return JSON.stringify({ defs, signature, timestamp, kid: jwk.kid });
  };
  const state = {
    enabled: true,
    revision: 'r1',
    invalid: false,
    shape: null,
    offline: false,
    delayUser: '',
    delayBrowserUser: '',
    requests: [],
    connections: 0,
    closes: 0,
    jwks: 0,
    pending: 0,
    completed: 0,
    telemetry: [],
    telemetryPreflights: [],
  };
  server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Expose-Headers', 'ETag');
    if (req.method === 'OPTIONS') {
      if (url.pathname === '/metrics/api/frontend/telemetry')
        state.telemetryPreflights.push(req.headers);
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.end();
      return;
    }
    if (url.pathname === '/metrics/api/frontend/telemetry') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const raw = Buffer.concat(chunks);
      const plain = req.headers['content-encoding'] === 'gzip' ? gunzipSync(raw) : raw;
      state.telemetry.push({
        body: JSON.parse(plain.toString()),
        headers: req.headers,
        bytes: plain.length,
      });
      res.writeHead(202).end();
      return;
    }
    if (url.pathname === '/control') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const changes = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      const { message, rotate, release, ...settings } = changes;
      if (rotate) {
        pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
          'sign',
          'verify',
        ]);
        jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
        jwk.kid =
          createHash('sha1')
            .update(Buffer.from(jwk.x, 'base64url'))
            .update(Buffer.from(jwk.y, 'base64url'))
            .digest('hex')
            .toUpperCase() + 'ES256';
        jwk.alg = 'ES256';
      }
      Object.assign(state, settings);
      if (release) for (const resume of pending.splice(0)) resume();
      if (message !== undefined)
        for (const socket of sockets.clients)
          socket.send(typeof message === 'string' ? message : JSON.stringify(message));
      res.end('{}');
      return;
    }
    if (url.pathname === '/state') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ...state, active: sockets.clients.size }));
      return;
    }
    if (url.pathname === '/.well-known/jwks') {
      state.jwks++;
      res.end(JSON.stringify({ keys: [jwk] }));
      return;
    }
    if (state.offline) {
      res.writeHead(503);
      res.end();
      return;
    }
    const backend = url.pathname.startsWith('/definitions-signed/');
    state.requests.push({
      path: url.pathname,
      user: url.searchParams.get('u'),
      instanceId: url.searchParams.get('i'),
      query: [...url.searchParams],
      browser: Boolean(req.headers.origin),
      revision: req.headers['if-none-match'] ?? null,
      pin: url.searchParams.get('rev'),
      claims: url.searchParams.get('claim.role'),
      groups: url.searchParams.getAll('g'),
    });
    const defs = backend
      ? [
          {
            featureKey: 'on',
            filters: [{ name: 'Targeting', parameters: { 'Audience.Users:0': 'alice' } }],
          },
          { featureKey: 'off', filters: [] },
          {
            featureKey: 'Order',
            contextKind: 'Order',
            filters: [
              {
                name: 'ContextProperty',
                parameters: { Property: 'Vip', Operator: 'eq', Value: 'true' },
              },
            ],
          },
          { featureKey: 'backend-rule-only', filters: [{ name: 'AlwaysOn' }] },
        ]
      : {
          on:
            state.enabled &&
            (url.searchParams.get('i') === 'token-a' ||
              (!url.searchParams.has('i') && url.searchParams.get('u') === 'alice')),
          off: false,
          Order: {
            requirement: 'all',
            rules: [{ property: 'Vip', op: 'eq', value: 'true', type: 'boolean' }],
          },
          'not-exposed': true,
        };
    if (!backend && state.shape !== null) defs.Order = state.shape;
    const body = state.invalid ? '{}' : await sign(defs);
    const revision = state.revision;
    if (
      !backend &&
      ((state.delayUser && url.searchParams.get('u') === state.delayUser) ||
        (req.headers.origin &&
          state.delayBrowserUser &&
          url.searchParams.get('u') === state.delayBrowserUser))
    ) {
      state.pending++;
      await new Promise((resolve) => pending.push(resolve));
      state.pending--;
      state.completed++;
    }
    if (!backend && req.headers['if-none-match'] === revision) {
      res.writeHead(304, { ETag: revision });
      res.end();
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('ETag', revision);
    res.end(body);
  });
  sockets = new WebSocketServer({ server });
  sockets.on('connection', (socket) => {
    state.connections++;
    socket.on('close', () => state.closes++);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const definitions = `http://127.0.0.1:${server.address().port}`;
  const port = await new Promise((resolve) => {
    const probe = createServer();
    probe.listen(0, '127.0.0.1', () => {
      const p = probe.address().port;
      probe.close(() => resolve(p));
    });
  });
  const origin = `http://127.0.0.1:${port}`;
  app = spawn(process.execPath, ['build'], {
    cwd: host,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      ORIGIN: origin,
      TOGGLY_APP_KEY: 'backend-private-fixture',
      TOGGLY_BASE_URI: definitions,
    },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  app.stdout.pipe(process.stdout);
  app.stderr.pipe(process.stderr);
  for (let count = 0; count < 100; count++) {
    try {
      await fetch(origin + '/server', { signal: AbortSignal.timeout(2000) });
      break;
    } catch {
      if (count === 99) throw new Error('Host did not start');
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  browser = await chromium.launchServer({ headless: true, timeout: 30000 });
  console.log('Owned browser PID:', browser.process().pid);
  await writeFile(
    join(temporary, 'playwright.config.mjs'),
    `export default ${JSON.stringify({ testDir: join(root, 'tests/host-browser'), workers: 1, use: { baseURL: origin, connectOptions: { wsEndpoint: browser.wsEndpoint() } }, reporter: 'line' })};`,
  );
  await run(
    process.execPath,
    [
      join(root, 'node_modules/@playwright/test/cli.js'),
      'test',
      '--config',
      join(temporary, 'playwright.config.mjs'),
    ],
    root,
    { TOGGLY_HOST_DEFINITIONS: definitions },
  );
  console.log(
    'Packed SvelteKit host: typecheck, build, server/browser export boundary and Chromium protocol checks passed.',
  );
} catch (error) {
  failure = error;
} finally {
  await cleanupAll(
    [
      () => closeBrowser(browser),
      () => stopChild(app),
      async () => {
        for (const resume of pending.splice(0)) resume();
      },
      async () => {
        if (sockets) {
          for (const socket of sockets.clients) socket.terminate();
          await new Promise((resolve) => sockets.close(resolve));
        }
      },
      async () => {
        if (server) {
          server.closeAllConnections();
          await new Promise((resolve) => server.close(resolve));
        }
      },
      async () => {
        await rm(temporary, { recursive: true, force: true });
        console.log('Owned packed host root removed:', temporary);
      },
    ],
    failure,
  );
}
