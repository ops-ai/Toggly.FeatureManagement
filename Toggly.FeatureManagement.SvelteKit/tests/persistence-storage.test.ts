import { describe, expect, it } from 'vitest';
import { createPersistence, verifyEnvelope } from '../src/persistence.js';
import { envelope as signEnvelope, jwk } from './signing.js';
const jwks = { keys: [jwk] };
const envelope = (defs: unknown, _encoding?: string, timestamp?: number) =>
  signEnvelope(defs, timestamp);
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
describe('persistent storage integrity', () => {
  it('checks current key pins and rejects changed envelope bytes on restart', async () => {
    const storage = memoryStorage();
    const cache = createPersistence(storage, 'https://fixture.test');
    cache.write('scope', envelope({ on: true }), jwks);
    await expect(cache.read('scope', { allowedKeyIds: ['different-key'] }, 0)).rejects.toThrow(
      'not allowed',
    );
    const entryKey = 'toggly:sveltekit:envelope:scope';
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
      storage.setItem('toggly:sveltekit:envelope:scope', value);
      expect(cache.read('scope', {}, 0)).toBeUndefined();
    }
    cache.write('scope', envelope({ on: true }), jwks);
    const raw = storage.getItem('toggly:sveltekit:envelope:scope')!;
    for (const mutation of [
      { version: 2 },
      { scope: 'other' },
      { generation: 'other' },
      { body: null },
      { jwks: null },
    ]) {
      storage.setItem(
        'toggly:sveltekit:envelope:scope',
        JSON.stringify({ ...JSON.parse(raw), ...mutation }),
      );
      expect(cache.read('scope', {}, 0)).toBeUndefined();
    }
    storage.entries.delete('toggly:sveltekit:trust:https://fixture.test');
    storage.setItem('toggly:sveltekit:envelope:scope', raw);
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
});
