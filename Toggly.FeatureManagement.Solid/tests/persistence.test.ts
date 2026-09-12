import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { createClient } from '../src/client';
import { createPersistence, verifyEnvelope } from '../src/persistence';
import { envelope, jwks } from './fixtures/service.mjs';

beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => vi.unstubAllGlobals());

function memoryStorage() {
  const entries = new Map<string, string>();
  return {
    entries,
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, value);
    },
  };
}

describe('verified persistent storage', () => {
  it('retires in-flight responses before the key-rotation debounce window', async () => {
    class Socket {
      static current: Socket;
      onmessage: any;
      onclose: any;
      close() {}
      constructor() {
        Socket.current = this;
      }
    }
    vi.stubGlobal('WebSocket', Socket);
    const storage = memoryStorage();
    let definitionsRequests = 0;
    let release: ((response: Response) => void) | undefined;
    const fetcher: typeof fetch = async (input) => {
      if (String(input).includes('.well-known')) return new Response(JSON.stringify(jwks));
      if (++definitionsRequests === 2)
        return new Promise<Response>((resolve) => {
          release = resolve;
        });
      return new Response(envelope({ on: true }));
    };
    const client = createClient({ appKey: 'front', storage, fetch: fetcher, refreshInterval: 0 });
    try {
      await client.refresh();
      client.start();
      const pending = client.refresh();
      await vi.waitFor(() => expect(release).toBeTypeOf('function'));
      Socket.current.onmessage({ data: '{"type":"signing-key-updated"}' });
      release!(new Response(envelope({ on: false })));
      await pending;
      expect(client.flags()).toEqual({ on: true });
      const cache = createPersistence(storage, 'https://definitions.toggly.io');
      expect(
        cache.read('https://definitions.toggly.io/evaluated-signed/front/Production', {}, 0),
      ).toBeUndefined();
    } finally {
      client.dispose();
    }
  });

  it('restores into a fresh client with every network request disabled', async () => {
    const storage = memoryStorage();
    const requests: string[] = [];
    let online = true;
    const fetcher: typeof fetch = async (input) => {
      requests.push(String(input));
      if (!online) throw new Error('All network disabled');
      return new Response(
        String(input).includes('.well-known') ? JSON.stringify(jwks) : envelope({ on: true }),
      );
    };
    const options = { appKey: 'frontend', identity: 'alice', storage, fetch: fetcher };
    const original = createClient(options);
    await original.refresh();
    expect(original.evaluate(['on'])).toBe(true);
    original.dispose();

    online = false;
    requests.length = 0;
    const restarted = createClient(options);
    await restarted.refresh();
    expect(restarted.evaluate(['on'])).toBe(true);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toContain('/evaluated-signed/');
    restarted.dispose();

    for (const changed of [
      { identity: 'bob' },
      { environment: 'Other' },
      { appKey: 'other' },
      { groups: ['staff'] },
      { claims: { role: 'admin' } },
      { baseURI: 'https://other.test' },
    ]) {
      const isolated = createClient({ ...options, ...changed });
      await isolated.refresh();
      expect(isolated.flags()).toEqual({});
      isolated.dispose();
    }
  });

  it('checks current key pins and rejects changed envelope bytes on restart', async () => {
    const storage = memoryStorage();
    const cache = createPersistence(storage, 'https://fixture.test');
    cache.write('scope', envelope({ on: true }), jwks);
    await expect(cache.read('scope', { allowedKeyIds: ['different-key'] }, 0)).rejects.toThrow(
      'not allowed',
    );
    const entryKey = 'toggly:solid:envelope:scope';
    const record = JSON.parse(storage.getItem(entryKey)!);
    record.body = record.body.replace('true', 'false');
    storage.setItem(entryKey, JSON.stringify(record));
    await expect(cache.read('scope', {}, 0)).rejects.toThrow();
  });

  it('retirement invalidates every historical context and allows only newly verified records', async () => {
    const storage = memoryStorage();
    const cache = createPersistence(storage, 'https://fixture.test/');
    const body = envelope({ on: true });
    cache.write('alice', body, jwks);
    cache.write('bob', body, jwks);
    cache.invalidate();
    const restarted = createPersistence(storage, 'https://fixture.test');
    expect(restarted.read('alice', {}, 0)).toBeUndefined();
    expect(restarted.read('bob', {}, 0)).toBeUndefined();
    restarted.write('alice', body, jwks);
    expect((await restarted.read('alice', {}, 0))?.definitions).toEqual({ on: true });
  });

  it('disables persistence for the session when key retirement cannot be stored', () => {
    const storage = memoryStorage();
    let denied = false;
    const guarded = {
      getItem: storage.getItem,
      setItem: (key: string, value: string) => {
        if (denied) throw new Error('quota');
        storage.setItem(key, value);
      },
    };
    const cache = createPersistence(guarded, 'https://fixture.test');
    cache.write('alice', envelope({ on: true }), jwks);
    const prior = [...storage.entries];
    denied = true;
    cache.invalidate();
    cache.invalidate();
    cache.write('bob', envelope({ on: false }), jwks);
    expect(cache.read('alice', {}, 0)).toBeUndefined();
    expect([...storage.entries]).toEqual(prior);
  });

  it('ignores absent, corrupt, wrong-scope and unsupported records', () => {
    const storage = memoryStorage();
    const cache = createPersistence(storage, 'https://fixture.test');
    expect(cache.read('missing', {}, 0)).toBeUndefined();
    for (const value of [
      'invalid JSON',
      'null',
      '{}',
      JSON.stringify({ version: 2 }),
      JSON.stringify({ version: 1, scope: 'other' }),
    ]) {
      storage.setItem('toggly:solid:envelope:scope', value);
      expect(cache.read('scope', {}, 0)).toBeUndefined();
    }
    cache.write('scope', envelope({ on: true }), jwks);
    const raw = storage.getItem('toggly:solid:envelope:scope')!;
    for (const mutation of [
      { version: 2 },
      { scope: 'other' },
      { generation: 'other' },
      { body: null },
      { jwks: null },
    ]) {
      storage.setItem(
        'toggly:solid:envelope:scope',
        JSON.stringify({ ...JSON.parse(raw), ...mutation }),
      );
      expect(cache.read('scope', {}, 0)).toBeUndefined();
    }
    storage.entries.delete('toggly:solid:trust:https://fixture.test');
    storage.setItem('toggly:solid:envelope:scope', raw);
    expect(cache.read('scope', {}, 0)).toBeUndefined();
  });

  it('ignores unavailable storage without attempting to write or read disabled persistence', () => {
    const disabled = createPersistence(undefined, 'https://fixture.test');
    disabled.write('scope', '', jwks);
    disabled.invalidate();
    expect(disabled.read('scope', {}, 0)).toBeUndefined();
    const denied = createPersistence(
      {
        getItem: () => {
          throw new Error('denied');
        },
        setItem: () => {
          throw new Error('denied');
        },
      },
      'https://fixture.test',
    );
    expect(denied.read('scope', {}, 0)).toBeUndefined();
    expect(() => denied.write('scope', '', jwks)).not.toThrow();
  });
});

