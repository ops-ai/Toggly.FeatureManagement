// @vitest-environment jsdom
import React from 'react';
import { createHash, generateKeyPairSync, sign, webcrypto } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { TogglyProvider, useFlag, useToggly, type TogglyContextValue } from './index';
import { createTogglyClient, type TogglyConfig } from '../lib/toggly-client';

afterEach(async () => {
  cleanup();
  await Promise.resolve();
  vi.unstubAllGlobals();
  delete (window as unknown as Record<string, unknown>).__TOGGLY_EDGE_FLAGS__;
});
function collector() {
  vi.stubGlobal('CompressionStream', undefined);
  vi.stubGlobal('WebSocket', undefined);
  const bodies: Array<Record<string, unknown>> = [];
  const telemetryFetch: NonNullable<TogglyConfig['telemetryFetch']> = async (_url, init) => {
    if (typeof init.body !== 'string') throw new Error('Expected uncompressed fixture body');
    bodies.push(JSON.parse(init.body));
    return { status: 202 };
  };
  return { bodies, telemetryFetch };
}
it('uses a minted token for definitions and telemetry without leaking targeting query defaults', async () => {
  const c = collector();
  const urls: string[] = [];
  const client = createTogglyClient({
    appKey: 'app',
    identity: 'alice',
    instanceId: ' token-a ',
    groups: ['staff'],
    claims: { role: 'admin' },
    baseURI:
      'https://definitions.invalid/root/?u=base-user&userId=old&g=first&g=second&claim.old=secret&claim.old=other&i=old&keep=one&keep=two#fragment',
    telemetryFetch: c.telemetryFetch,
    fetch: async (input) => {
      urls.push(String(input));
      return new Response('{"on":true}');
    },
  } as TogglyConfig);
  try {
    expect(await client.getFlag('on')).toBe(true);
    await client.flushTelemetry();
    const url = new URL(urls[0]);
    expect(url.pathname).toBe('/root/evaluated-signed/app/Production');
    const params = url.searchParams;
    expect(params.getAll('keep')).toEqual(['one', 'two']);
    expect(params.has('userId')).toBe(false);
    expect(params.get('i')).toBe('token-a');
    expect(params.has('u')).toBe(false);
    expect(params.has('g')).toBe(false);
    expect([...params.keys()].some((key) => key.startsWith('claim.'))).toBe(false);
    expect(c.bodies).toEqual([
      { k: 'app', e: 'Production', i: 'token-a', f: { on: { enabled: [1] } } },
    ]);
  } finally {
    client.dispose();
  }
});
it('retains one queue across provider targeting changes and uses new-context defaults on failure', async () => {
  const c = collector();
  let context!: TogglyContextValue;
  const Reader = () => {
    context = useToggly();
    const result = useFlag('on');
    return <span>{result.isReady ? String(result.enabled) : 'pending'}</span>;
  };
  const fetch: typeof globalThis.fetch = async (input) => {
    if (new URL(String(input)).searchParams.get('u') === 'alice')
      return new Response('{"on":true}');
    throw new Error('offline for new context');
  };
  const config = {
    appKey: 'app',
    telemetryFetch: c.telemetryFetch,
    fetch,
    flagDefaults: { on: false },
  };
  const host = render(
    <TogglyProvider config={{ ...config, identity: 'alice' }}>
      <Reader />
    </TogglyProvider>
  );
  await waitFor(() => expect(host.getByText('true')).toBeTruthy());
  context.recordUsage('before');
  host.rerender(
    <TogglyProvider config={{ ...config, identity: 'bob' }}>
      <Reader />
    </TogglyProvider>
  );
  await waitFor(() => expect(host.getByText('false')).toBeTruthy());
  expect(c.bodies).toEqual([]);
  context.recordView('after');
  await context.flushTelemetry();
  expect(c.bodies).toEqual([
    {
      k: 'app',
      e: 'Production',
      u: 'alice',
      f: { on: { enabled: [1] }, before: { enabled: [0, 1] } },
    },
    {
      k: 'app',
      e: 'Production',
      u: 'bob',
      f: { on: { disabled: [1] }, after: { enabled: [0, 0, 1] } },
    },
  ]);
});
it('discards a replaced transport queue instead of sending it during owner cleanup', async () => {
  const c = collector();
  let context!: TogglyContextValue;
  const Reader = () => {
    context = useToggly();
    return null;
  };
  const config = {
    appKey: 'app',
    telemetryFetch: c.telemetryFetch,
    fetch: async () => new Response('{}'),
  };
  const host = render(
    <TogglyProvider config={config}>
      <Reader />
    </TogglyProvider>
  );
  await act(async () => {
    await Promise.resolve();
  });
  context.recordUsage('retired');
  host.rerender(
    <TogglyProvider config={{ ...config, enableTelemetry: false }}>
      <Reader />
    </TogglyProvider>
  );
  await act(async () => {
    await Promise.resolve();
  });
  expect(c.bodies).toEqual([]);
});

