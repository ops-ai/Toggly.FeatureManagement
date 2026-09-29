import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const compiledMiddleware = pathToFileURL(resolve(packageRoot, '.test-runtime/functions/_middleware.js'));

async function loadMiddleware() {
  return import(`${compiledMiddleware.href}?test=${Math.random()}`);
}

function installEdgeGlobals() {
  const originalCaches = globalThis.caches;
  const originalFetch = globalThis.fetch;
  const originalHtmlRewriter = globalThis.HTMLRewriter;
  const entries = new Map();
  const rewriters = [];

  class FakeHtmlRewriter {
    constructor() {
      this.handlers = new Map();
      rewriters.push(this);
    }

    on(selector, handler) {
      this.handlers.set(selector, handler);
      return this;
    }

    transform(response) {
      return response;
    }
  }

  globalThis.caches = {
    default: {
      async match(request) {
        return entries.get(request.url)?.clone();
      },
      async put(request, response) {
        entries.set(request.url, response.clone());
      },
    },
  };
  globalThis.HTMLRewriter = FakeHtmlRewriter;

  return {
    entries,
    rewriters,
    restore() {
      globalThis.caches = originalCaches;
      globalThis.fetch = originalFetch;
      globalThis.HTMLRewriter = originalHtmlRewriter;
    },
  };
}

function createContext({
  path = '/',
  manifest = {},
  env = {},
  next = async () => new Response('<html><head></head><body>page</body></html>', {
    headers: { 'content-type': 'text/html', 'content-length': '42' },
  }),
} = {}) {
  let manifestRequests = 0;
  const context = {
    request: new Request(`https://docs.example${path}`),
    env: {
      ASSETS: {
        async fetch() {
          manifestRequests += 1;
          return new Response(JSON.stringify(manifest), {
            headers: { 'content-type': 'application/json' },
          });
        },
      },
      TOGGLY_API_BASE_URL: 'https://flags.example/',
      TOGGLY_ENVIRONMENT: 'Production',
      TOGGLY_APP_KEY: 'fixture-app',
      ...env,
    },
    next,
  };
  return { context, getManifestRequests: () => manifestRequests };
}

test('skips asset and manifest requests before touching edge state', async () => {
  const edge = installEdgeGlobals();
  try {
    let nextRequests = 0;
    const { context, getManifestRequests } = createContext({
      path: '/assets/site.js',
      next: async () => {
        nextRequests += 1;
        return new Response('asset', { headers: { 'content-type': 'application/javascript' } });
      },
    });
    const response = await (await loadMiddleware()).onRequest(context);

    assert.equal(await response.text(), 'asset');
    assert.equal(nextRequests, 1);
    assert.equal(getManifestRequests(), 0);
    assert.equal(edge.entries.size, 0);
  } finally {
    edge.restore();
  }
});

test('blocks disabled page mappings and supports redirect behavior', async () => {
  const edge = installEdgeGlobals();
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ defs: { private: false } }), {
      headers: { 'content-type': 'application/json' },
    });

    const disabled = createContext({ path: '/private', manifest: { '/private/': 'private' } });
    const disabledResponse = await (await loadMiddleware()).onRequest(disabled.context);
    assert.equal(disabledResponse.status, 404);
    assert.equal(await disabledResponse.text(), 'Not Found');

    const redirected = createContext({
      path: '/private/',
      manifest: { '/private/': 'private' },
      env: {
        TOGGLY_PAGE_GATE_BEHAVIOR: 'redirect',
        TOGGLY_REDIRECT_URL: '/feature-unavailable',
      },
    });
    const redirectResponse = await (await loadMiddleware()).onRequest(redirected.context);
    assert.equal(redirectResponse.status, 302);
    assert.equal(
      redirectResponse.headers.get('location'),
      'https://docs.example/feature-unavailable',
    );
  } finally {
    edge.restore();
  }
});

