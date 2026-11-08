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

const flagMap = { FlagOn: true, FlagOff: false };

function renderClient(): { current: TogglyContextValue | undefined } {
  const captured: { current: TogglyContextValue | undefined } = {
    current: undefined,
  };
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
      <Capture onContext={(ctx) => (captured.current = ctx)} />
    </TogglyProvider>,
  );
  return captured;
}

function expectEvaluatedFlags(captured: TogglyContextValue | undefined): void {
  expect(captured?.flags).toEqual(flagMap);
  expect(captured?.isEnabled('FlagOn')).toBe(true);
  expect(captured?.isDisabled('FlagOff')).toBe(true);
  expect(captured?.isEnabled('Missing', true)).toBe(true);
  expect(captured?.evaluateGate(['FlagOn', 'FlagOff'], 'any')).toBe(true);
  expect(captured?.evaluateGate(['FlagOn', 'FlagOff'], 'all')).toBe(false);
}

describe('Client evaluated-signed API contract evaluation', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('unwraps an evaluated-signed defs envelope before evaluating flags', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        defs: flagMap,
        signature: 'synthetic-signature',
        timestamp: 1,
        kid: 'synthetic-kid',
      }),
      headers: { get: () => null },
    });

    const captured = renderClient();
    await waitFor(() => expect(captured.current?.isReady).toBe(true));

    const calledUrl = String(mockFetch.mock.calls[0][0]);
    expect(calledUrl).toContain(
      '/evaluated-signed/contract-app/Production',
    );
    expect(calledUrl).not.toContain('/definitions-signed/');
    expect(captured.current?.flags).not.toHaveProperty('signature');
    expectEvaluatedFlags(captured.current);
  });

  it('evaluates a bare evaluated-signed flag map', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => flagMap,
      headers: { get: () => null },
    });

    const captured = renderClient();
    await waitFor(() => expect(captured.current?.isReady).toBe(true));
    expectEvaluatedFlags(captured.current);
  });

  it('keeps prior flags when the body is an error envelope', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ error: 'unavailable' }),
      headers: { get: () => null },
    });

    const captured = renderClient();
    await waitFor(() => expect(captured.current?.isReady).toBe(true));
    expect(captured.current?.flags).toEqual({});
    expect(captured.current?.isEnabled('FlagOn')).toBe(false);
  });
});
