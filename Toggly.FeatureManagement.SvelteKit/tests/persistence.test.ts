import { afterEach, expect, it, vi } from 'vitest';
import { createToggly } from '../src/index.js';
import { envelope, jwk } from './signing.js';
import { createPersistence } from '../src/persistence.js';
import { computeKid } from '@ops-ai/toggly-signed-defs';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('keeps the observed SSR key authoritative over an older context cache after navigation', async () => {
  vi.stubGlobal('window', {});
  const records = new Map<string, string>();
  const storage = {
    getItem: (key: string) => records.get(key) ?? null,
    setItem: (key: string, value: string) => {
      records.set(key, value);
    },
  };
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  const key = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const newerKey = { ...key, alg: 'ES256', kid: await computeKid(key.x!, key.y!) };
  createPersistence(storage, 'https://definitions.toggly.io').write(
    'https://definitions.toggly.io/evaluated-signed/front/Production?u=alice',
    envelope({ on: true }),
    { keys: [jwk] },
  );
  const onError = vi.fn();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('offline');
    }),
  );
  const initial = {
    definitions: { on: true },
    context: { identity: 'bob' },
    expose: ['on'],
    source: 'signed' as const,
    signedTimestamp: Math.floor(Date.now() / 1000),
    signingKey: newerKey,
  };
  const client = createToggly(initial, {
    appKey: 'front',
    storage,
    refreshInterval: 0,
    enableLiveUpdates: false,
    onError,
  });
  try {
    await client.start();
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    client.update({
      definitions: { on: false },
      context: { identity: 'alice' },
      expose: ['on'],
      source: 'defaults',
    });
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(2));
    expect(client.isEnabled('on')).toBe(false);
  } finally {
    client.dispose();
  }
});

it('retired pending JWKS fetches cannot refill the active key generation', async () => {
  vi.stubGlobal('window', {});
  class Socket {
    static current: Socket;
    onmessage: any;
    onclose: any;
    onopen: any;
    onerror: any;
    close() {}
    constructor() {
      Socket.current = this;
    }
  }
  vi.stubGlobal('WebSocket', Socket);
  let keyRequests = 0;
  let release: ((response: Response) => void) | undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: any) => {
      if (!String(input).includes('.well-known')) return new Response(envelope({ on: true }));
      if (++keyRequests === 1)
        return new Promise<Response>((resolve) => {
          release = resolve;
        });
      return new Response(JSON.stringify({ keys: [jwk] }));
    }),
  );
  const client = createToggly(
    { definitions: {}, context: {}, expose: ['on'], source: 'defaults' },
    { appKey: 'front', refreshInterval: 0 },
  );
  try {
    await client.start();
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    Socket.current.onmessage({ data: '{"type":"signing-key-updated"}' });
    release!(new Response(JSON.stringify({ keys: [jwk] })));
    await vi.waitFor(() => expect(client.isEnabled('on')).toBe(true));
    expect(keyRequests).toBe(2);
  } finally {
    client.dispose();
  }
});

it('applies current browser key pins before rendering signed SSR state or navigation updates', () => {
  const initial = {
    definitions: { on: true },
    context: {},
    expose: ['on'],
    source: 'signed' as const,
    signedTimestamp: Math.floor(Date.now() / 1000),
    signingKey: jwk,
  };
  const client = createToggly(initial, { allowedKeyIds: ['different-key'] });
  expect(client.isEnabled('on')).toBe(false);
  client.update(initial);
  expect(client.isEnabled('on')).toBe(false);
  client.dispose();
  const allowed = createToggly(initial, { allowedKeyIds: [jwk.kid] });
  expect(allowed.isEnabled('on')).toBe(true);
  allowed.dispose();
});