test('fails open for unavailable flags and configures the HTML transformation', async () => {
  const edge = installEdgeGlobals();
  try {
    globalThis.fetch = async () => {
      throw new Error('flag service unavailable');
    };
    const { context } = createContext();
    const response = await (await loadMiddleware()).onRequest(context);

    assert.equal(response.headers.has('content-length'), false);
    const rewriter = edge.rewriters.at(-1);
    assert.ok(rewriter);

    const featureHandler = rewriter.handlers.get('[data-feature]');
    const removed = { value: false, getAttribute: name => name === 'data-feature' ? 'disabled' : null, remove() { this.value = true; } };
    featureHandler.element(removed);
    assert.equal(removed.value, true);

    const retained = { value: false, getAttribute: name => name === 'data-feature' ? 'disabled' : 'true', remove() { this.value = true; } };
    featureHandler.element(retained);
    assert.equal(retained.value, false);

    const injected = [];
    rewriter.handlers.get('head').element({ prepend: value => injected.push(value) });
    assert.deepEqual(injected, ['<script>window.__TOGGLY_EDGE_FLAGS__={};</script>']);
  } finally {
    edge.restore();
  }
});

test('escapes every closing script sequence in the edge flag snapshot', async () => {
  const edge = installEdgeGlobals();
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({
      defs: { markup: '</script></script>' },
    }), { headers: { 'content-type': 'application/json' } });
    const { context } = createContext();
    await (await loadMiddleware()).onRequest(context);

    const injected = [];
    edge.rewriters.at(-1).handlers.get('head').element({
      prepend: value => injected.push(value),
    });
    assert.deepEqual(injected, [
      '<script>window.__TOGGLY_EDGE_FLAGS__={"markup":"<\\/script><\\/script>"};</script>',
    ]);
  } finally {
    edge.restore();
  }
});

test('caches manifests and accepts a bare flag map response', async () => {
  const edge = installEdgeGlobals();
  try {
    let flagRequests = 0;
    globalThis.fetch = async () => {
      flagRequests += 1;
      return new Response(JSON.stringify({ enabled: true }), {
        headers: { 'content-type': 'application/json' },
      });
    };
    const middleware = await loadMiddleware();
    const first = createContext({ manifest: { '/': 'enabled' } });
    const second = createContext({ manifest: { '/': 'enabled' } });

    assert.equal((await middleware.onRequest(first.context)).status, 200);
    assert.equal((await middleware.onRequest(second.context)).status, 200);
    assert.equal(first.getManifestRequests(), 1);
    assert.equal(second.getManifestRequests(), 0);
    assert.equal(flagRequests, 1);
  } finally {
    edge.restore();
  }
});

test('handles missing app keys, unavailable flags, empty bodies, and non-HTML responses', async () => {
  const edge = installEdgeGlobals();
  try {
    let flagRequests = 0;
    globalThis.fetch = async () => {
      flagRequests += 1;
      return new Response('unavailable', { status: 503 });
    };

    const missingAppKey = createContext({ env: { TOGGLY_APP_KEY: '' } });
    await (await loadMiddleware()).onRequest(missingAppKey.context);
    assert.equal(flagRequests, 0);

    const emptyHtml = new Response(null, { headers: { 'content-type': 'text/html' } });
    const emptyBody = createContext({ next: async () => emptyHtml });
    assert.equal(await (await loadMiddleware()).onRequest(emptyBody.context), emptyHtml);

    const plainText = createContext({
      next: async () => new Response('plain text', { headers: { 'content-type': 'text/plain' } }),
    });
    const plainTextResponse = await (await loadMiddleware()).onRequest(plainText.context);
    assert.equal(await plainTextResponse.text(), 'plain text');
    assert.equal(edge.rewriters.length, 1);

    const unavailable = createContext();
    const unavailableResponse = await (await loadMiddleware()).onRequest(unavailable.context);
    assert.equal(unavailableResponse.status, 200);
    assert.equal(flagRequests, 1);
  } finally {
    edge.restore();
  }
});

