import { afterEach, expect, it, vi } from 'vitest';
import { createTogglyClient } from '@ops-ai/toggly-node-core';
import { createToggly } from '../src/index.js';
import { createTogglyHandle, loadToggly } from '../src/server.js';
import type { TogglySnapshot } from '../src/types.js';
import { envelope, jwk } from './signing.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

const baseSnapshot: TogglySnapshot = {
  definitions: { feature: true },
  variants: {
    feature: { enabled: true, variant: 'B', configurationValue: { color: 'blue' } },
    off: { enabled: false, variant: 'B' },
    unnamed: { enabled: true },
  },
  context: {},
  expose: ['feature', 'off', 'unnamed'],
};

it('returns null when variants are disabled on the config, even with a populated snapshot', () => {
  const t = createToggly(baseSnapshot);
  expect(t.getVariant('feature')).toBeNull();
  expect(t.getVariantValue('feature')).toBeNull();
  t.dispose();
});

it('returns the assigned variant name and configuration value when the flag is effectively on', () => {
  const t = createToggly(baseSnapshot, { enableVariants: true });
  expect(t.getVariant('feature')).toEqual({ name: 'B', configurationValue: { color: 'blue' } });
  expect(t.getVariantValue('feature')).toEqual({ color: 'blue' });
  t.dispose();
});

it('returns null for a disabled flag even when a variant name is present', () => {
  const t = createToggly(baseSnapshot, { enableVariants: true });
  expect(t.getVariant('off')).toBeNull();
  expect(t.getVariantValue('off')).toBeNull();
  t.dispose();
});

it('returns null when the entry has no variant name assigned', () => {
  const t = createToggly(baseSnapshot, { enableVariants: true });
  expect(t.getVariant('unnamed')).toBeNull();
  expect(t.getVariantValue('unnamed')).toBeNull();
  t.dispose();
});

it('returns null for a key missing from variants entirely', () => {
  const t = createToggly(baseSnapshot, { enableVariants: true });
  expect(t.getVariant('missing')).toBeNull();
  expect(t.getVariantValue('missing')).toBeNull();
  t.dispose();
});

it('respects local gates: a device-disabled flag cannot report a variant', () => {
  const t = createToggly(baseSnapshot, {
    enableVariants: true,
    localGates: [{ id: 'device', flagKeys: ['feature'], isEnabled: () => false }],
  });
  expect(t.getVariant('feature')).toBeNull();
  t.dispose();
});

it('fetches /evaluated-variants-signed instead of /evaluated-signed when enableVariants is set', async () => {
  vi.stubGlobal('window', {});
  vi.stubGlobal('WebSocket', undefined);
  const requests: URL[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: any) => {
      const url = new URL(String(input));
      requests.push(url);
      if (url.pathname.endsWith('/.well-known/jwks')) {
        return new Response(JSON.stringify({ keys: [jwk] }));
      }
      return new Response(
        envelope({ feature: { enabled: true, variant: 'B', configurationValue: 42 } }),
      );
    }),
  );
  const t = createToggly(
    { definitions: {}, context: { identity: 'alice' }, expose: ['feature'] },
    { appKey: 'frontend', enableVariants: true, refreshInterval: 0, enableLiveUpdates: false },
  );
  try {
    await t.start();
    await vi.waitFor(() => expect(t.getVariant('feature')).not.toBeNull());
    expect(t.getVariant('feature')).toEqual({ name: 'B', configurationValue: 42 });
    expect(t.isEnabled('feature')).toBe(true);
    const request = requests.find((url) => !url.pathname.endsWith('/.well-known/jwks'))!;
    expect(request.pathname).toContain('/evaluated-variants-signed/');
    expect(request.pathname).not.toContain('/evaluated-signed/');
    expect(request.searchParams.get('userId')).toBe('alice');
  } finally {
    t.dispose();
  }
});

