/**
 * Flag evaluation against the Toggly HTTP API contract (mocked responses).
 *
 * Payloads match definitions-signed / evaluated-signed shapes used by the
 * live definitions service. Assertions exercise real isEnabled / evaluateGate
 * paths — not stubbed evaluation helpers.
 */

import { TogglyServerClient } from '../../src/server/client';
import type { FeatureDefinitionModel } from '../../src/core';

const mockFetch = jest.fn();
global.fetch = mockFetch;

jest.mock('ws', () => {
  return jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    close: jest.fn(),
    removeAllListeners: jest.fn(),
    send: jest.fn(),
    readyState: 1,
  }));
});

function definitionsSignedResponse(defs: FeatureDefinitionModel[]) {
  const body = JSON.stringify(defs);
  return {
    ok: true,
    status: 200,
    text: () => Promise.resolve(body),
    json: () => Promise.resolve(defs),
    headers: { get: () => null },
  };
}

describe('Toggly API contract evaluation (mocked HTTP)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockReset();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('evaluates definitions-signed AlwaysOn/AlwaysOff/Targeting/UserClaims/Percentage filters', async () => {
    const defs: FeatureDefinitionModel[] = [
      {
        featureKey: 'FlagOn',
        filters: [{ name: 'AlwaysOn', parameters: {} }],
      },
      {
        featureKey: 'FlagOff',
        filters: [{ name: 'AlwaysOff', parameters: {} }],
      },
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
            parameters: {
              Percentage: 100,
              Claim: 'plan',
              Value: 'pro',
            },
          },
        ],
      },
      {
        featureKey: 'PercentClosed',
        filters: [
          {
            name: 'Percentage',
            parameters: { Value: 0 },
          },
        ],
      },
    ];

    mockFetch.mockResolvedValueOnce(definitionsSignedResponse(defs));

    const client = new TogglyServerClient({
      appKey: 'contract-app',
      environment: 'Production',
      enableUsageTracking: false,
      enableMetrics: false,
    });

    await client.init('bob');

    const calledUrl = String(mockFetch.mock.calls[0][0]);
    expect(calledUrl).toContain('/definitions-signed/contract-app/Production');
    expect(calledUrl).not.toContain('/evaluated-signed/');
    expect(new URL(calledUrl).searchParams.get('u')).toBeNull();

    expect(await client.isEnabled('FlagOn')).toBe(true);
    expect(await client.isEnabled('FlagOff')).toBe(false);
    expect(await client.isEnabled('Targeted')).toBe(false);
    expect(await client.isEnabled('Targeted', { identity: 'alice' })).toBe(true);
    expect(await client.isEnabled('ClaimsGate')).toBe(false);
    expect(
      await client.isEnabled('ClaimsGate', {
        identity: 'bob',
        claims: { plan: 'pro' },
      }),
    ).toBe(true);
    expect(await client.isEnabled('PercentClosed', { identity: 'bob' })).toBe(
      false,
    );
    expect(await client.evaluateGate(['FlagOn', 'FlagOff'], 'any')).toBe(true);
    expect(await client.evaluateGate(['FlagOn', 'FlagOff'], 'all')).toBe(false);
    expect(await client.isEnabled('Missing', undefined, true)).toBe(true);
  });

  it('keeps identity-agnostic definitions-signed URL while applying per-call context', async () => {
    const defs: FeatureDefinitionModel[] = [
      {
        featureKey: 'CountryUS',
        filters: [
          {
            name: 'Country',
            parameters: { Percentage: 100, 'Country:0': 'US' },
          },
        ],
      },
    ];
    mockFetch.mockResolvedValueOnce(definitionsSignedResponse(defs));

    const client = new TogglyServerClient({
      appKey: 'contract-app',
      environment: 'Staging',
      baseUrl: 'https://definitions.example.test',
      enableUsageTracking: false,
      enableMetrics: false,
    });

    await client.init();
    const url = new URL(String(mockFetch.mock.calls[0][0]));
    expect(url.origin).toBe('https://definitions.example.test');
    expect(url.pathname).toBe('/definitions-signed/contract-app/Staging');
    expect([...url.searchParams.keys()]).toEqual([]);

    expect(await client.isEnabled('CountryUS')).toBe(false);
    expect(
      await client.isEnabled('CountryUS', {
        request: { country: 'us' },
      }),
    ).toBe(true);
  });
});