it('replaces a provider reporter when only its transport callback changes', async () => {
  const old = collector();
  const current = collector();
  let context!: TogglyContextValue;
  const Reader = () => {
    context = useToggly();
    return null;
  };
  const config = { appKey: 'app', fetch: async () => new Response('{}') };
  const host = render(
    <TogglyProvider config={{ ...config, telemetryFetch: old.telemetryFetch }}>
      <Reader />
    </TogglyProvider>
  );
  context.recordUsage('retired');
  host.rerender(
    <TogglyProvider config={{ ...config, telemetryFetch: current.telemetryFetch }}>
      <Reader />
    </TogglyProvider>
  );
  context.recordUsage('current');
  await act(async () => {
    await Promise.resolve();
  });
  await context.flushTelemetry();
  expect(old.bodies).toEqual([]);
  expect(current.bodies).toEqual([
    { k: 'app', e: 'Production', f: { current: { enabled: [0, 1] } } },
  ]);
});

it('never reuses the page baked snapshot after a token transition, including returning to the original token', async () => {
  const c = collector();
  vi.stubGlobal('__TOGGLY_STATIC_GATING__', true);
  vi.stubGlobal('__TOGGLY_BUILD_FLAGS__', { on: true });
  let context!: TogglyContextValue;
  const Reader = () => {
    context = useToggly();
    const flag = useFlag('on');
    return <span>{String(flag.enabled)}</span>;
  };
  const fetch = vi.fn();
  const config = {
    appKey: 'app',
    fetch,
    telemetryFetch: c.telemetryFetch,
    flagDefaults: { on: false },
  };
  const tree = (instanceId: string) => (
    <TogglyProvider config={{ ...config, instanceId } as TogglyConfig}>
      <Reader />
    </TogglyProvider>
  );
  const host = render(tree('token-a'));
  expect(host.getByText('true')).toBeTruthy();
  host.rerender(tree('token-b'));
  await waitFor(() => expect(host.getByText('false')).toBeTruthy());
  host.rerender(tree('token-a'));
  await waitFor(() => expect(host.getByText('false')).toBeTruthy());
  await context.flushTelemetry();
  expect(fetch).not.toHaveBeenCalled();
  expect(c.bodies).toEqual([
    { k: 'app', e: 'Production', i: 'token-a', f: { on: { enabled: [1] } } },
    { k: 'app', e: 'Production', i: 'token-b', f: { on: { disabled: [1] } } },
    { k: 'app', e: 'Production', i: 'token-a', f: { on: { disabled: [1] } } },
  ]);
});
it('freezes the rendered Boolean snapshot before consumers can mutate the public flags map', async () => {
  const c = collector();
  let context!: TogglyContextValue;
  const Reader = () => {
    context = useToggly();
    return null;
  };
  const host = render(
    <TogglyProvider
      config={{
        appKey: 'app',
        identity: 'alice',
        telemetryFetch: c.telemetryFetch,
        fetch: async () => new Response('{"on":true}'),
      }}
    >
      <Reader />
    </TogglyProvider>
  );
  await waitFor(() => expect(context.isReady).toBe(true));
  context.flags.on = false;
  expect(context.evaluateFlag('on')).toBe(true);
  await context.flushTelemetry();
  expect(c.bodies).toEqual([
    { k: 'app', e: 'Production', u: 'alice', f: { on: { enabled: [1] } } },
  ]);
  host.unmount();
});
it('keeps the latest target through StrictMode replacement and a late retired request', async () => {
  const c = collector();
  let context!: TogglyContextValue;
  let finish!: (response: Response) => void;
  let signal!: AbortSignal;
  const Reader = () => {
    context = useToggly();
    const flag = useFlag('on');
    return <span>{flag.isReady ? String(flag.enabled) : 'pending'}</span>;
  };
  const fetch: typeof globalThis.fetch = (input, init) => {
    if (new URL(String(input)).searchParams.get('u') === 'alice') {
      signal = init!.signal!;
      return new Promise((resolve) => {
        finish = resolve;
      });
    }
    return Promise.resolve(new Response('{"on":false}'));
  };
  const config = { appKey: 'app', telemetryFetch: c.telemetryFetch, fetch };
  const tree = (identity: string) => (
    <React.StrictMode>
      <TogglyProvider config={{ ...config, identity }}>
        <Reader />
      </TogglyProvider>
    </React.StrictMode>
  );
  const host = render(tree('alice'));
  context.recordUsage('old');
  host.rerender(tree('bob'));
  context.recordUsage('immediate');
  await waitFor(() => expect(host.getByText('false')).toBeTruthy());
  expect(signal.aborted).toBe(true);
  await act(async () => {
    finish(new Response('{"on":true}'));
  });
  expect(host.getByText('false')).toBeTruthy();
  await context.flushTelemetry();
  expect(c.bodies).toEqual([
    { k: 'app', e: 'Production', u: 'alice', f: { old: { enabled: [0, 1] } } },
    {
      k: 'app',
      e: 'Production',
      u: 'bob',
      f: { immediate: { enabled: [0, 1] }, on: { disabled: [1] } },
    },
  ]);
});
it('does not create telemetry resources after a diagnostic reentrantly disposes the client', async () => {
  vi.useFakeTimers();
  const c = collector();
  const client = createTogglyClient({
    appKey: 'app',
    telemetryFetch: c.telemetryFetch,
    telemetryFlushIntervalMs: 1,
    onTelemetryDiagnostic: () => client.dispose(),
  });
  try {
    client.recordUsage('retired');
    await client.flushTelemetry();
    expect(c.bodies).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    client.dispose();
    vi.useRealTimers();
  }
});
it('shares admission capacity across 2200 provider target transitions', async () => {
  const c = collector();
  vi.stubGlobal('__TOGGLY_STATIC_GATING__', true);
  vi.stubGlobal('__TOGGLY_BUILD_FLAGS__', {});
  let context!: TogglyContextValue;
  const Reader = () => {
    context = useToggly();
    return null;
  };
  const config = { appKey: 'app', telemetryFetch: c.telemetryFetch };
  const tree = (identity: string) => (
    <TogglyProvider config={{ ...config, identity }}>
      <Reader />
    </TogglyProvider>
  );
  const host = render(tree('user-0'));
  const start = performance.now();
  for (let i = 0; i < 2200; i++) {
    if (i) host.rerender(tree(`user-${i}`));
    context.recordUsage('entry');
  }
  expect(c.bodies).toEqual([]);
  await context.flushTelemetry();
  expect(c.bodies).toHaveLength(2000);
  expect(c.bodies[0]).toEqual({
    k: 'app',
    e: 'Production',
    u: 'user-0',
    f: { entry: { enabled: [0, 1] } },
  });
  expect(c.bodies[1999]).toEqual({
    k: 'app',
    e: 'Production',
    u: 'user-1999',
    f: { entry: { enabled: [0, 1] } },
  });
  expect(
    c.bodies.reduce(
      (bytes, body) => bytes + new TextEncoder().encode(JSON.stringify(body)).byteLength,
      0
    )
  ).toBeLessThanOrEqual(256 * 1024);
  console.info(
    `Docusaurus 2200-target admission duration: ${Math.round(performance.now() - start)}ms`
  );
  // Coverage measured 4.1s locally; retain the complete stress case with bounded CI headroom.
}, 15000);

