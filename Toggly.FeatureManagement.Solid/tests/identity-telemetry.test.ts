import { afterEach, expect, it, vi } from 'vitest';
import { createClient } from '../src/client';
import { envelope, jwks } from './fixtures/service.mjs';
import { webcrypto } from 'node:crypto';

const clients: ReturnType<typeof createClient>[] = [];
afterEach(() => {
  clients.splice(0).forEach((client) => client.dispose());
  vi.unstubAllGlobals();
});
function setup(overrides: any = {}, snapshot?: any) {
  const bodies: any[] = [],
    requests: any[] = [];
  vi.stubGlobal('CompressionStream', undefined);
  vi.stubGlobal('crypto', webcrypto);
  const client = createClient(
    {
      appKey: 'app',
      environment: 'Test',
      identity: 'alice',
      baseURI: 'https://definitions.test',
      verifySignatures: false,
      refreshInterval: 0,
      enableLiveUpdates: false,
      fetch: async (input, init) => {
        requests.push({ url: new URL(String(input)), init });
        return new Response('{"On":true}', { headers: { ETag: 'one' } });
      },
      telemetryFetch: async (_url, init) => {
        bodies.push(JSON.parse(init.body as string));
        return { status: 202 } as Response;
      },
      ...overrides,
    },
    snapshot,
  );
  clients.push(client);
  return { client, bodies, requests };
}
it('prefers minted targeting and keeps every accepted context batch through token ABA and clearing', async () => {
  const { client, bodies, requests } = setup({
    instanceId: 'token-a',
    groups: ['private'],
    claims: { role: 'private' },
  });
  await client.refresh();
  client.recordUsage('A');
  await client.setContext({ instanceId: 'token-b' } as any);
  client.recordView('B');
  await client.setContext({ instanceId: 'token-a' } as any);
  client.incrementCounter('A2');
  await client.setContext({ identity: 'bob' });
  client.recordUsage('Bob');
  await client.setContext({ identity: undefined });
  client.recordUsage('Anonymous');
  await client.flushTelemetry();
  expect([...requests[0].url.searchParams]).toEqual([['i', 'token-a']]);
  expect([...requests[1].url.searchParams]).toEqual([['i', 'token-b']]);
  expect(requests[3].url.searchParams.get('u')).toBe('bob');
  expect(requests[3].url.searchParams.has('i')).toBe(false);
  expect(bodies).toEqual([
    { k: 'app', e: 'Test', i: 'token-a', f: { A: { enabled: [0, 1] } } },
    { k: 'app', e: 'Test', i: 'token-b', f: { B: { enabled: [0, 0, 1] } } },
    { k: 'app', e: 'Test', i: 'token-a', m: { A2: 1 } },
    { k: 'app', e: 'Test', u: 'bob', f: { Bob: { enabled: [0, 1] } } },
    { k: 'app', e: 'Test', f: { Anonymous: { enabled: [0, 1] } } },
  ]);
});
it('captures nested selected leaves and reporter before local callbacks mutate state and context', async () => {
  const { client, bodies } = setup();
  client.hydrate({
    definitions: {
      First: true,
      Second: { requirement: 'all', rules: [{ property: 'role', op: 'eq', value: 'admin' }] },
    },
    expose: ['First', 'Second'],
    context: { identity: 'alice' },
    source: 'signed',
  });
  let changed = false;
  client.setLocalGates([
    {
      id: 'mutate',
      flagKeys: ['First'],
      isEnabled: () => {
        if (!changed) {
          changed = true;
          (client.state().definitions.Second as any).rules[0].value = 'retired';
          void client.setContext({ identity: 'bob' });
        }
        return true;
      },
    },
  ]);
  expect(
    client.evaluate(['First', 'Second'], 'all', false, {
      kind: 'Account',
      key: 'one',
      attributes: { role: 'admin' },
    }),
  ).toBe(true);
  await client.flushTelemetry();
  expect(bodies).toEqual([
    { k: 'app', e: 'Test', u: 'alice', f: { First: { enabled: [1] } } },
    { k: 'app', e: 'Test', u: 'alice', f: { Second: { enabled: [1] } } },
  ]);
});
it('captures selected local callbacks and membership before an earlier gate mutates them', async () => {
  const { client, bodies } = setup({ flagDefaults: { First: true, Second: true } });
  const later = { id: 'later', flagKeys: ['Second'], isEnabled: () => true };
  client.setLocalGates([
    {
      id: 'first',
      flagKeys: ['First'],
      isEnabled: () => {
        later.isEnabled = () => false;
        later.flagKeys.push('First');
        return true;
      },
    },
    later,
  ]);
  expect(client.evaluate(['First', 'Second'])).toBe(true);
  await client.flushTelemetry();
  expect(bodies).toEqual([
    { k: 'app', e: 'Test', u: 'alice', f: { First: { enabled: [1] }, Second: { enabled: [1] } } },
  ]);
});
it('does not seed a minted context with unrelated initial or route hydration', async () => {
  const legacy = {
    definitions: { Legacy: true },
    context: { identity: 'alice' },
    expose: ['Legacy'],
    source: 'signed',
  };
  const { client } = setup({ instanceId: 'token-a', flagDefaults: { Safe: false } }, legacy);
  expect(client.flags()).toEqual({});
  client.hydrate(legacy);
  expect(client.flags()).toEqual({});
});
it('a reentrant listener cannot give an old response revision to a newer context or skip its request', async () => {
  const requests: any[] = [];
  let release!: (r: Response) => void;
  const { client } = setup({
    fetch: async (input: any, init: any) => {
      const url = new URL(String(input));
      requests.push({ url, init });
      if (url.searchParams.get('u') === 'bob') return new Promise<Response>((r) => (release = r));
      return new Response('{"On":true}', { headers: { ETag: 'alice-rev' } });
    },
  });
  let changed = false;
  let next: Promise<void> | undefined;
  client.subscribe((state) => {
    if (state.definitions.On === true && !changed) {
      changed = true;
      next = client.setContext({ identity: 'bob' });
    }
  });
  await client.refresh();
  expect(requests).toHaveLength(2);
  expect(requests[1].init.headers['If-None-Match']).toBeUndefined();
  const firstRelease = release;
  const following = client.refresh();
  expect(requests.at(-1).init.headers['If-None-Match']).toBeUndefined();
  firstRelease(new Response('{"On":false}', { headers: { ETag: 'old-bob' } }));
  await next;
  release(new Response('{"On":false}', { headers: { ETag: 'bob-rev' } }));
  await following;
  expect(client.evaluate(['On'])).toBe(false);
});
it('never adopts an unsolicited validator for defaults after an orphan 304', async () => {
  const requests: any[] = [];
  const { client } = setup({
    flagDefaults: { On: true },
    fetch: async (_input: any, init: any) => {
      requests.push(init);
      return new Response(null, { status: 304, headers: { ETag: 'orphan' } });
    },
  });
  await client.refresh();
  await client.refresh();
  expect(client.state().error).toBeDefined();
  expect(requests[1].headers['If-None-Match']).toBeUndefined();
});
it('reverifies token-scoped signed persistence on ABA/offline owner replacement', async () => {
  const entries = new Map<string, string>();
  const storage = {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => entries.set(key, value),
  };
  let offline = false;
  const fetcher = async (input: any) => {
    if (offline) throw Error('offline');
    const url = new URL(String(input));
    return new Response(
      url.pathname.includes('.well-known')
        ? JSON.stringify(jwks)
        : envelope({ On: url.searchParams.get('i') === 'A' }),
      { headers: { ETag: 'one' } },
    );
  };
  const { client } = setup({ instanceId: 'A', storage, verifySignatures: true, fetch: fetcher });
  await client.refresh();
  expect(client.evaluate(['On'])).toBe(true);
  await client.setContext({ instanceId: 'B' } as any);
  expect(client.evaluate(['On'])).toBe(false);
  offline = true;
  await client.setContext({ instanceId: 'A' } as any);
  expect(client.evaluate(['On'])).toBe(true);
  const { client: replacement } = setup({
    instanceId: 'A',
    storage,
    verifySignatures: true,
    fetch: fetcher,
  });
  await replacement.refresh();
  expect(replacement.evaluate(['On'])).toBe(true);
  expect(
    [...entries.keys()]
      .filter((key) => key.includes('envelope:'))
      .every((key) => !key.includes('u=')),
  ).toBe(true);
});
it('removes inherited targeting query parameters for a token while preserving unrelated fields', async () => {
  const { client, requests } = setup({
    instanceId: ' A ',
    baseURI:
      'https://definitions.test/root?u=leak&g=private&claim.role=secret&i=retired&custom=keep&custom=again',
  });
  await client.refresh();
  expect(requests[0].url.pathname).toBe('/root/evaluated-signed/app/Test');
  expect([...requests[0].url.searchParams]).toEqual([
    ['custom', 'keep'],
    ['custom', 'again'],
    ['i', 'A'],
  ]);
});
it('fences retired socket callbacks after token replacement and clear restores route hydration', async () => {
  vi.useFakeTimers();
  class Socket {
    static all: Socket[] = [];
    onmessage: any;
    onclose: any;
    close = vi.fn();
    constructor() {
      Socket.all.push(this);
    }
  }
  vi.stubGlobal('WebSocket', Socket);
  try {
    const { client, requests } = setup({ instanceId: 'A', enableLiveUpdates: true });
    await client.refresh();
    client.start();
    const old = Socket.all[0];
    const oldMessage = old.onmessage,
      oldClose = old.onclose;
    await client.setContext({ instanceId: 'B' } as any);
    expect(Socket.all).toHaveLength(2);
    expect(old.close).toHaveBeenCalledOnce();
    oldMessage({ data: '{"type":"signing-key-updated"}' });
    oldClose();
    await vi.advanceTimersByTimeAsync(6000);
    expect(requests).toHaveLength(2);
    expect(Socket.all).toHaveLength(2);
    await client.setContext({ identity: 'bob' });
    client.hydrate({
      definitions: { Route: true },
      context: { identity: 'bob' },
      expose: ['Route'],
      source: 'signed',
    });
    expect(client.evaluate(['Route'])).toBe(true);
  } finally {
    clients.splice(0).forEach((client) => client.dispose());
    vi.useRealTimers();
  }
});
it('stops a superseded listener publication before later listeners see retired definitions', async () => {
  const { client } = setup({
    fetch: async (input: string) =>
      new Response(
        JSON.stringify({
          On: new URL(String(input)).searchParams.get('u') !== 'bob',
        }),
      ),
  });
  const seen: boolean[] = [];
  let next: Promise<void> | undefined;
  let changed = false;
  client.subscribe((state) => {
    if (state.definitions.On === true && !changed) {
      changed = true;
      next = client.setContext({ identity: 'bob' });
    }
  });
  client.subscribe((state) => {
    if (state.definitions.On !== undefined) seen.push(state.definitions.On as boolean);
  });
  await client.refresh();
  await next;
  // The current body publication and loading=false status both carry Bob=false.
  expect(seen).toEqual([false, false]);
});
it('accepts a matching signed frontend token snapshot and never revives it after clearing', async () => {
  const snapshot = {
    definitions: { On: true },
    context: { instanceId: 'A', identity: 'private' },
    expose: ['On'],
    source: 'signed',
  };
  const { client, bodies } = setup({ instanceId: 'A' }, snapshot);
  expect(client.evaluate(['On'])).toBe(true);
  await client.setContext({ identity: 'bob' });
  client.recordUsage('Bob');
  await client.flushTelemetry();
  expect(bodies.map((body) => [body.i, body.u])).toEqual([
    ['A', undefined],
    [undefined, 'bob'],
  ]);
});
it('retains the single reporter admission budget across sustained context changes', async () => {
  const { client, bodies } = setup();
  for (let index = 0; index < 2200; index++) {
    await client.setContext({ identity: `user-${index}` });
    client.recordUsage('One');
  }
  await client.flushTelemetry();
  expect(bodies).toHaveLength(2000);
  expect(bodies[0].u).toBe('user-0');
  expect(bodies.at(-1).u).toBe('user-1999');
  expect(bodies.reduce((sum, body) => sum + JSON.stringify(body).length, 0)).toBeLessThanOrEqual(
    256 * 1024,
  );
  // 2200 sequential setContext/refresh cycles are deterministic but CPU-bound;
  // under v8 coverage instrumentation and shared CI runners this can run well
  // past the default timeout without indicating a real regression, so the
  // budget is generous rather than tuned to local, uninstrumented timing.
}, 30000);
it('retains failed-send bytes and original owner when new-context events are admitted', async () => {
  vi.useFakeTimers();
  try {
    const bodies: any[] = [];
    let first = true;
    const { client } = setup({
      telemetryFetch: async (_url: any, init: any) => {
        bodies.push(JSON.parse(init.body));
        if (first) {
          first = false;
          return { status: 503 };
        }
        return { status: 202 };
      },
    });
    client.recordUsage('Alice');
    const sending = client.flushTelemetry();
    await vi.advanceTimersByTimeAsync(0);
    await client.setContext({ identity: 'bob' });
    client.recordUsage('Bob');
    await vi.advanceTimersByTimeAsync(30000);
    await sending;
    await client.flushTelemetry();
    expect(bodies.map((body) => body.u)).toEqual(['alice', 'alice', 'bob']);
    expect(bodies[0]).toEqual(bodies[1]);
  } finally {
    clients.splice(0).forEach((client) => client.dispose());
    vi.useRealTimers();
  }
});
