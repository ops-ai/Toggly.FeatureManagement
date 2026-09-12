import 'reflect-metadata';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { Controller, Get, Inject, Query, UseGuards, Scope } from '@nestjs/common';
import { ContextIdFactory } from '@nestjs/core';
import { createServer, type Server } from 'node:http';
import {
  TogglyModule,
  TogglyProvider,
  TogglyService,
  FeatureFlag,
  FeatureFlagGuard,
  FeatureEnabled,
} from '../src/index.js';
const closers: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});
const offline = {
  featureDefaults: { on: true, off: false },
  refreshInterval: 0,
  enableStreaming: false,
  enableUsageTracking: false,
  enableMetrics: false,
};
async function moduleFor(options = offline) {
  const mod = await Test.createTestingModule({
    imports: [TogglyModule.forRoot(options)],
  }).compile();
  await mod.init();
  closers.push(() => mod.close());
  return mod;
}
async function serviceFor(mod: any, request = {}) {
  const id = ContextIdFactory.create();
  mod.registerRequestByContextId(request, id);
  return mod.resolve(TogglyService, id) as Promise<TogglyService>;
}
async function fixture(defs: any[]) {
  const state = { defs, status: 200 };
  const server = createServer((_req, res) => {
    res.writeHead(state.status, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ defs: state.defs }));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  closers.push(() => new Promise<void>((r) => server.close(() => r())));
  return { state, baseUrl: `http://127.0.0.1:${(server.address() as any).port}` };
}
const rule = (featureKey: string, name: string, parameters = {}) => ({
  featureKey,
  filters: [{ name, parameters }],
});

describe('module and request service', () => {
  it('initializes defaults and evaluates single, all, any, negated and missing flags', async () => {
    const mod = await moduleFor();
    const svc = await serviceFor(mod);
    expect(mod.get(TogglyProvider).state.initialized).toBe(true);
    expect(await svc.isFeatureOn('on')).toBe(true);
    expect(await svc.isFeatureOff('on')).toBe(false);
    expect(await svc.isFeatureOn('missing')).toBe(false);
    expect(await svc.evaluateFeatureGate(['on', 'off'])).toBe(false);
    expect(await svc.evaluateFeatureGate(['on', 'off'], 'any')).toBe(true);
    expect(await svc.evaluateFeatureGate(['off'], 'all', true)).toBe(true);
    expect(await svc.evaluateFeatureGate([])).toBe(true);
    expect(await svc.context()).toEqual({ identity: 'anonymous' });
  });
  it('supports injected asynchronous configuration', async () => {
    const mod = await Test.createTestingModule({
      imports: [
        TogglyModule.forRootAsync({
          providers: [{ provide: 'CONFIG', useValue: offline }],
          inject: ['CONFIG'],
          useFactory: async (config) => config,
        }),
      ],
    }).compile();
    await mod.init();
    closers.push(() => mod.close());
    expect(await (await serviceFor(mod)).isFeatureOn('on')).toBe(true);
  });
  it('resolves context once, clones it, and keeps parallel request contexts isolated', async () => {
    const transport = await fixture([
      rule('target', 'Targeting', { 'Audience.Users:0': 'alice' }),
      rule('claims', 'UserClaims', { Claim: 'role', Value: 'admin', Percentage: 100 }),
      rule('country', 'Country', { 'Country:0': 'US', Percentage: 100 }),
      {
        ...rule('vip', 'ContextProperty', {
          Property: 'Vip',
          Operator: 'eq',
          Value: 'true',
          ValueType: 'boolean',
        }),
        contextKind: 'Order',
      },
    ]);
    let calls = 0;
    const mod = await moduleFor({
      ...offline,
      appKey: 'fixture',
      baseUrl: transport.baseUrl,
      registerContextsOnStartup: false,
      contextFactory: async (req: any) => {
        calls++;
        await Promise.resolve();
        return req.context;
      },
    } as any);
    mod.get(TogglyProvider).client.registerContext('Order', (order: any) => ({
      kind: 'Order',
      key: 'order',
      attributes: order,
    }));
    const a = await serviceFor(mod, {
      context: {
        identity: 'alice',
        groups: ['staff'],
        claims: { role: 'admin' },
        request: { country: 'US' },
      },
    });
    const b = await serviceFor(mod, {
      context: {
        identity: 'bob',
        groups: [],
        claims: { role: 'user' },
        request: { country: 'CA' },
      },
    });
    expect(
      await Promise.all([
        a.isFeatureOn('target'),
        b.isFeatureOn('target'),
        a.isFeatureOn('claims'),
        b.isFeatureOn('claims'),
        a.isFeatureOn('country'),
        b.isFeatureOn('country'),
      ]),
    ).toEqual([true, false, true, false, true, false]);
    expect(calls).toBe(2);
    const c = await a.context();
    c.identity = 'bob';
    c.groups!.push('mutated');
    c.claims!.role = 'user';
    expect(await a.isFeatureOn('target')).toBe(true);
    expect((await a.context()).groups).toEqual(['staff']);
    expect(await a.isFeatureOn('target', { context: { identity: 'bob' } })).toBe(false);
    expect(await a.isFeatureOn('vip', { entity: { Vip: true }, kind: 'Order' })).toBe(true);
    expect(await b.isFeatureOn('vip', { entity: { Vip: false }, kind: 'Order' })).toBe(false);
  });
  it('preserves defaults during refresh errors, exposes state and recovers', async () => {
    const transport = await fixture([rule('on', 'AlwaysOff')]);
    const errors: Error[] = [];
    const mod = await moduleFor({
      ...offline,
      appKey: 'fixture',
      baseUrl: transport.baseUrl,
      registerContextsOnStartup: false,
      onError: (e: Error) => {
        errors.push(e);
      },
    } as any);
    const svc = await serviceFor(mod);
    const provider = mod.get(TogglyProvider);
    expect(await svc.isFeatureOn('on')).toBe(false);
    transport.state.status = 500;
    await provider.client.refresh();
    expect(provider.state.error).toBeInstanceOf(Error);
    expect(await svc.isFeatureOn('on')).toBe(false);
    transport.state.status = 200;
    transport.state.defs = [rule('on', 'AlwaysOn')];
    await provider.client.refresh();
    expect(await svc.isFeatureOn('on')).toBe(true);
    expect(errors.length).toBeGreaterThan(0);
  });
  it('rejects unsigned definitions when signature verification is enabled', async () => {
    const transport = await fixture([rule('on', 'AlwaysOff')]);
    const mod = await moduleFor({
      ...offline,
      appKey: 'fixture',
      baseUrl: transport.baseUrl,
      verifySignatures: true,
      registerContextsOnStartup: false,
    } as any);
    expect(mod.get(TogglyProvider).state.error).toBeInstanceOf(Error);
    expect(await (await serviceFor(mod)).isFeatureOn('on')).toBe(true);
  });
});