it('captures a selected Boolean before a lazy reporter diagnostic mutates its input', async () => {
  const c = collector();
  const flags = { on: true };
  const client = createTogglyClient({
    appKey: 'app',
    telemetryFetch: c.telemetryFetch,
    telemetryFlushIntervalMs: 1,
    onTelemetryDiagnostic: () => {
      flags.on = false;
    },
  });
  try {
    expect(client.evaluateFlag('on', flags)).toBe(true);
    await client.flushTelemetry();
    expect(c.bodies).toEqual([{ k: 'app', e: 'Production', f: { on: { enabled: [1] } } }]);
  } finally {
    client.dispose();
  }
});
it('keeps signed key lookup separate from configured targeting queries and fragments', async () => {
  const c = collector();
  vi.stubGlobal('crypto', webcrypto);
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const kid =
    createHash('sha1')
      .update(Buffer.from(jwk.x!, 'base64url'))
      .update(Buffer.from(jwk.y!, 'base64url'))
      .digest('hex')
      .toUpperCase() + 'ES256';
  const defs = { on: true },
    timestamp = Math.floor(Date.now() / 1000);
  const signature = sign(
    'sha256',
    createHash('sha256')
      .update(`${JSON.stringify(defs)}|${timestamp}`)
      .digest(),
    { key: privateKey, dsaEncoding: 'ieee-p1363' }
  ).toString('base64');
  const urls: URL[] = [];
  const client = createTogglyClient({
    appKey: 'app',
    instanceId: 'A',
    baseURI: 'https://definitions.test/root?i=old&u=old&keep=yes#part',
    verifySignatures: true,
    allowedKeyIds: [kid],
    telemetryFetch: c.telemetryFetch,
    fetch: async (input) => {
      const url = new URL(String(input));
      urls.push(url);
      if (url.pathname === '/root/.well-known/jwks' && !url.search && !url.hash)
        return new Response(JSON.stringify({ keys: [{ ...jwk, kid, alg: 'ES256', use: 'sig' }] }));
      if (url.pathname === '/root/evaluated-signed/app/Production')
        return new Response(JSON.stringify({ defs, kid, timestamp, signature }));
      return new Response('{}', { status: 404 });
    },
  });
  try {
    expect(await client.getFlag('on')).toBe(true);
    expect(urls.map((url) => url.pathname)).toEqual([
      '/root/evaluated-signed/app/Production',
      '/root/.well-known/jwks',
    ]);
    await client.flushTelemetry();
    expect(c.bodies).toEqual([{ k: 'app', e: 'Production', i: 'A', f: { on: { enabled: [1] } } }]);
  } finally {
    client.dispose();
  }
});
it('keeps the definition deadline active through a held response body', async () => {
  const c = collector();
  let signal: AbortSignal | null | undefined;
  const client = createTogglyClient({
    appKey: 'app',
    connectTimeout: 20,
    telemetryFetch: c.telemetryFetch,
    flagDefaults: { on: false },
    fetch: async (_input, init) => {
      signal = init?.signal;
      return new Response(
        new ReadableStream({
          start(controller) {
            signal?.addEventListener('abort', () => controller.error(new Error('body aborted')), {
              once: true,
            });
          },
        })
      );
    },
  });
  try {
    expect(await client.getFlags()).toEqual({ on: false });
    expect(signal?.aborted).toBe(true);
  } finally {
    client.dispose();
  }
}, 1000);