test('fails open when the page-feature manifest cannot be read', async () => {
  const edge = installEdgeGlobals();
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ defs: {} }), {
      headers: { 'content-type': 'application/json' },
    });
    const unavailableManifest = createContext({ path: '/private/' });
    unavailableManifest.context.env.ASSETS.fetch = async () => new Response('missing', { status: 404 });

    const response = await (await loadMiddleware()).onRequest(unavailableManifest.context);
    assert.equal(response.status, 200);
    assert.equal(unavailableManifest.getManifestRequests(), 0);
  } finally {
    edge.restore();
  }
});

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}

async function waitForResponse(url) {
  let lastError;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      return await fetch(url);
    } catch (error) {
      lastError = error;
      await new Promise(resolveDelay => setTimeout(resolveDelay, 250));
    }
  }
  throw lastError;
}

test('rewrites a Docusaurus-like document in the real Cloudflare Pages runtime', async () => {
  const fixture = mkdtempSync(resolve(tmpdir(), 'toggly-pages-runtime-'));
  const staticDirectory = resolve(fixture, 'static');
  const flagsServer = createServer((_request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ defs: { enabled: true, disabled: false, private: false } }));
  });
  const flagsPort = await listen(flagsServer);
  const wranglerPort = 18980 + Math.floor(Math.random() * 900);
  const inspectorPort = 19980 + Math.floor(Math.random() * 900);
  let wrangler;

  try {
    mkdirSync(resolve(fixture, 'functions'), { recursive: true });
    mkdirSync(staticDirectory, { recursive: true });
    cpSync(resolve(packageRoot, 'functions/_middleware.ts'), resolve(fixture, 'functions/_middleware.ts'));
    writeFileSync(resolve(staticDirectory, 'index.html'), '<!doctype html><html><head><title>Fixture</title></head><body><div id="enabled" data-feature="enabled">enabled</div><div id="disabled" data-feature="disabled">disabled</div><div id="negated" data-feature="disabled" data-toggly-negate="true">negated</div></body></html>');
    writeFileSync(resolve(staticDirectory, 'toggly-page-features.json'), JSON.stringify({ '/private/': 'private' }));
    writeFileSync(resolve(staticDirectory, 'assets.js'), 'export const fixture = true;');

    wrangler = spawn(resolve(packageRoot, 'node_modules/.bin/wrangler'), [
      'pages', 'dev', staticDirectory,
      '--cwd', fixture,
      '--port', String(wranglerPort),
      '--inspector-port', String(inspectorPort),
      '--ip', '127.0.0.1',
      '--binding', `TOGGLY_API_BASE_URL=http://127.0.0.1:${flagsPort}`,
      '--binding', 'TOGGLY_ENVIRONMENT=Production',
      '--binding', 'TOGGLY_APP_KEY=fixture-app',
      '--persist-to', resolve(fixture, 'state'),
      '--log-level', 'error',
      '--show-interactive-dev-session=false',
    ], { stdio: 'pipe', env: { ...process.env, WRANGLER_LOG: 'none' } });

    const pageResponse = await waitForResponse(`http://127.0.0.1:${wranglerPort}/`);
    assert.equal(pageResponse.status, 200);
    const page = await pageResponse.text();
    assert.match(page, /window\.__TOGGLY_EDGE_FLAGS__=\{"enabled":true,"disabled":false,"private":false\}/);
    assert.match(page, /id="enabled"/);
    assert.doesNotMatch(page, /id="disabled"/);
    assert.match(page, /id="negated"/);

    const protectedResponse = await fetch(`http://127.0.0.1:${wranglerPort}/private/`);
    assert.equal(protectedResponse.status, 404);

    const assetResponse = await fetch(`http://127.0.0.1:${wranglerPort}/assets.js`);
    assert.equal(assetResponse.status, 200);
    assert.equal(await assetResponse.text(), 'export const fixture = true;');
  } finally {
    wrangler?.kill();
    flagsServer.close();
    rmSync(fixture, { recursive: true, force: true });
  }
});

after(() => rmSync(resolve(packageRoot, '.test-runtime'), { recursive: true, force: true }));
