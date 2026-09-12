import { mkdtemp, cp, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const temporary = await mkdtemp(join(tmpdir(), 'toggly-sveltekit-host-'));
const host = join(temporary, 'host');
const run = (command, args, cwd, env = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
      process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
      process.stderr.write(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve(output) : reject(new Error(`${command} exited ${code}`)),
    );
  });
let app;
let server;
let sockets;
const pending = [];
try {
  await run('npm', ['run', 'build'], root);
  await run(process.execPath, [join(root, 'tests/offline-process.mjs')], root);
  await run('npm', ['pack', '--pack-destination', temporary], root);
  await cp(join(root, 'tests/host'), host, { recursive: true });
  // Optional candidate artifacts are temporary install inputs only, never written into a manifest/lock.
  const shared = JSON.parse(process.env.TOGGLY_SHARED_ARTIFACTS ?? '[]');
  if (!Array.isArray(shared) || shared.some((value) => typeof value !== 'string'))
    throw new Error('TOGGLY_SHARED_ARTIFACTS must be a JSON string array');
  await run(
    'npm',
    [
      'install',
      '--no-save',
      '--package-lock=false',
      join(temporary, 'ops-ai-toggly-sveltekit-0.1.0.tgz'),
      ...shared,
    ],
    host,
  );
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
  const boundary = spawn(
    process.execPath,
    [
      '--conditions=browser',
      '--input-type=module',
      '-e',
      "await import('@ops-ai/toggly-sveltekit/server')",
    ],
    { cwd: host, stdio: 'ignore' },
  );
  if ((await once(boundary, 'close'))[0] === 0)
    throw new Error('Server export resolved under browser conditions');
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
    requests: [],
    connections: 0,
    closes: 0,
    jwks: 0,
    pending: 0,
    completed: 0,
  };
  server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Expose-Headers', 'ETag');
    if (req.method === 'OPTIONS') {
      res.end();
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
          on: state.enabled && url.searchParams.get('u') === 'alice',
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
    if (!backend && state.delayUser && url.searchParams.get('u') === state.delayUser) {
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
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  app.stdout.pipe(process.stdout);
  app.stderr.pipe(process.stderr);
  for (let count = 0; count < 100; count++) {
    try {
      await fetch(origin + '/server');
      break;
    } catch {
      if (count === 99) throw new Error('Host did not start');
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  await writeFile(
    join(temporary, 'playwright.config.mjs'),
    `export default ${JSON.stringify({ testDir: join(root, 'tests/host-browser'), workers: 1, use: { baseURL: origin }, reporter: 'line' })};`,
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
} finally {
  for (const resume of pending.splice(0)) resume();
  if (app) {
    app.kill('SIGTERM');
    await Promise.race([once(app, 'close'), new Promise((resolve) => setTimeout(resolve, 3000))]);
    if (app.exitCode === null) app.kill('SIGKILL');
  }
  if (sockets) {
    for (const socket of sockets.clients) socket.terminate();
    await new Promise((resolve) => sockets.close(resolve));
  }
  if (server) await new Promise((resolve) => server.close(resolve));
  await rm(temporary, { recursive: true, force: true });
}