it('keeps live-update connection paths separate from configured targeting queries', () => {
  collector();
  const urls: string[] = [];
  class Socket {
    onopen: (() => void) | null = null;
    onclose: (() => void) | null = null;
    onmessage: (() => void) | null = null;
    onerror: (() => void) | null = null;
    close() {}
    constructor(url: string | URL) {
      urls.push(String(url));
    }
  }
  vi.stubGlobal('WebSocket', Socket);
  const client = createTogglyClient({
    appKey: 'app',
    instanceId: 'A',
    baseURI: 'https://definitions.test/root?i=retired&u=private&g=secret#part',
  });
  try {
    client.startWebSocket();
    expect(urls).toEqual(['wss://definitions.test/root/app/ws']);
  } finally {
    client.dispose();
  }
});

it.each([false, true])(
  'keeps runtime/static=%s hook and Feature reads authoritative after public mutation',
  async (staticGating) => {
    const c = collector();
    vi.stubGlobal('__TOGGLY_STATIC_GATING__', staticGating);
    vi.stubGlobal('__TOGGLY_BUILD_FLAGS__', { on: true });
    const { Feature } = await import('./index');
    let context!: TogglyContextValue;
    const Reader = () => {
      context = useToggly();
      const flag = useFlag('on');
      return (
        <span data-testid="authoritative">{flag.isReady ? String(flag.enabled) : 'pending'}</span>
      );
    };
    const fetch = vi.fn(
      async (url: RequestInfo | URL) =>
        new Response(JSON.stringify({ on: new URL(String(url)).searchParams.get('u') === 'alice' }))
    );
    let identity = 'alice';
    const config = {
      appKey: 'app',
      fetch,
      telemetryFetch: c.telemetryFetch,
      flagDefaults: { on: false },
    };
    const tree = () => (
      <TogglyProvider config={{ ...config, identity }}>
        <Reader />
        <Feature flag="on">Visible authoritative</Feature>
        <Feature flag="missing" defaultValue negate>
          Hidden fallback
        </Feature>
      </TogglyProvider>
    );
    const host = render(tree());
    await waitFor(() => expect(host.getByTestId('authoritative').textContent).toBe('true'));
    context.flags.on = false;
    host.rerender(tree());
    expect(host.getByTestId('authoritative').textContent).toBe('true');
    expect(host.getByText('Visible authoritative')).toBeTruthy();
    expect(host.queryByText('Hidden fallback')).toBeNull();
    expect(context.evaluateFlag('on')).toBe(true);
    await context.flushTelemetry();
    expect(c.bodies).toEqual([
      {
        k: 'app',
        e: 'Production',
        u: 'alice',
        f: { on: { enabled: [3] }, missing: { enabled: [1] } },
      },
    ]);
    identity = 'bob';
    host.rerender(tree());
    await waitFor(() => expect(host.getByTestId('authoritative').textContent).toBe('false'));
    expect(host.queryByText('Visible authoritative')).toBeNull();
    await context.flushTelemetry();
    expect(c.bodies[1]).toEqual({
      k: 'app',
      e: 'Production',
      u: 'bob',
      f: { on: { disabled: [2] }, missing: { enabled: [1] } },
    });
    expect(c.bodies).toHaveLength(2);
    if (staticGating) expect(fetch).not.toHaveBeenCalled();
  }
);

