import 'reflect-metadata';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ContextIdFactory } from '@nestjs/core';
import {
  FeatureFlag,
  FeatureFlagGuard,
  TogglyModule,
  TogglyProvider,
  TogglyService,
} from '../src/index.js';

/**
 * Contract tests: real local HTTP matching definitions-signed response shapes,
 * then catalog-local evaluation through Nest public entry points
 * (TogglyModule / TogglyService / FeatureFlagGuard / FeatureFlag). Does not
 * change public API — only asserts existing fetch + evaluate behavior.
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

type ParityFixture = {
  id: string;
  featureKey: string;
  filters: Array<{ name: string; parameters?: Record<string, unknown> }>;
  context?: { identity?: string; groups?: string[]; claims?: Record<string, unknown> };
  httpHeaders?: Record<string, string>;
  expected: boolean;
  sdkExpectations?: Record<string, { outcome?: boolean | 'error'; allowedOutcomes?: boolean[] }>;
};

const filterParityDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../docs/filter-parity/fixtures',
);

/** Context-only Wave-1 fixtures Nest can evaluate without HTTP header adapters. */
const NEST_FILTER_PARITY_IDS = new Set([
  'targeting-groups-match',
  'targeting-groups-miss',
  'targeting-users-match',
  'targeting-users-miss',
  'user-claims-match',
  'user-claims-miss',
  'percentage-missing-fail-closed',
  'percentage-zero-fail-closed',
  'unknown-filter-fail-closed',
]);

function loadNestFilterParityFixtures(): ParityFixture[] {
  return readdirSync(filterParityDir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => JSON.parse(readFileSync(join(filterParityDir, name), 'utf8')) as ParityFixture)
    .filter((fixture) => NEST_FILTER_PARITY_IDS.has(fixture.id) && !fixture.httpHeaders);
}

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
        contextFactory: async (req: {
          context?: { identity?: string; groups?: string[]; claims?: Record<string, unknown> };
          query?: { user?: string };
        }) =>
          req.context ?? {
            identity: req.query?.user ?? 'anonymous',
          },
      }),
    ],
  }).compile();
  await mod.init();
  closers.push(() => mod.close());
  return mod;
}

async function serviceFor(
  mod: Awaited<ReturnType<typeof moduleFor>>,
  identity: string,
  extras: { groups?: string[]; claims?: Record<string, unknown> } = {},
) {
  const id = ContextIdFactory.create();
  mod.registerRequestByContextId(
    { context: { identity, groups: extras.groups, claims: extras.claims } },
    id,
  );
  return mod.resolve(TogglyService, id) as Promise<TogglyService>;
}

@Controller()
@UseGuards(FeatureFlagGuard)
class ContractRoutes {
  constructor(@Inject(TogglyService) private readonly toggly: TogglyService) {}

  @Get('always-on')
  @FeatureFlag('always-on')
  alwaysOn() {
    return 'on';
  }

  @Get('beta')
  @FeatureFlag('beta')
  beta() {
    return 'beta';
  }

  @Get('gate-all')
  @FeatureFlag(['always-on', 'pct-full'])
  gateAll() {
    return 'gate-all';
  }

  @Get('gate-any')
  @FeatureFlag(['always-on', 'always-off'], { requirement: 'any' })
  gateAny() {
    return 'gate-any';
  }

  @Get('identity')
  @FeatureFlag('always-on')
  async identity() {
    return this.toggly.context();
  }
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

  it('enforces FeatureFlagGuard / FeatureFlag against definitions-signed payloads', async () => {
    const definitions = await listenDefinitions(() => JSON.stringify({ defs: DEFINITIONS }));
    const mod = await Test.createTestingModule({
      imports: [
        TogglyModule.forRoot({
          appKey: 'contract-app',
          baseUrl: definitions.baseUrl,
          refreshInterval: 0,
          enableStreaming: false,
          enableUsageTracking: false,
          enableMetrics: false,
          registerContextsOnStartup: false,
          contextFactory: async (req: { query?: { user?: string } }) => ({
            identity: req.query?.user ?? 'anonymous',
          }),
        }),
      ],
      controllers: [ContractRoutes],
    }).compile();
    const app = mod.createNestApplication();
    await app.listen(0, '127.0.0.1');
    closers.push(() => app.close());
    const url = await app.getUrl();

    expect((await fetch(`${url}/always-on`)).status).toBe(200);
    expect((await fetch(`${url}/beta?user=bob`)).status).toBe(404);
    expect((await fetch(`${url}/beta?user=alice`)).status).toBe(200);
    expect(await (await fetch(`${url}/gate-all`)).text()).toBe('gate-all');
    expect(await (await fetch(`${url}/gate-any`)).text()).toBe('gate-any');
    expect(await (await fetch(`${url}/identity?user=carol`)).json()).toEqual({
      identity: 'carol',
    });
  });
});

describe('filter-parity fixtures via Nest public evaluation API', () => {
  const fixtures = loadNestFilterParityFixtures();

  it('loads the Nest-evaluable Wave-1 subset', () => {
    expect(fixtures.map((f) => f.id).sort()).toEqual([...NEST_FILTER_PARITY_IDS].sort());
  });

  for (const fixture of fixtures) {
    it(`${fixture.id}`, async () => {
      const override = fixture.sdkExpectations?.['node-core'];
      if (override?.outcome === 'error') {
        // Nest adapter surfaces evaluation errors as false/disabled for gates;
        // skip fixtures that expect a thrown evaluator error at the core layer.
        return;
      }

      const definitions = await listenDefinitions(() =>
        JSON.stringify({
          defs: [
            {
              featureKey: fixture.featureKey,
              filters: fixture.filters,
            },
          ],
        }),
      );
      const mod = await moduleFor(definitions.baseUrl);
      const svc = await serviceFor(mod, fixture.context?.identity ?? 'anonymous', {
        groups: fixture.context?.groups,
        claims: fixture.context?.claims,
      });

      const expected =
        typeof override?.outcome === 'boolean'
          ? override.outcome
          : Array.isArray(override?.allowedOutcomes) && override.allowedOutcomes.length > 0
            ? override.allowedOutcomes
            : fixture.expected;

      const actual = await svc.isFeatureOn(fixture.featureKey);
      if (Array.isArray(expected)) {
        expect(expected).toContain(actual);
      } else {
        expect(actual).toBe(expected);
      }
    });
  }
});
