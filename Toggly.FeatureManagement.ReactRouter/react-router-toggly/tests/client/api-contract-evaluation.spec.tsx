/**
 * Browser client flag evaluation against the Toggly evaluated-signed API shape.
 */

import React from 'react';
import { render, waitFor } from '@testing-library/react';
import {
  TogglyProvider,
  useTogglyContext,
  type TogglyContextValue,
} from '../../src/client/context';

const mockFetch = global.fetch as jest.Mock;

function Capture({
  onContext,
}: {
  onContext: (ctx: TogglyContextValue) => void;
}) {
  const ctx = useTogglyContext();
  onContext(ctx);
  return null;
}

describe('Client evaluated-signed API contract evaluation', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('fetches evaluated-signed and evaluates returned flag map', async () => {
    // Browser non-variants path treats the JSON body as a flat FeatureFlags map
    // (same shape used across existing client unit tests).
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        FlagOn: true,
        FlagOff: false,
      }),
      headers: { get: () => null },
    });

    let captured: TogglyContextValue | undefined;
    render(
      <TogglyProvider
        config={{
          appKey: 'contract-app',
          environment: 'Production',
          baseUrl: 'https://definitions.example.test',
          enableUsageTracking: false,
          enableMetrics: false,
        }}
        enableRefresh={false}
      >
        <Capture onContext={(ctx) => (captured = ctx)} />
      </TogglyProvider>,
    );

    await waitFor(() => expect(captured?.isReady).toBe(true));

    const calledUrl = String(mockFetch.mock.calls[0][0]);
    expect(calledUrl).toContain(
      '/evaluated-signed/contract-app/Production',
    );
    expect(calledUrl).not.toContain('/definitions-signed/');

    expect(captured?.flags).toEqual({ FlagOn: true, FlagOff: false });
    expect(captured?.isEnabled('FlagOn')).toBe(true);
    expect(captured?.isDisabled('FlagOff')).toBe(true);
    expect(captured?.isEnabled('Missing', true)).toBe(true);
    expect(captured?.evaluateGate(['FlagOn', 'FlagOff'], 'any')).toBe(true);
    expect(captured?.evaluateGate(['FlagOn', 'FlagOff'], 'all')).toBe(false);
  });
});
