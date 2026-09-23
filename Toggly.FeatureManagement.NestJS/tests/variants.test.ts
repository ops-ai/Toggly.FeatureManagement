import 'reflect-metadata';
import { afterEach, describe, it, expect } from 'vitest';
import { Test } from '@nestjs/testing';
import { ContextIdFactory } from '@nestjs/core';
import { createServer, type Server } from 'node:http';
import { TogglyModule, TogglyProvider, TogglyService } from '../src/index.js';

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
});
