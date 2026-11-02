/**
 * Public-entry flag evaluation against the Toggly evaluated-signed /
 * evaluated-variants-signed API contract (mocked HTTP with realistic payloads).
 *
 * This client SDK consumes server-pre-evaluated flag maps; docs/filter-parity
 * fixtures and the variant-allocator corpus apply to local-eval SDKs, not here.
 */
import { FeatureRequirement } from '../lib/models';
import { Toggly } from '../lib/toggly';
import { mockAnonymousIdentity } from './mock-identity';

type FetchCall = { url: string; init?: RequestInit };

function mockEvaluatedFetch(payload: unknown): { calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify(payload),
      json: async () => payload,
    } as unknown as Response;
  }) as typeof fetch;
  return { calls };
}

async function initClient(options: {
  enableVariants?: boolean;
  payload: unknown;
}): Promise<FetchCall[]> {
  mockAnonymousIdentity('mock-uuid-contract');
  const { calls } = mockEvaluatedFetch(options.payload);
  await Toggly.init({
    appKey: 'contract-app',
    environment: 'Production',
    baseURI: 'https://definitions.example.test',
    identity: 'alice',
    groups: ['staff'],
    claims: { plan: 'pro' },
    enableLiveUpdates: false,
    featureFlagsRefreshInterval: 0,
    enableTelemetry: false,
    persistCache: false,
    enableVariants: options.enableVariants === true,
    verifySignatures: false,
  });
  return calls;
}

afterEach(() => {
  Toggly.cancelRefreshInterval();
  jest.restoreAllMocks();
});

describe('evaluated-signed API contract evaluation', () => {
  test('fetches evaluated-signed and evaluates wrapped defs map via public APIs', async () => {
    const calls = await initClient({
      payload: {
        defs: {
          AlwaysOn: true,
          AlwaysOff: false,
          TargetingMatch: true,
          PercentageGate: false,
        },
      },
    });

    expect(calls[0].url).toContain('/evaluated-signed/contract-app/Production');
    expect(calls[0].url).not.toContain('/definitions-signed/');
    expect(calls[0].url).not.toContain('/evaluated-variants-signed/');
    const query = new URL(calls[0].url).searchParams;
    expect(query.get('u')).toBe('alice');
    expect(query.getAll('g')).toEqual(['staff']);
    expect(query.get('claim.plan')).toBe('pro');

    expect(Toggly.isFeatureOn('AlwaysOn')).toBe(true);
    expect(Toggly.isFeatureOff('AlwaysOff')).toBe(true);
    expect(Toggly.isFeatureOn('TargetingMatch')).toBe(true);
    expect(Toggly.isFeatureOn('PercentageGate')).toBe(false);
    expect(Toggly.isFeatureOn('Missing')).toBeFalsy();

    expect(
      Toggly.evaluateFeatureGate(
        ['AlwaysOn', 'AlwaysOff'],
        FeatureRequirement.any,
      ),
    ).toBe(true);
    expect(
      Toggly.evaluateFeatureGate(
        ['AlwaysOn', 'AlwaysOff'],
        FeatureRequirement.all,
      ),
    ).toBe(false);
  });

  test('accepts flat evaluated-signed FeatureFlags body (no defs wrapper)', async () => {
    await initClient({
      payload: {
        FlagOn: true,
        FlagOff: false,
      },
    });

    expect(Toggly.isFeatureOn('FlagOn')).toBe(true);
    expect(Toggly.isFeatureOn('FlagOff')).toBe(false);
    expect(
      Toggly.evaluateFeatureGate(['FlagOn', 'FlagOff'], FeatureRequirement.any),
    ).toBe(true);
  });

  test('refresh re-evaluates after a new definitions payload', async () => {
    await initClient({
      payload: { defs: { Flip: false } },
    });
    expect(Toggly.isFeatureOn('Flip')).toBe(false);

    mockEvaluatedFetch({ defs: { Flip: true } });
    await Toggly.refresh();
    expect(Toggly.isFeatureOn('Flip')).toBe(true);
  });
});

describe('evaluated-variants-signed API contract evaluation', () => {
  test('fetches evaluated-variants-signed and exposes variant public APIs', async () => {
    const calls = await initClient({
      enableVariants: true,
      payload: {
        defs: {
          Sale: {
            enabled: true,
            variant: 'Treatment',
            configurationValue: { discount: 15 },
          },
          ControlOnly: {
            enabled: true,
            variant: 'Control',
            configurationValue: 'plain',
          },
          Disabled: {
            enabled: false,
            variant: 'Hidden',
            configurationValue: null,
          },
        },
      },
    });

    expect(calls[0].url).toContain(
      '/evaluated-variants-signed/contract-app/Production',
    );
    expect(calls[0].url).not.toContain('/evaluated-signed/contract-app');

    expect(Toggly.isFeatureOn('Sale')).toBe(true);
    expect(Toggly.isFeatureOn('Disabled')).toBe(false);
    expect(Toggly.getVariant('Sale')).toEqual({
      name: 'Treatment',
      configurationValue: { discount: 15 },
    });
    expect(Toggly.getVariantValue<{ discount: number }>('Sale')).toEqual({
      discount: 15,
    });
    expect(Toggly.getVariantValue('ControlOnly')).toBe('plain');
    expect(Toggly.getVariant('Missing')).toBeNull();
    expect(Toggly.getVariant('Disabled')).toBeNull();
  });
});
