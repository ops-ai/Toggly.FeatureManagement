import 'reflect-metadata';
import { afterEach, describe, it, expect } from 'vitest';
import { Test } from '@nestjs/testing';
import { ContextIdFactory } from '@nestjs/core';
import { createServer, type Server } from 'node:http';
import { TogglyModule, TogglyProvider, TogglyService, decodeVariantValue } from '../src/index.js';

const closers: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

async function moduleFor(options: Record<string, unknown>) {
  const mod = await Test.createTestingModule({
    imports: [TogglyModule.forRoot(options as never)],
  }).compile();
  await mod.init();
  closers.push(() => mod.close());
  return mod;
}

async function serviceFor(mod: any, request: Record<string, unknown> = {}) {
  const id = ContextIdFactory.create();
  mod.registerRequestByContextId(request, id);
  return mod.resolve(TogglyService, id) as Promise<TogglyService>;
}

async function fixture(defs: unknown[]) {
  const state = { defs, status: 200 };
  const server: Server = createServer((_req, res) => {
    res.writeHead(state.status, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ defs: state.defs }));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  closers.push(() => new Promise<void>((r) => server.close(() => r())));
  return { state, baseUrl: `http://127.0.0.1:${(server.address() as any).port}` };
}

const checkoutFlowDef = {
  featureKey: 'checkout-flow',
  filters: [{ name: 'AlwaysOn' }],
  variants: [
    { name: 'A', configurationValue: { color: 'blue' } },
    { name: 'B', configurationValue: { color: 'green' } },
  ],
  allocation: {
    defaultWhenEnabled: 'B',
    user: [{ variant: 'A', users: ['alice'] }],
  },
};

describe('TogglyService.getVariant / getVariantValue (catalog-local, MF-parity)', () => {
  it('resolves the user-allocated variant bound to the request identity', async () => {
    const transport = await fixture([checkoutFlowDef]);
    const mod = await moduleFor({
      appKey: 'fixture',
      baseUrl: transport.baseUrl,
      refreshInterval: 0,
      enableStreaming: false,
      enableUsageTracking: false,
      enableMetrics: false,
      registerContextsOnStartup: false,
      contextFactory: async (req: any) => req.context,
    });

    const alice = await serviceFor(mod, { context: { identity: 'alice' } });
    const carol = await serviceFor(mod, { context: { identity: 'carol' } });

    expect(await alice.getVariant('checkout-flow')).toEqual({
      name: 'A',
      configurationValue: { color: 'blue' },
    });
    expect(await carol.getVariant('checkout-flow')).toEqual({
      name: 'B',
      configurationValue: { color: 'green' },
    });
    expect(await alice.getVariantValue('checkout-flow')).toEqual({ color: 'blue' });
  });

  it('returns null for an unknown feature key', async () => {
    const transport = await fixture([checkoutFlowDef]);
    const mod = await moduleFor({
      appKey: 'fixture',
      baseUrl: transport.baseUrl,
      refreshInterval: 0,
      enableStreaming: false,
      enableUsageTracking: false,
      enableMetrics: false,
      registerContextsOnStartup: false,
    });

    const svc = await serviceFor(mod);
    expect(await svc.getVariant('does-not-exist')).toBeNull();
    expect(await svc.getVariantValue('does-not-exist')).toBeNull();
  });

  it('supports per-call context overrides without mutating the resolved request context', async () => {
    const transport = await fixture([checkoutFlowDef]);
    const mod = await moduleFor({
      appKey: 'fixture',
      baseUrl: transport.baseUrl,
      refreshInterval: 0,
      enableStreaming: false,
      enableUsageTracking: false,
      enableMetrics: false,
      registerContextsOnStartup: false,
      contextFactory: async (req: any) => req.context,
    });

    const svc = await serviceFor(mod, { context: { identity: 'carol' } });

    expect(await svc.getVariant('checkout-flow')).toEqual({
      name: 'B',
      configurationValue: { color: 'green' },
    });
    expect(await svc.getVariant('checkout-flow', { context: { identity: 'alice' } })).toEqual({
      name: 'A',
      configurationValue: { color: 'blue' },
    });
    // Original request-bound context is untouched by the override above.
    expect(await svc.getVariant('checkout-flow')).toEqual({
      name: 'B',
      configurationValue: { color: 'green' },
    });
  });

  it('is available on the provider-owned client directly (no request scope required)', async () => {
    const transport = await fixture([checkoutFlowDef]);
    const mod = await moduleFor({
      appKey: 'fixture',
      baseUrl: transport.baseUrl,
      refreshInterval: 0,
      enableStreaming: false,
      enableUsageTracking: false,
      enableMetrics: false,
      registerContextsOnStartup: false,
    });

    const provider = mod.get(TogglyProvider);
    expect(await provider.client.getVariant('checkout-flow', { identity: 'alice' })).toEqual({
      name: 'A',
      configurationValue: { color: 'blue' },
    });
  });

  it('getVariantValue soft-decodes with an optional type guard', async () => {
    const transport = await fixture([
      checkoutFlowDef,
      {
        featureKey: 'pricing-tier',
        filters: [{ name: 'AlwaysOn' }],
        variants: [{ name: 'A', configurationValue: 7 }],
        allocation: { defaultWhenEnabled: 'A' },
      },
    ]);
    const mod = await moduleFor({
      appKey: 'fixture',
      baseUrl: transport.baseUrl,
      refreshInterval: 0,
      enableStreaming: false,
      enableUsageTracking: false,
      enableMetrics: false,
      registerContextsOnStartup: false,
      contextFactory: async (req: any) => req.context,
    });

    const alice = await serviceFor(mod, { context: { identity: 'alice' } });
    const isCheckout = (v: unknown): v is { color: string } =>
      typeof v === 'object' && v !== null && typeof (v as { color?: unknown }).color === 'string';

    expect(await alice.getVariantValue<{ color: string }>('checkout-flow', {}, isCheckout)).toEqual(
      { color: 'blue' },
    );
    expect(
      await alice.getVariantValue<{ color: string }>('pricing-tier', {}, isCheckout),
    ).toBeNull();
    expect(
      await alice.getVariantValue<{ color: string }>('does-not-exist', {}, isCheckout),
    ).toBeNull();
    expect(await alice.getVariantValue<number>('pricing-tier')).toBe(7);
  });
});

describe('decodeVariantValue (soft-null typed decode)', () => {
  it('returns null for missing / nullish values', () => {
    expect(decodeVariantValue(null)).toBeNull();
    expect(decodeVariantValue(undefined)).toBeNull();
  });

  it('returns an object as T without a guard', () => {
    expect(decodeVariantValue<{ x: number }>({ x: 1 })).toEqual({ x: 1 });
  });

  it('returns a scalar as T without a guard', () => {
    expect(decodeVariantValue<number>(42)).toBe(42);
    expect(decodeVariantValue<string>('blue')).toBe('blue');
  });

  it('soft-fails (null) when a type guard rejects', () => {
    const isCheckout = (v: unknown): v is { x: number } =>
      typeof v === 'object' && v !== null && typeof (v as { x?: unknown }).x === 'number';

    expect(decodeVariantValue({ x: 1 }, isCheckout)).toEqual({ x: 1 });
    expect(decodeVariantValue(7, isCheckout)).toBeNull();
    expect(decodeVariantValue(null, isCheckout)).toBeNull();
  });
});