it('keeps finite Provider diagnostic record/evaluate reentry in one disposable owner', async () => {
  const c = collector();
  vi.useFakeTimers();
  vi.stubGlobal('__TOGGLY_STATIC_GATING__', true);
  vi.stubGlobal('__TOGGLY_BUILD_FLAGS__', { on: true });
  const add = vi.spyOn(document, 'addEventListener');
  const remove = vi.spyOn(document, 'removeEventListener');
  let context!: TogglyContextValue;
  let entered = false;
  const Reader = () => {
    context = useToggly();
    return null;
  };
  try {
    const host = render(
      <TogglyProvider
        config={{
          appKey: 'app',
          instanceId: 'token-a',
          telemetryFlushIntervalMs: 1,
          telemetryFetch: c.telemetryFetch,
          onTelemetryDiagnostic: () => {
            if (entered) return;
            entered = true;
            context.recordUsage('diagnostic');
            expect(context.evaluateFlag('on')).toBe(true);
          },
        }}
      >
        <Reader />
      </TogglyProvider>
    );
    expect(entered).toBe(true);
    context.recordUsage('outer');
    await context.flushTelemetry();
    expect(c.bodies).toEqual([
      {
        k: 'app',
        e: 'Production',
        i: 'token-a',
        f: { diagnostic: { enabled: [0, 1] }, on: { enabled: [1] }, outer: { enabled: [0, 1] } },
      },
    ]);
    host.unmount();
    await Promise.resolve();
    await Promise.resolve();
    expect(vi.getTimerCount()).toBe(0);
    expect(add.mock.calls.filter(([event]) => event === 'visibilitychange')).toHaveLength(1);
    expect(remove.mock.calls.filter(([event]) => event === 'visibilitychange')).toHaveLength(1);
  } finally {
    cleanup();
    await Promise.resolve();
    vi.clearAllTimers();
    vi.useRealTimers();
    add.mockRestore();
    remove.mockRestore();
  }
});

