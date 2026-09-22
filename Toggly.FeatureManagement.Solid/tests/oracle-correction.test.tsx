import { afterEach, expect, it, vi } from 'vitest';
import { createRoot } from 'solid-js';
import { createClient, createToggly, TogglyProvider, type Toggly } from '../src';
import { createTogglyRequest } from '../src/server';
import { envelope, jwks } from './fixtures/service.mjs';
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it.each([undefined, '', '   '])(
  'never revives a configured token for initial context %j or later clearing',
  async (instanceId) => {
    const urls: URL[] = [];
    const packets: any[] = [];
    vi.stubGlobal('CompressionStream', undefined);
    const client = createClient({
      appKey: 'app',
      identity: 'alice',
      instanceId,
      baseURI: 'https://defs.test/root?i=retired&i=older&u=legacy&keep=one&keep=two',
      verifySignatures: false,
      enableLiveUpdates: false,
      refreshInterval: 0,
      fetch: async (input) => {
        const url = new URL(String(input));
        urls.push(url);
        return new Response(
          JSON.stringify({ On: !url.searchParams.has('i') || url.searchParams.get('i') === 'A' }),
        );
      },
      telemetryFetch: async (_, init) => {
        packets.push(JSON.parse(init.body as string));
        return { status: 202 } as Response;
      },
    });
    try {
      await client.refresh();
      expect(urls[0].searchParams.has('i')).toBe(false);
      await client.setContext({ instanceId: 'A' });
      await client.setContext({ instanceId: '  ' });
      expect(urls.at(-1)!.searchParams.has('i')).toBe(false);
      await client.setContext({ instanceId: 'A' });
      await client.setContext({ identity: 'bob' });
      expect(urls.at(-1)!.searchParams.has('i')).toBe(false);
      expect(urls.at(-1)!.searchParams.get('u')).toBe('bob');
      expect(
        urls.every(
          (url) =>
            JSON.stringify(url.searchParams.getAll('keep')) === JSON.stringify(['one', 'two']),
        ),
      ).toBe(true);
      expect(client.evaluate(['On'])).toBe(true);
      await client.flushTelemetry();
      expect(packets).toEqual([
        { k: 'app', e: 'Production', u: 'bob', f: { On: { enabled: [1] } } },
      ]);
    } finally {
      client.dispose();
    }
  },
);
it.each([undefined, ' ', ' A '])(
  'projects only normalized server token %j and no inherited token',
  async (instanceId) => {
    const urls: URL[] = [];
    const request = createTogglyRequest({
      client: { config: { appKey: 'backend' } } as any,
      request: new Request('https://app.test'),
      clientContext: { instanceId, identity: 'bob' },
      frontend: {
        appKey: 'frontend',
        baseURI: 'https://defs.test/root?i=retired&i=older&keep=one&keep=two',
        expose: ['On'],
        fetch: async (input) => {
          const url = new URL(String(input));
          urls.push(url);
          return new Response(
            url.pathname.includes('.well-known') ? JSON.stringify(jwks) : envelope({ On: true }),
          );
        },
      },
    });
    try {
      const snapshot = await request.snapshot();
      expect(snapshot.source).toBe('signed');
      expect(snapshot.context.instanceId).toBe(instanceId?.trim() || undefined);
      expect(urls[0].searchParams.get('i')).toBe(instanceId?.trim() || null);
      expect(urls[0].searchParams.getAll('keep')).toEqual(['one', 'two']);
    } finally {
      request.dispose();
    }
  },
);
it('accepts consecutive normalized route snapshots and preserves matching attribution', async () => {
  const packets: any[] = [];
  vi.stubGlobal('CompressionStream', undefined);
  const client = createClient({
    appKey: 'app',
    instanceId: ' A ',
    telemetryFetch: async (_, init) => {
      packets.push(JSON.parse(init.body as string));
      return { status: 202 } as Response;
    },
  });
  try {
    for (const [instanceId, On] of [
      [' A ', true],
      ['A', false],
      [' A ', true],
    ] as const) {
      client.hydrate({
        context: { instanceId },
        definitions: { On },
        expose: ['On'],
        source: 'signed',
      });
      expect(client.context().instanceId).toBe('A');
      expect(client.evaluate(['On'])).toBe(On);
    }
    await client.flushTelemetry();
    expect(packets).toEqual([
      { k: 'app', e: 'Production', i: 'A', f: { On: { enabled: [2], disabled: [1] } } },
    ]);
  } finally {
    client.dispose();
  }
});
it.each(['diagnostic', 'fetch'] as const)(
  'retires a real Solid root during synchronous %s construction callbacks',
  async (phase) => {
    vi.useFakeTimers();
    vi.stubGlobal('CompressionStream', undefined);
    const packets: any[] = [];
    let value!: Toggly;
    let invoked = 0;
    let release: ((response: Response) => void) | undefined;
    const add = vi.spyOn(window, 'addEventListener'),
      remove = vi.spyOn(window, 'removeEventListener');
    createRoot((dispose) => {
      value = createToggly({
        appKey: 'app',
        flagDefaults: { On: false },
        verifySignatures: false,
        refreshInterval: 0,
        enableLiveUpdates: false,
        telemetryFlushIntervalMs: phase === 'diagnostic' ? -1 : 45000,
        onTelemetryDiagnostic: () => {
          invoked++;
          dispose();
        },
        fetch: () => {
          invoked++;
          dispose();
          return new Promise((resolve) => {
            release = resolve;
          });
        },
        telemetryFetch: async (_, init) => {
          packets.push(JSON.parse(init.body as string));
          return { status: 202 } as Response;
        },
      });
    });
    expect(invoked).toBe(1);
    value.recordUsage('late');
    await value.flushTelemetry();
    expect(packets).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    for (const [event, listener] of add.mock.calls)
      expect(remove.mock.calls.some((call) => call[0] === event && call[1] === listener)).toBe(
        true,
      );
    release?.(new Response('{"On":true}'));
    await Promise.resolve();
    await Promise.resolve();
    expect(value.client.flags()).toEqual({ On: false });
    value.client.dispose();
  },
);
it.each(['diagnostic', 'fetch'] as const)(
  'does not construct Provider children after owner retirement during %s',
  async (phase) => {
    vi.useFakeTimers();
    let children = 0;
    const packets: any[] = [];
    vi.stubGlobal('CompressionStream', undefined);
    createRoot((dispose) => {
      const config = {
        appKey: 'app',
        verifySignatures: false,
        enableLiveUpdates: false,
        refreshInterval: 0,
        telemetryFlushIntervalMs: phase === 'diagnostic' ? -1 : 45000,
        onTelemetryDiagnostic: () => dispose(),
        fetch: async () => {
          dispose();
          return new Response('{"On":true}');
        },
        telemetryFetch: async (_url: string, init: any) => {
          packets.push(JSON.parse(init.body));
          return { status: 202 };
        },
      };
      TogglyProvider({
        config,
        get children() {
          children++;
          return <span>retired</span>;
        },
      });
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(children).toBe(0);
    expect(packets).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  },
);
