/**
 * Browser client flag evaluation against the Toggly evaluated-signed API shape.
 *
 * Exercises public initTogglyClient / useFeatureFlag / $flag / $gate entry points
 * against a mocked HTTP definitions response.
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { useFeatureFlag } from '../../hooks/useFeatureFlag.js';
import { TogglyProvider } from '../../components/TogglyProvider.js';

type StoreModule = typeof import('../../client/store.js');

function FlagProbe({ flagKey }: { flagKey: string }) {
  const { isEnabled, isReady } = useFeatureFlag(flagKey);
  return (
    <div>
      <span data-testid={`ready-${flagKey}`}>{String(isReady)}</span>
      <span data-testid={`enabled-${flagKey}`}>{String(isEnabled)}</span>
    </div>
  );
}

describe('Client evaluated-signed API contract evaluation', () => {
  let store: StoreModule;

  beforeEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    store = await import('../../client/store.js');
  });

  afterEach(() => {
    store.disposeTogglyClient();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('fetches evaluated-signed and evaluates returned flag map through public hooks', async () => {
    // Browser non-variants path treats the JSON body as a flat FeatureFlags map
    // (same shape used across existing client unit tests).
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => null },
      text: async () =>
        JSON.stringify({
          FlagOn: true,
          FlagOff: false,
        }),
      json: async () => ({
        FlagOn: true,
        FlagOff: false,
      }),
    } as unknown as Response);

    render(
      <TogglyProvider
        config={{
          appKey: 'contract-app',
          environment: 'Production',
          baseURI: 'https://definitions.example.test',
          enableLiveUpdates: false,
          featureFlagsRefreshInterval: 0,
          enableTelemetry: false,
        }}
      >
        <FlagProbe flagKey="FlagOn" />
        <FlagProbe flagKey="FlagOff" />
        <FlagProbe flagKey="Missing" />
      </TogglyProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('ready-FlagOn').textContent).toBe('true'));

    const calledUrl = String(fetchSpy.mock.calls[0][0]);
    expect(calledUrl).toContain('/evaluated-signed/contract-app/Production');
    expect(calledUrl).not.toContain('/definitions-signed/');
    expect(new URL(calledUrl).origin).toBe('https://definitions.example.test');

    expect(screen.getByTestId('enabled-FlagOn').textContent).toBe('true');
    expect(screen.getByTestId('enabled-FlagOff').textContent).toBe('false');
    expect(screen.getByTestId('enabled-Missing').textContent).toBe('false');

    expect(store.$flags.get()).toEqual({ FlagOn: true, FlagOff: false });
    expect(store.$flag('FlagOn').get()).toBe(true);
    expect(store.$flag('FlagOff').get()).toBe(false);
    expect(store.$flag('Missing', true).get()).toBe(true);
    expect(store.$gate(['FlagOn', 'FlagOff'], 'any').get()).toBe(true);
    expect(store.$gate(['FlagOn', 'FlagOff'], 'all').get()).toBe(false);
  });
});