it.each(['offline', 'older-network'])(
  'preserves verified hydration above persisted/older data: %s',
  async (mode) => {
    vi.stubGlobal('window', {});
    const records = new Map<string, string>();
    const storage = {
      getItem: (key: string) => records.get(key) ?? null,
      setItem: (key: string, value: string) => {
        records.set(key, value);
      },
    };
    const now = Math.floor(Date.now() / 1000);
    const scope = 'https://definitions.toggly.io/evaluated-signed/front/Production?u=alice';
    createPersistence(storage, 'https://definitions.toggly.io').write(
      scope,
      envelope({ on: false }, now - 1),
      { keys: [jwk] },
    );
    const onError = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: any) => {
        if (mode === 'offline') throw new Error('offline');
        return new Response(
          String(input).includes('.well-known')
            ? JSON.stringify({ keys: [jwk] })
            : envelope({ on: false }, now - 1),
        );
      }),
    );
    const initial = {
      definitions: { on: true },
      context: { identity: 'alice' },
      expose: ['on'],
      source: 'signed' as const,
      signedTimestamp: now,
    };
    const client = createToggly(initial, {
      appKey: 'front',
      storage,
      refreshInterval: 0,
      enableLiveUpdates: false,
      onError,
    });
    try {
      await client.start();
      await vi.waitFor(() => expect(onError).toHaveBeenCalled());
      expect(client.isEnabled('on')).toBe(true);
    } finally {
      client.dispose();
    }
  },
);

it('does not reread persisted keys after accepting live verified state', async () => {
  vi.stubGlobal('window', {});
  const records = new Map<string, string>();
  const storage = {
    getItem: (key: string) => records.get(key) ?? null,
    setItem: (key: string, value: string) => {
      records.set(key, value);
    },
  };
  const now = Math.floor(Date.now() / 1000);
  let online = true;
  const onError = vi.fn();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: any) => {
      if (!online) throw new Error('offline');
      return new Response(
        String(input).includes('.well-known')
          ? JSON.stringify({ keys: [jwk] })
          : envelope({ on: true }, now),
      );
    }),
  );
  const initial = {
    definitions: { on: false },
    context: { identity: 'alice' },
    expose: ['on'],
    source: 'defaults' as const,
  };
  const client = createToggly(initial, {
    appKey: 'front',
    storage,
    refreshInterval: 30,
    enableLiveUpdates: false,
    onError,
  });
  try {
    await client.start();
    await vi.waitFor(() => expect(client.isEnabled('on')).toBe(true));
    createPersistence(storage, 'https://definitions.toggly.io').write(
      'https://definitions.toggly.io/evaluated-signed/front/Production?u=alice',
      envelope({ on: false }, now),
      { keys: [jwk] },
    );
    online = false;
    await vi.waitFor(() => expect(onError).toHaveBeenCalled());
    expect(client.isEnabled('on')).toBe(true);
  } finally {
    client.dispose();
  }
});

it('restores a fresh browser store when every service request is offline', async () => {
  vi.stubGlobal('window', {});
  const records = new Map<string, string>();
  const storage = {
    getItem: (key: string) => records.get(key) ?? null,
    setItem: (key: string, value: string) => {
      records.set(key, value);
    },
  };
  let online = true;
  const fetcher = vi.fn(async (input: any) => {
    if (!online) throw new Error('All network disabled');
    return new Response(
      String(input).includes('.well-known')
        ? JSON.stringify({ keys: [jwk] })
        : envelope({ on: true }),
    );
  });
  vi.stubGlobal('fetch', fetcher);
  const snapshot = {
    definitions: { on: false },
    context: { identity: 'alice' },
    expose: ['on'],
    source: 'defaults' as const,
  };
  const options = { appKey: 'front', storage, enableLiveUpdates: false, refreshInterval: 0 };
  const original = createToggly(snapshot, options);
  await original.start();
  await vi.waitFor(() => expect(original.isEnabled('on')).toBe(true));
  original.dispose();
  online = false;
  fetcher.mockClear();
  const restarted = createToggly(snapshot, options);
  try {
    await restarted.start();
    await vi.waitFor(() => expect(restarted.isEnabled('on')).toBe(true));
    expect(fetcher.mock.calls).toHaveLength(1);
    expect(String(fetcher.mock.calls[0][0])).toContain('/evaluated-signed/');
  } finally {
    restarted.dispose();
  }
});
