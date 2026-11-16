/**
 * Flag evaluation against the Toggly HTTP API contract (mocked responses).
 *
 * Payloads match definitions-signed shapes used by the live definitions service.
 * Assertions exercise public createTogglyServerClient / getFlag / evaluateGate
 * paths — not stubbed evaluation helpers.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTogglyServerClient } from '../../server/toggly-server.js';

function definitionsSignedResponse(defs: unknown[]) {
  const body = JSON.stringify(defs);
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => body,
    json: async () => defs,
    headers: { get: () => null },
  } as Response;
}

describe('Toggly API contract evaluation (mocked HTTP)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('evaluates definitions-signed AlwaysOn/AlwaysOff/Targeting/UserClaims/Percentage filters', async () => {
    const defs = [
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

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(definitionsSignedResponse(defs));

    const client = createTogglyServerClient({
      appKey: 'contract-app',
      environment: 'Production',
      identity: 'bob',
      claims: { plan: 'basic' },
      enableLiveUpdates: false,
      featureFlagsRefreshInterval: 0,
    });

    expect(await client.getFlag('FlagOn')).toBe(true);
    expect(await client.getFlag('FlagOff')).toBe(false);
    expect(await client.getFlag('Targeted')).toBe(false);

    const calledUrl = String(vi.mocked(globalThis.fetch).mock.calls[0][0]);
    expect(calledUrl).toContain('/definitions-signed/contract-app/Production');
    expect(calledUrl).not.toContain('/evaluated-signed/');
    expect(new URL(calledUrl).searchParams.get('u')).toBeNull();

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(definitionsSignedResponse(defs));
    const aliceClient = createTogglyServerClient({
      appKey: 'contract-app',
      environment: 'Production',
      identity: 'alice',
      enableLiveUpdates: false,
      featureFlagsRefreshInterval: 0,
    });
    expect(await aliceClient.getFlag('Targeted')).toBe(true);

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(definitionsSignedResponse(defs));
    const claimsClient = createTogglyServerClient({
      appKey: 'contract-app',
      environment: 'Production',
      identity: 'bob',
      claims: { plan: 'pro' },
      enableLiveUpdates: false,
      featureFlagsRefreshInterval: 0,
    });
    expect(await claimsClient.getFlag('ClaimsGate')).toBe(true);
    expect(await client.getFlag('ClaimsGate')).toBe(false);
    expect(await client.getFlag('PercentClosed')).toBe(false);
    expect(await client.evaluateGate(['FlagOn', 'FlagOff'], 'any')).toBe(true);
    expect(await client.evaluateGate(['FlagOn', 'FlagOff'], 'all')).toBe(false);
    expect(await client.getFlag('Missing', true)).toBe(true);
  });

  it('keeps identity-agnostic definitions-signed URL for custom baseURI', async () => {
    const defs = [
      {
        featureKey: 'FlagOn',
        filters: [{ name: 'AlwaysOn', parameters: {} }],
      },
    ];
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(definitionsSignedResponse(defs));

    const client = createTogglyServerClient({
      appKey: 'contract-app',
      environment: 'Staging',
      baseURI: 'https://definitions.example.test',
      identity: 'should-not-appear-in-url',
      enableLiveUpdates: false,
      featureFlagsRefreshInterval: 0,
    });

    expect(await client.getFlag('FlagOn')).toBe(true);
    const url = new URL(String(fetchSpy.mock.calls[0][0]));
    expect(url.origin).toBe('https://definitions.example.test');
    expect(url.pathname).toBe('/definitions-signed/contract-app/Staging');
    expect([...url.searchParams.keys()]).toEqual([]);
  });
});

/*
 * KNOWN LIMITATION (owner decision — not changed in this PR):
 * Gatsby server getFlag/evaluateGate accept an optional entity context
 * (kind/key/attributes) but do not expose EvalContext.request fields
 * (country, userAgent, acceptLanguage). Segment filters that need those
 * request fields therefore cannot be exercised through the public Gatsby
 * server API without a new overload. Left alone per “do not change public
 * API or evaluation behavior to make a test pass.”
 */