it('populates the server snapshot with variants when frontend.enableVariants is set', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: any) =>
      String(input).endsWith('/.well-known/jwks')
        ? new Response(JSON.stringify({ keys: [jwk] }))
        : new Response(
            envelope({
              on: { enabled: true, variant: 'B', configurationValue: 'value-b' },
              off: { enabled: false },
            }),
          ),
    ),
  );
  const client = createTogglyClient();
  await client.init();
  const event = {
    locals: {},
    request: new Request('http://localhost/'),
    url: new URL('http://localhost/'),
  } as any;
  try {
    await createTogglyHandle({
      client,
      frontend: { appKey: 'frontend', expose: ['on', 'off'], enableVariants: true },
    })({ event, resolve: async () => new Response() } as any);
    const snapshot = await loadToggly(event);
    expect(snapshot.definitions).toEqual({ on: true, off: false });
    expect(snapshot.variants).toEqual({
      on: { enabled: true, variant: 'B', configurationValue: 'value-b' },
      off: { enabled: false },
    });
    const request = vi
      .mocked(fetch)
      .mock.calls.map((call) => new URL(String(call[0])))
      .find((url) => !url.pathname.endsWith('/.well-known/jwks'))!;
    expect(request.pathname).toContain('/evaluated-variants-signed/');
  } finally {
    await client.close();
  }
});

it('rejects a malformed variants payload on the server and keeps exposed defaults', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: any) =>
      String(input).endsWith('/.well-known/jwks')
        ? new Response(JSON.stringify({ keys: [jwk] }))
        : new Response(envelope({ on: { enabled: 'yes' } })),
    ),
  );
  const client = createTogglyClient();
  await client.init();
  const onError = vi.fn();
  const event = {
    locals: {},
    request: new Request('http://localhost/'),
    url: new URL('http://localhost/'),
  } as any;
  try {
    await createTogglyHandle({
      client,
      frontend: {
        appKey: 'frontend',
        expose: ['on'],
        featureDefaults: { on: false },
        enableVariants: true,
        onError,
      },
    })({ event, resolve: async () => new Response() } as any);
    const snapshot = await loadToggly(event);
    expect(snapshot.definitions).toEqual({ on: false });
    expect(snapshot.variants).toBeUndefined();
    expect(onError).toHaveBeenCalledOnce();
  } finally {
    await client.close();
  }
});

it('rejects a malformed variants payload in the browser and reports the error', async () => {
  vi.stubGlobal('window', {});
  vi.stubGlobal('WebSocket', undefined);
  const errors = vi.fn();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: any) =>
      String(input).endsWith('/.well-known/jwks')
        ? new Response(JSON.stringify({ keys: [jwk] }))
        : new Response(envelope({ feature: { enabled: 'yes' } })),
    ),
  );
  const t = createToggly(
    { definitions: { feature: false }, context: {}, expose: ['feature'] },
    { appKey: 'frontend', enableVariants: true, refreshInterval: 0, onError: errors },
  );
  try {
    await t.start();
    await vi.waitFor(() => expect(errors).toHaveBeenCalled());
    expect(t.getVariant('feature')).toBeNull();
    expect(t.isEnabled('feature')).toBe(false);
  } finally {
    t.dispose();
  }
});

it('does not request the variants endpoint when frontend.enableVariants is unset', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: any) =>
      String(input).endsWith('/.well-known/jwks')
        ? new Response(JSON.stringify({ keys: [jwk] }))
        : new Response(envelope({ on: true })),
    ),
  );
  const client = createTogglyClient();
  await client.init();
  const event = {
    locals: {},
    request: new Request('http://localhost/'),
    url: new URL('http://localhost/'),
  } as any;
  try {
    await createTogglyHandle({
      client,
      frontend: { appKey: 'frontend', expose: ['on'] },
    })({ event, resolve: async () => new Response() } as any);
    const snapshot = await loadToggly(event);
    expect(snapshot.definitions).toEqual({ on: true });
    expect(snapshot.variants).toBeUndefined();
    const request = vi
      .mocked(fetch)
      .mock.calls.map((call) => new URL(String(call[0])))
      .find((url) => !url.pathname.endsWith('/.well-known/jwks'))!;
    expect(request.pathname).toContain('/evaluated-signed/');
    expect(request.pathname).not.toContain('/evaluated-variants-signed/');
  } finally {
    await client.close();
  }
});
