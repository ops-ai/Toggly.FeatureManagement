/**
 * @vitest-environment jsdom
 *
 * Flag evaluation against the Toggly HTTP API contract (mocked responses).
 *
 * Server: public `createTogglyHandle` / `loadToggly` / `locals.toggly.isEnabled`
 * against definitions-signed (node-core local eval) and evaluated-signed (SSR snapshot).
 * Client: public `createToggly` / `Feature.svelte` against evaluated-signed maps.
 *
 * Shared `docs/filter-parity/fixtures` exercise real catalog-local evaluation through
 * the request-scoped handle. Mock only HTTP transport — never the evaluator.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { fromHttpRequest } from '@ops-ai/toggly-node-core';
import { createTogglyHandle, createTogglyClient, loadToggly } from '../src/server.js';
import { createToggly } from '../src/index.js';
import { envelope, jwk } from './signing.js';

type ParityFixture = {
  id: string;
  description: string;
  featureKey: string;
  requirementType?: string;
  filters: Array<{ name: string; parameters?: Record<string, unknown> }>;
  context?: {
    identity?: string;
    groups?: string[];
    claims?: Record<string, string>;
    request?: {
      userAgent?: string;
      acceptLanguage?: string;
      country?: string;
    };
  };
  httpHeaders?: Record<string, string>;
  expected: boolean;
};

const fixturesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../docs/filter-parity/fixtures',
);

function loadFixtures(): ParityFixture[] {
  return readdirSync(fixturesDir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => JSON.parse(readFileSync(join(fixturesDir, name), 'utf8')) as ParityFixture);
}

function httpJson(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function requestEvent(identity = 'bob', headers: Record<string, string> = {}) {
  return {
    locals: {},
    request: new Request('http://localhost/', {
      headers: {
        'user-agent': headers['user-agent'] ?? 'Chrome',
        'accept-language': headers['accept-language'] ?? 'en-US',
        'cf-ipcountry': headers['cf-ipcountry'] ?? headers['CF-IPCountry'] ?? '',
        ...headers,
      },
    }),
    url: new URL('http://localhost/'),
    identity,
  } as any;
}

const DEFINITIONS = [
  { featureKey: 'FlagOn', filters: [{ name: 'AlwaysOn', parameters: {} }] },
  { featureKey: 'FlagOff', filters: [{ name: 'AlwaysOff', parameters: {} }] },
  {
    featureKey: 'Targeted',
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
    featureKey: 'ClaimsGate',
    filters: [
      {
        name: 'UserClaims',
        parameters: { Percentage: 100, Claim: 'plan', Value: 'pro' },
      },
    ],
  },
  {
    featureKey: 'PercentClosed',
    filters: [{ name: 'Percentage', parameters: { Value: 0 } }],
  },
];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('Toggly API contract — server loadToggly evaluated-signed', () => {
  it('GETs evaluated-signed and exposes verified defs through loadToggly', async () => {
    const urls: URL[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = new URL(String(input));
        urls.push(url);
        if (url.pathname.endsWith('/.well-known/jwks')) {
          return httpJson({ keys: [jwk] });
        }
        return new Response(envelope({ FlagOn: true, FlagOff: false, hidden: true }));
      }),
    );

    const client = createTogglyClient({
      featureDefaults: {},
      enableStreaming: false,
      enableUsageTracking: false,
      enableMetrics: false,
    });
    await client.init();

    try {
      const event = requestEvent('alice');
      await createTogglyHandle({
        client,
        clientContext: () => ({ identity: 'alice' }),
        frontend: {
          appKey: 'contract-app',
          environment: 'Production',
          baseURI: 'https://definitions.example.test',
          expose: ['FlagOn', 'FlagOff'],
        },
      })({ event, resolve: async () => new Response() } as any);

      const snapshot = await loadToggly(event);
      const evaluated = urls.find((url) => url.pathname.includes('/evaluated-signed/'));
      expect(evaluated).toBeDefined();
      expect(evaluated!.origin).toBe('https://definitions.example.test');
      expect(evaluated!.pathname).toBe('/evaluated-signed/contract-app/Production');
      expect(evaluated!.searchParams.get('u')).toBe('alice');
      expect(evaluated!.pathname).not.toContain('/definitions-signed/');

      expect(snapshot.source).toBe('signed');
      expect(snapshot.definitions).toEqual({ FlagOn: true, FlagOff: false });
      expect(snapshot.definitions).not.toHaveProperty('hidden');
      expect(snapshot.definitions).not.toHaveProperty('signature');
    } finally {
      await client.close();
    }
  });
});

describe('Toggly API contract — server definitions-signed via createTogglyHandle', () => {
  it('evaluates AlwaysOn/AlwaysOff/Targeting/UserClaims/Percentage through locals.toggly', async () => {
    const mockFetch = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes('/definitions-signed/')) return httpJson(DEFINITIONS);
      if (url.endsWith('/.well-known/jwks')) return httpJson({ keys: [jwk] });
      return new Response(envelope({}));
    });
    vi.stubGlobal('fetch', mockFetch);

    const client = createTogglyClient({
      appKey: 'contract-app',
      environment: 'Production',
      baseUrl: 'https://definitions.example.test',
      verifySignatures: false,
      enableFileCache: false,
      refreshInterval: 0,
      enableStreaming: false,
      enableUsageTracking: false,
      enableMetrics: false,
      registerContextsOnStartup: false,
    });
    await client.init();

    try {
      const calledUrl = String(mockFetch.mock.calls[0][0]);
      expect(calledUrl).toContain('/definitions-signed/contract-app/Production');
      expect(calledUrl).not.toContain('/evaluated-signed/');
      expect(new URL(calledUrl).searchParams.get('u')).toBeNull();

      const bob = requestEvent('bob');
      await createTogglyHandle({
        client,
        context: () => ({ identity: 'bob', claims: { plan: 'basic' } }),
        frontend: { expose: [] },
      })({ event: bob, resolve: async () => new Response() } as any);

      expect(await bob.locals.toggly.isEnabled('FlagOn')).toBe(true);
      expect(await bob.locals.toggly.isEnabled('FlagOff')).toBe(false);
      expect(await bob.locals.toggly.isEnabled('Targeted')).toBe(false);
      expect(await bob.locals.toggly.isEnabled('ClaimsGate')).toBe(false);
      expect(await bob.locals.toggly.isEnabled('PercentClosed')).toBe(false);
      expect(await bob.locals.toggly.gate(['FlagOn', 'FlagOff'], { requirement: 'any' })).toBe(
        true,
      );
      expect(await bob.locals.toggly.gate(['FlagOn', 'FlagOff'], { requirement: 'all' })).toBe(
        false,
      );

      const alice = requestEvent('alice');
      await createTogglyHandle({
        client,
        context: () => ({ identity: 'alice', claims: { plan: 'pro' } }),
        frontend: { expose: [] },
      })({ event: alice, resolve: async () => new Response() } as any);

      expect(await alice.locals.toggly.isEnabled('Targeted')).toBe(true);
      expect(await alice.locals.toggly.isEnabled('ClaimsGate')).toBe(true);
    } finally {
      await client.close();
    }
  });
});

describe('Toggly API contract — client evaluated-signed via createToggly / Feature', () => {
  it('hydrates an evaluated-signed boolean map and evaluates through createToggly + Feature gate', async () => {
    const Probe = (await import('./contract-feature-probe.svelte')).default;
    const { mount, unmount } = await import('svelte');

    const flagMap = { FlagOn: true, FlagOff: false };
    const toggly = createToggly({
      definitions: flagMap,
      context: { identity: 'alice' },
      expose: ['FlagOn', 'FlagOff'],
      source: 'signed',
    });

    expect(toggly.isEnabled('FlagOn')).toBe(true);
    expect(toggly.isEnabled('FlagOff')).toBe(false);
    expect(toggly.isEnabled('Missing')).toBe(false);
    expect(toggly.gate(['FlagOn', 'FlagOff'], { requirement: 'any' })).toBe(true);
    expect(toggly.gate(['FlagOn', 'FlagOff'], { requirement: 'all' })).toBe(false);
    expect(get(toggly).definitions).toEqual(flagMap);

    // Feature.svelte is the public client component over the same store evaluation path.
    const target = document.createElement('div');
    document.body.appendChild(target);
    const on = mount(Probe, {
      target,
      props: { toggly, feature: 'FlagOn', label: 'flag-on' },
    });
    expect(target.textContent).toContain('flag-on');
    unmount(on);

    const offTarget = document.createElement('div');
    document.body.appendChild(offTarget);
    const off = mount(Probe, {
      target: offTarget,
      props: { toggly, feature: 'FlagOff', label: 'flag-off' },
    });
    expect(offTarget.textContent).not.toContain('flag-off');
    unmount(off);

    const negateTarget = document.createElement('div');
    document.body.appendChild(negateTarget);
    const negated = mount(Probe, {
      target: negateTarget,
      props: {
        toggly,
        feature: 'FlagOff',
        options: { negate: true },
        label: 'flag-off-negated',
      },
    });
    expect(negateTarget.textContent).toContain('flag-off-negated');
    unmount(negated);

    toggly.dispose();
    target.remove();
    offTarget.remove();
    negateTarget.remove();
  });

  it('refreshes from a signed evaluated-signed envelope through createToggly.start', async () => {
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

    const fetcher = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.endsWith('/.well-known/jwks')) return httpJson({ keys: [jwk] });
      return new Response(envelope({ FlagOn: true, FlagOff: false }));
    });
    vi.stubGlobal('fetch', fetcher);

    const toggly = createToggly(
      {
        definitions: { FlagOn: false },
        context: { identity: 'alice' },
        expose: ['FlagOn', 'FlagOff'],
      },
      {
        appKey: 'contract-app',
        environment: 'Production',
        baseURI: 'https://definitions.example.test',
        enableLiveUpdates: false,
        refreshInterval: 0,
        enableTelemetry: false,
      },
    );

    try {
      await toggly.start();
      await vi.waitFor(() => expect(toggly.isEnabled('FlagOn')).toBe(true));
      expect(toggly.isEnabled('FlagOff')).toBe(false);
      const called = String(
        fetcher.mock.calls.find((c) => String(c[0]).includes('/evaluated-signed/'))![0],
      );
      expect(called).toContain('/evaluated-signed/contract-app/Production');
      expect(called).not.toContain('/definitions-signed/');
      expect(new URL(called).searchParams.get('u')).toBe('alice');
    } finally {
      toggly.dispose();
    }
  });
});

describe('filter-parity golden fixtures via createTogglyHandle', () => {
  const fixtures = loadFixtures();
  const knownFailureIds = new Set(['targeting-rollout-partial-anonymous']);

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('loads the shared Wave 1 fixture set', () => {
    const ids = new Set(fixtures.map((f) => f.id));
    for (const required of [
      'browser-family-match',
      'browser-family-miss',
      'browser-language-match',
      'country-from-request',
      'country-from-cf-ipcountry',
      'device-type-match',
      'os-match',
      'user-claims-match',
      'user-claims-miss',
      'targeting-groups-match',
      'percentage-missing-fail-closed',
      'percentage-zero-fail-closed',
      'unknown-filter-fail-closed',
    ]) {
      expect(ids.has(required), `missing fixture ${required}`).toBe(true);
    }
  });

  /**
   * KNOWN FAILURE (owner decision): fixture `targeting-rollout-partial-anonymous`
   * expects fail-closed when identity is omitted. `@ops-ai/toggly-node-core`
   * sticky-buckets an anonymous UUID instead (policy: keep random bucketing for
   * anonymous users). Covered below; excluded from the golden loop.
   */
  for (const fixture of fixtures.filter((f) => !knownFailureIds.has(f.id))) {
    it(`${fixture.id}: ${fixture.description}`, async () => {
      const def = {
        featureKey: fixture.featureKey,
        requirementType: fixture.requirementType,
        filters: fixture.filters,
      };
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: unknown) => {
          const url = String(input);
          if (url.includes('/definitions-signed/')) return httpJson([def]);
          if (url.endsWith('/.well-known/jwks')) return httpJson({ keys: [jwk] });
          return new Response(envelope({}));
        }),
      );

      const client = createTogglyClient({
        appKey: 'parity-app',
        environment: 'Production',
        baseUrl: 'https://definitions.example.test',
        verifySignatures: false,
        enableFileCache: false,
        refreshInterval: 0,
        enableStreaming: false,
        enableUsageTracking: false,
        enableMetrics: false,
        registerContextsOnStartup: false,
      });
      await client.init();

      try {
        const base = fixture.context ?? {};
        const context = fixture.httpHeaders ? fromHttpRequest(fixture.httpHeaders, base) : base;
        const event = requestEvent(context.identity ?? 'anon', fixture.httpHeaders ?? {});
        await createTogglyHandle({
          client,
          context: () => context,
          frontend: { expose: [] },
        })({ event, resolve: async () => new Response() } as any);

        expect(await event.locals.toggly.isEnabled(fixture.featureKey)).toBe(fixture.expected);
      } finally {
        await client.close();
      }
    });
  }

  it('KNOWN FAILURE: omitted identity on partial Targeting rollout is not fail-closed in node-core', async () => {
    const fixture = fixtures.find((f) => f.id === 'targeting-rollout-partial-anonymous');
    expect(fixture).toBeDefined();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.includes('/definitions-signed/')) {
          return httpJson([
            {
              featureKey: fixture!.featureKey,
              requirementType: fixture!.requirementType,
              filters: fixture!.filters,
            },
          ]);
        }
        return httpJson({ keys: [jwk] });
      }),
    );

    const client = createTogglyClient({
      appKey: 'parity-app',
      environment: 'Production',
      baseUrl: 'https://definitions.example.test',
      verifySignatures: false,
      enableFileCache: false,
      refreshInterval: 0,
      enableStreaming: false,
      enableUsageTracking: false,
      enableMetrics: false,
      registerContextsOnStartup: false,
    });
    await client.init();

    try {
      // Parity-aligned path: explicit empty identity fails closed.
      expect(await client.isFeatureOn(fixture!.featureKey, { identity: '' })).toBe(false);
      // Omitted identity: node-core may sticky-bucket an anonymous UUID (50/50).
      await client.isFeatureOn(fixture!.featureKey, {});
      expect(fixture!.expected).toBe(false);
    } finally {
      await client.close();
    }
  });
});