@Controller()
@UseGuards(FeatureFlagGuard)
@FeatureFlag('off')
class Routes {
  constructor(@Inject(TogglyService) private readonly toggly: TogglyService) {}
  @Get('disabled') disabled() {
    return 'hidden';
  }
  @Get('enabled') @FeatureFlag('on') enabled(@FeatureEnabled('on') value: boolean) {
    return { value };
  }
  @Get('forbidden') @FeatureFlag('off', { disabledStatus: 403 }) forbidden() {
    return 'hidden';
  }
  @Get('negated') @FeatureFlag(['off'], { negate: true }) negated() {
    return 'visible';
  }
  @Get('identity') @FeatureFlag('on') async identity() {
    return this.toggly.context();
  }
}
describe('HTTP integration', () => {
  it('enforces method overrides, disabled policy, parameter injection and request-scoped context', async () => {
    const mod = await Test.createTestingModule({
      imports: [
        TogglyModule.forRoot({
          ...offline,
          contextFactory: (req: any) => ({ identity: req.query.user || 'anonymous' }),
        }),
      ],
      controllers: [Routes],
    }).compile();
    const app = mod.createNestApplication();
    await app.listen(0, '127.0.0.1');
    closers.push(() => app.close());
    const url = await app.getUrl();
    expect((await fetch(url + '/disabled')).status).toBe(404);
    expect((await fetch(url + '/forbidden')).status).toBe(403);
    expect(await (await fetch(url + '/enabled')).json()).toEqual({ value: true });
    expect(await (await fetch(url + '/negated')).text()).toBe('visible');
    expect(
      await Promise.all(
        ['alice', 'bob'].map(async (user) => (await fetch(url + '/identity?user=' + user)).json()),
      ),
    ).toEqual([{ identity: 'alice' }, { identity: 'bob' }]);
  });
});