it.each([false, true])(
  'matches configured and explicit fallbacks in runtime/static=%s public consumers',
  async (staticGating) => {
    const c = collector();
    vi.stubGlobal('__TOGGLY_STATIC_GATING__', staticGating);
    vi.stubGlobal('__TOGGLY_BUILD_FLAGS__', { present: false });
    const { Feature } = await import('./index');
    let context!: TogglyContextValue;
    const cases = [
      { key: 'configured', fallback: undefined, expected: true },
      { key: 'explicitOff', fallback: false, expected: false },
      { key: 'explicitOn', fallback: true, expected: true },
      { key: 'present', fallback: true, expected: false },
      { key: 'missing', fallback: undefined, expected: false },
    ];
    function Reader({ item }: { item: (typeof cases)[number] }) {
      context = useToggly();
      const result = useFlag(item.key, item.fallback);
      return (
        <span data-testid={item.key}>{result.isReady ? String(result.enabled) : 'pending'}</span>
      );
    }
    const fetch = vi.fn(async () => new Response('{"present":false}'));
    const host = render(
      <TogglyProvider
        config={{
          appKey: 'app',
          instanceId: 'fallback-token',
          fetch,
          telemetryFetch: c.telemetryFetch,
          flagDefaults: { configured: true, explicitOff: true, explicitOn: false, present: true },
        }}
      >
        {cases.map((item) => (
          <React.Fragment key={item.key}>
            <Reader item={item} />
            <Feature flag={item.key} defaultValue={item.fallback} negate={!item.expected}>
              <span data-testid={'feature-' + item.key}>visible</span>
            </Feature>
          </React.Fragment>
        ))}
      </TogglyProvider>
    );
    await waitFor(() => expect(context.isReady).toBe(true));
    const direct = cases.map((item) => context.evaluateFlag(item.key, item.fallback));
    await context.flushTelemetry();
    expect(direct).toEqual(cases.map((item) => item.expected));
    for (const item of cases) {
      expect(host.getByTestId(item.key).textContent).toBe(String(item.expected));
      expect(host.queryByTestId('feature-' + item.key)).not.toBeNull();
    }
    expect(c.bodies).toEqual([
      {
        k: 'app',
        e: 'Production',
        i: 'fallback-token',
        f: {
          configured: { enabled: [3] },
          explicitOff: { disabled: [3] },
          explicitOn: { enabled: [3] },
          present: { disabled: [3] },
          missing: { disabled: [3] },
        },
      },
    ]);
    expect(fetch).toHaveBeenCalledTimes(staticGating ? 0 : 1);
  }
);