describe('restored key and envelope validation', () => {
  it.each([
    { kty: 'RSA' },
    { crv: 'P-384' },
    { alg: 'none' },
    { x: 1 },
    { y: null },
    { kid: 4 },
    { d: 'private' },
    { use: 'enc' },
    { key_ops: ['sign'] },
    { key_ops: 'verify' },
    { exp: 1 },
    { exp: 'tomorrow' },
    { x: 'changed' },
  ])('rejects invalid key metadata %j', async (mutation) => {
    await expect(
      verifyEnvelope(
        envelope({ on: true }),
        { keys: [{ ...jwks.keys[0], ...mutation }] } as any,
        {},
      ),
    ).rejects.toThrow();
  });

  it('accepts constrained public keys and honors expiry and maximum signature age', async () => {
    const now = Math.floor(Date.now() / 1000);
    const keys = { keys: [{ ...jwks.keys[0], use: 'sig', key_ops: ['verify'], exp: now + 1000 }] };
    expect((await verifyEnvelope(envelope({ on: true }), keys, {})).definitions).toEqual({
      on: true,
    });
    await expect(
      verifyEnvelope(envelope({ on: true }, 'der', now - 120), keys, {
        maxSignatureAgeSeconds: 60,
      }),
    ).rejects.toThrow('maxSignatureAgeSeconds');
    await expect(verifyEnvelope(envelope({ on: true }, 'der', now + 61), keys, {})).rejects.toThrow(
      'timestamp',
    );
    await expect(
      verifyEnvelope(envelope({ on: true }, 'der', now), keys, {}, now + 1),
    ).rejects.toThrow('timestamp');
    await expect(
      verifyEnvelope(envelope({ malformed: { rules: [{ property: 'x' }] } }), keys, {}),
    ).rejects.toThrow('Invalid evaluated');
    await expect(verifyEnvelope(envelope({ on: true }), { keys: [] }, {})).rejects.toThrow(
      'Missing',
    );
  });

  it('retains newer active state when an older signed remote envelope arrives', async () => {
    const now = Math.floor(Date.now() / 1000);
    let body = envelope({ on: true }, 'der', now);
    const fetcher: typeof fetch = async (input) =>
      new Response(String(input).includes('.well-known') ? JSON.stringify(jwks) : body);
    const client = createClient({ appKey: 'front', fetch: fetcher });
    await client.refresh();
    body = envelope({ on: false }, 'der', now - 1);
    await client.refresh();
    expect(client.flags()).toEqual({ on: true });
    expect(client.state().error?.message).toContain('rolled-back');
    client.dispose();
  });
});
