import 'reflect-metadata';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { ContextIdFactory } from '@nestjs/core';
import { TogglyModule, TogglyProvider, TogglyService } from '../src/index.js';

/**
 * Contract tests: real local HTTP matching definitions-signed response shapes,
 * then catalog-local evaluation through Nest public entry points
 * (TogglyModule / TogglyService). Does not change public API — only asserts
 * existing fetch + evaluate behavior.
 */

const DEFINITIONS = [
  { featureKey: 'always-on', filters: [{ name: 'AlwaysOn', parameters: {} }] },
  { featureKey: 'always-off', filters: [{ name: 'AlwaysOff', parameters: {} }] },
  {
    featureKey: 'beta',
    filters: [
      {
        name: 'Targeting',
        parameters: {
          'Audience.Users:0': 'alice',
          'Audience.DefaultRolloutPercentage': 0,
        },
      },
    ],
  },
  {
    featureKey: 'pct-full',
    filters: [{ name: 'Percentage', parameters: { Value: 100 } }],
  },
];

const closers: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

async function listenDefinitions(bodyFactory: () => string) {
  let lastUrl: string | undefined;
  const server = createServer((request, response) => {
    lastUrl = request.url;
    response.writeHead(200, {
      'content-type': 'application/json',
      etag: '"contract-rev-1"',
    });
    response.end(bodyFactory());
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  closers.push(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    lastUrl: () => lastUrl,
  };
}

async function moduleFor(baseUrl: string, environment = 'Production') {
  const mod = await Test.createTestingModule({
    imports: [
      TogglyModule.forRoot({
        appKey: 'contract-app',
        baseUrl,
        environment,
        refreshInterval: 0,
        enableStreaming: false,
        enableUsageTracking: false,
        enableMetrics: false,
        registerContextsOnStartup: false,
        contextFactory: async (req: { context?: { identity?: string } }) =>
          req.context ?? { identity: 'anonymous' },
      }),
    ],
  }).compile();
  await mod.init();
  closers.push(() => mod.close());
  return mod;
}

async function serviceFor(mod: Awaited<ReturnType<typeof moduleFor>>, identity: string) {
  const id = ContextIdFactory.create();
  mod.registerRequestByContextId({ context: { identity } }, id);
  return mod.resolve(TogglyService, id) as Promise<TogglyService>;
}

describe('definitions-signed API contract evaluation (Nest public API)', () => {
  it('evaluates flags from a bare definitions array response', async () => {
    const definitions = await listenDefinitions(() => JSON.stringify(DEFINITIONS));
    const mod = await moduleFor(definitions.baseUrl);
    const bob = await serviceFor(mod, 'bob');
    const alice = await serviceFor(mod, 'alice');

    expect(definitions.lastUrl()).toBe('/definitions-signed/contract-app/Production');
    await expect(bob.isFeatureOn('always-on')).resolves.toBe(true);
    await expect(bob.isFeatureOn('always-off')).resolves.toBe(false);
    await expect(bob.isFeatureOn('beta')).resolves.toBe(false);
    await expect(alice.isFeatureOn('beta')).resolves.toBe(true);
    await expect(bob.isFeatureOn('pct-full')).resolves.toBe(true);
    await expect(bob.isFeatureOn('missing')).resolves.toBe(false);
    await expect(bob.evaluateFeatureGate(['always-on', 'pct-full'])).resolves.toBe(true);
    await expect(bob.evaluateFeatureGate(['always-on', 'always-off'])).resolves.toBe(false);
    await expect(bob.evaluateFeatureGate(['always-on', 'always-off'], 'any')).resolves.toBe(true);
  });

  it('evaluates flags from an unsigned { defs } envelope response', async () => {
    const definitions = await listenDefinitions(() => JSON.stringify({ defs: DEFINITIONS }));
    const mod = await moduleFor(definitions.baseUrl, 'Staging');
    const bob = await serviceFor(mod, 'bob');
    const alice = await serviceFor(mod, 'alice');

    expect(definitions.lastUrl()).toBe('/definitions-signed/contract-app/Staging');
    expect(mod.get(TogglyProvider).client.state.definitions.size).toBe(4);
    await expect(bob.isFeatureOn('always-on')).resolves.toBe(true);
    await expect(bob.isFeatureOn('always-off')).resolves.toBe(false);
    await expect(bob.isFeatureOn('beta')).resolves.toBe(false);
    await expect(alice.isFeatureOn('beta')).resolves.toBe(true);
    await expect(bob.isFeatureOn('pct-full')).resolves.toBe(true);
  });

  it('refreshes and re-evaluates when the definitions-signed body changes', async () => {
    let body = JSON.stringify({
      defs: [{ featureKey: 'flip', filters: [{ name: 'AlwaysOn', parameters: {} }] }],
    });
    const definitions = await listenDefinitions(() => body);
    const mod = await moduleFor(definitions.baseUrl);
    const svc = await serviceFor(mod, 'bob');
    await expect(svc.isFeatureOn('flip')).resolves.toBe(true);

    body = JSON.stringify({
      defs: [{ featureKey: 'flip', filters: [{ name: 'AlwaysOff', parameters: {} }] }],
    });
    await mod.get(TogglyProvider).client.refresh();
    await expect(svc.isFeatureOn('flip')).resolves.toBe(false);
  });
});