describe('lifecycle and guard edge cases', () => {
  it('exposes global and empty module configuration and async default injection', async () => {
    expect(TogglyModule.forRoot().global).toBe(false);
    expect(TogglyModule.forRoot({ isGlobal: true }).global).toBe(true);
    const mod = await Test.createTestingModule({
      imports: [TogglyModule.forRootAsync({ useFactory: () => offline })],
    }).compile();
    closers.push(() => mod.close());
    expect(await (await serviceFor(mod)).isFeatureOn('on')).toBe(true);
  });
  it('propagates context factory errors once and maps guard evaluation errors to 503', async () => {
    let calls = 0;
    const mod = await moduleFor({
      ...offline,
      contextFactory: () => {
        calls++;
        throw Error('private details');
      },
    } as any);
    const svc = await serviceFor(mod);
    await expect(svc.context()).rejects.toThrow('private details');
    await expect(svc.context()).rejects.toThrow('private details');
    expect(calls).toBe(1);
    const reflector = { getAllAndOverride: () => ({ keys: ['on'] }) };
    const guard = new FeatureFlagGuard(reflector as any, svc);
    const context = { getType: () => 'http', getHandler: () => null, getClass: () => null } as any;
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      status: 503,
      message: 'Feature evaluation unavailable',
    });
    await expect(guard.canActivate({ ...context, getType: () => 'ws' })).rejects.toMatchObject({
      status: 503,
    });
    expect(
      await new FeatureFlagGuard({ getAllAndOverride: () => undefined } as any, svc).canActivate(
        context,
      ),
    ).toBe(true);
    expect(() => FeatureFlag([])).toThrow('non-empty');
    expect(() => FeatureFlag(' ')).toThrow('non-empty');
  });
  it('cleans up a client when its cache provider makes initialization fail', async () => {
    const provider = new TogglyProvider({
      ...offline,
      cacheProvider: {
        get: async () => {
          throw Error('cache failure');
        },
        set: async () => {},
        delete: async () => {},
        has: async () => false,
      },
    });
    const close = vi.spyOn(provider.client, 'close');
    await expect(provider.initialize()).rejects.toThrow('cache failure');
    expect(close).toHaveBeenCalledOnce();
  });
  it('delegates usage and view identity, metric APIs and closes on application shutdown', async () => {
    const mod = await moduleFor();
    const provider = mod.get(TogglyProvider);
    const svc = await serviceFor(mod);
    const usage = vi.spyOn(provider.client, 'recordUsage');
    const view = vi.spyOn(provider.client, 'recordView');
    const close = vi.spyOn(provider.client, 'close');
    await svc.recordUsage('on', 'variant');
    await svc.recordView('on');
    expect(usage).toHaveBeenCalledWith('on', 'anonymous', 'variant');
    expect(view).toHaveBeenCalledWith('on', 'anonymous', undefined);
    provider.client.measure('revenue', 5, { feature: 'on' });
    provider.client.incrementCounter('orders');
    provider.client.observe('queue', 1);
    await provider.client.flushTelemetry();
    await mod.close();
    expect(close).toHaveBeenCalledOnce();
    closers.pop();
  });
});

describe('core cache and live update integration', () => {
  it('uses a durable snapshot through startup failure and runs refresh hooks', async () => {
    const transport = await fixture([]);
    transport.state.status = 503;
    const cached = [rule('on', 'AlwaysOn')];
    let refreshes = 0;
    const mod = await moduleFor({
      ...offline,
      featureDefaults: { on: false },
      appKey: 'fixture',
      baseUrl: transport.baseUrl,
      registerContextsOnStartup: false,
      cacheProvider: {
        get: async (key: string) => (key.includes('definitions') ? JSON.stringify(cached) : null),
        set: async () => {},
        delete: async () => {},
        has: async () => true,
      },
      hooks: [
        {
          getMetadata: () => ({ name: 'test' }),
          afterRefresh: async () => {
            refreshes++;
          },
        },
      ],
    } as any);
    expect(await (await serviceFor(mod)).isFeatureOn('on')).toBe(true);
    transport.state.status = 200;
    transport.state.defs = [rule('on', 'AlwaysOff')];
    await mod.get(TogglyProvider).client.refresh();
    expect(refreshes).toBeGreaterThan(0);
    expect(await (await serviceFor(mod)).isFeatureOn('on')).toBe(false);
  });
  it('refreshes through the core WebSocket and releases the socket on shutdown', async () => {
    const { WebSocketServer } = await import('ws');
    const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await new Promise<void>((resolve) => wss.on('listening', resolve));
    closers.push(() => new Promise<void>((resolve) => wss.close(() => resolve())));
    const connected = new Promise<any>((resolve) => wss.once('connection', resolve));
    const transport = await fixture([rule('on', 'AlwaysOff')]);
    const mod = await moduleFor({
      ...offline,
      appKey: 'fixture',
      baseUrl: transport.baseUrl,
      registerContextsOnStartup: false,
      enableStreaming: true,
      streamingUrl: `ws://127.0.0.1:${(wss.address() as any).port}`,
    } as any);
    const socket = await connected;
    const svc = await serviceFor(mod);
    expect(await svc.isFeatureOn('on')).toBe(false);
    transport.state.defs = [rule('on', 'AlwaysOn')];
    socket.send('update');
    await vi.waitFor(async () => expect(await svc.isFeatureOn('on')).toBe(true), { timeout: 3000 });
  });
});
