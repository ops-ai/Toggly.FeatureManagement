import { createHash } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { createTogglyClient } from '@ops-ai/toggly-node-core';
import { createTogglyHandle, loadToggly } from '../src/server.js';
import { createToggly } from '../src/index.js';

// Independent WebCrypto signing: no SDK signing helper or verifier participates
// in constructing these fresh, valid signatures over malformed payloads.
const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
  'sign',
  'verify',
]);
const publicKey = await crypto.subtle.exportKey('jwk', pair.publicKey);
const jwk = {
  ...publicKey,
  kid:
    createHash('sha1')
      .update(Buffer.from(publicKey.x!, 'base64url'))
      .update(Buffer.from(publicKey.y!, 'base64url'))
      .digest('hex')
      .toUpperCase() + 'ES256',
  alg: 'ES256',
};
async function signed(defs: unknown) {
  const timestamp = Math.floor(Date.now() / 1000);
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(defs) + '|' + timestamp),
  );
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    pair.privateKey,
    digest,
  );
  return JSON.stringify({
    defs,
    timestamp,
    kid: jwk.kid,
    signature: Buffer.from(signature).toString('base64'),
  });
}
const rule = { property: 'Vip', op: 'eq', value: 'true', type: 'boolean' };
const valid = { requirement: 'all', rules: [rule] };
const malformed = [
  ['null map', null],
  ['array map', []],
  ['primitive map', true],
  ['nonboolean flag', { Order: 'enabled' }],
  ['null gate', { Order: null }],
  ['array gate', { Order: [] }],
  ['missing requirement', { Order: { rules: [rule] } }],
  ['wrong requirement', { Order: { requirement: 'ALL', rules: [rule] } }],
  ['missing rules', { Order: { requirement: 'all' } }],
  ['non-array rules', { Order: { requirement: 'all', rules: {} } }],
  ['null rule', { Order: { requirement: 'all', rules: [null] } }],
  ['array rule', { Order: { requirement: 'all', rules: [[]] } }],
  ['missing operator', { Order: { requirement: 'all', rules: [{ property: 'Vip' }] } }],
  ['numeric property', { Order: { requirement: 'all', rules: [{ ...rule, property: 1 }] } }],
  ['numeric operator', { Order: { requirement: 'all', rules: [{ ...rule, op: 1 }] } }],
  ['unknown operator', { Order: { requirement: 'all', rules: [{ ...rule, op: 'matches' }] } }],
  ['numeric value', { Order: { requirement: 'all', rules: [{ ...rule, value: 1 }] } }],
  ['invalid type', { Order: { requirement: 'all', rules: [{ ...rule, type: 'object' }] } }],
  ['null type', { Order: { requirement: 'all', rules: [{ ...rule, type: null }] } }],
  // Invalid hidden flags still invalidate the full response, before the allowlist.
  ['hidden malformed flag', { Order: valid, hidden: { rules: 'broken' } }],
] as const;
const order = { kind: 'Order', key: 'one', attributes: { Vip: true } };
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it.each(malformed)(
  'rejects a signed server payload with %s before serialization',
  async (_name, defs) => {
    const body = await signed(defs);
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (input: any) =>
          new Response(
            String(input).endsWith('/.well-known/jwks') ? JSON.stringify({ keys: [jwk] }) : body,
          ),
      ),
    );
    const client = createTogglyClient();
    await client.init();
    const onError = vi.fn();
    const event = {
      locals: {},
      request: new Request('http://localhost'),
      url: new URL('http://localhost'),
    } as any;
    try {
      await createTogglyHandle({
        client,
        frontend: {
          appKey: 'frontend',
          expose: ['on', 'Order'],
          featureDefaults: { on: true, private: true },
          onError,
        },
      })({ event, resolve: async () => new Response() } as any);
      expect((await loadToggly(event)).definitions).toEqual({ on: true });
      expect(onError).toHaveBeenCalledOnce();
    } finally {
      await client.close();
    }
  },
);
it.each(malformed)(
  'retains browser LKG and revision for a signed payload with %s',
  async (_name, defs) => {
    // Sign before fake timers so signature timestamps remain current.
    const goodBody = await signed({ on: true, Order: valid });
    const badBody = await signed(defs);
    vi.useFakeTimers();
    vi.stubGlobal('window', {});
    class Socket {
      static all: Socket[] = [];
      onmessage: any;
      onclose: any;
      onopen: any;
      onerror: any;
      close = vi.fn();
      constructor(public url: string) {
        Socket.all.push(this);
      }
    }
    vi.stubGlobal('WebSocket', Socket);
    let body = goodBody;
    let revision = 'good';
    const fetcher = vi.fn(
      async (input: any) =>
        new Response(
          String(input).endsWith('/.well-known/jwks') ? JSON.stringify({ keys: [jwk] }) : body,
          { headers: { ETag: revision } },
        ),
    );
    vi.stubGlobal('fetch', fetcher);
    const onError = vi.fn();
    const t = createToggly(
      { definitions: { on: false }, context: {}, expose: ['on', 'Order'] },
      { appKey: 'frontend', refreshInterval: 0, onError },
    );
    try {
      await t.start();
      await vi.waitFor(() => expect(t.isEnabled('Order', { entity: order })).toBe(true));
      body = badBody;
      revision = 'malformed';
      Socket.all[0].onmessage({ data: 'update' });
      await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
      expect(t.isEnabled('on')).toBe(true);
      expect(t.isEnabled('Order', { entity: order })).toBe(true);
      expect(t.isEnabled('Order')).toBe(false);
      Socket.all[0].onclose();
      await vi.advanceTimersByTimeAsync(5000);
      expect(Socket.all).toHaveLength(2);
      expect(new URL(Socket.all[1].url).searchParams.get('rev')).toBe('good');
    } finally {
      t.dispose();
    }
    const requests = fetcher.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetcher).toHaveBeenCalledTimes(requests);
    expect(vi.getTimerCount()).toBe(0);
  },
);
it('accepts the full supported signed entity contract through server and browser boundaries', async () => {
  const cases = [
    { property: 'Name', op: 'EQ', value: 'ALICE' },
    { property: 'Name', op: 'neq', value: 'bob', type: 'string' },
    { property: 'Amount', op: 'gt', value: '1', type: 'number' },
    { property: 'Amount', op: 'gte', value: '2', type: 'number' },
    { property: 'Amount', op: 'lt', value: '3', type: 'number' },
    { property: 'Amount', op: 'lte', value: '2', type: 'number' },
    { property: 'Name', op: 'in', value: 'alice, bob' },
    { property: 'Name', op: 'contains', value: 'lic', type: 'string' },
    { property: 'Roles', op: 'contains', value: 'admin', type: 'string[]' },
    { property: 'When', op: 'gt', value: '2020-01-01T00:00:00Z', type: 'datetime' },
    rule,
    { property: '', op: 'eq', value: '' },
  ];
  const defs = {
    ...Object.fromEntries(
      cases.map((entry, i) => [`gate${i}`, { requirement: i % 2 ? 'any' : 'all', rules: [entry] }]),
    ),
    empty: { requirement: 'all', rules: [] },
    on: true,
    off: false,
  };
  const body = await signed(defs);
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (input: any) =>
        new Response(
          String(input).endsWith('/.well-known/jwks') ? JSON.stringify({ keys: [jwk] }) : body,
        ),
    ),
  );
  const client = createTogglyClient();
  await client.init();
  const event = {
    locals: {},
    request: new Request('http://localhost'),
    url: new URL('http://localhost'),
  } as any;
  let snapshot;
  try {
    await createTogglyHandle({
      client,
      frontend: { appKey: 'frontend', expose: Object.keys(defs) },
    })({ event, resolve: async () => new Response() } as any);
    snapshot = await loadToggly(event);
    expect(snapshot.definitions).toEqual(defs);
  } finally {
    await client.close();
  }
  const entity = {
    ...order,
    attributes: {
      ...order.attributes,
      Name: 'alice',
      Amount: 2,
      Roles: ['admin'],
      When: '2025-01-01T00:00:00Z',
      '': '',
    },
  };
  vi.stubGlobal('window', {});
  const t = createToggly(
    { ...snapshot, definitions: {} },
    { appKey: 'frontend', enableLiveUpdates: false, refreshInterval: 0 },
  );
  try {
    await t.start();
    await vi.waitFor(() => expect(t.isEnabled('on')).toBe(true));
    for (const key of Object.keys(defs).filter((key) => key.startsWith('gate'))) {
      expect(t.isEnabled(key, { entity })).toBe(true);
      expect(t.isEnabled(key)).toBe(false);
    }
    expect(t.isEnabled('empty', { entity })).toBe(false);
    expect(t.isEnabled('off')).toBe(false);
  } finally {
    t.dispose();
  }
});
