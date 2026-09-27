/**
 * Client enableVariants / getVariant / getVariantValue
 */

import React from 'react';
import { render, waitFor, act } from '@testing-library/react';
import {
  TogglyProvider,
  useTogglyContext,
  type TogglyContextValue,
} from '../../src/client/context';

const mockFetch = global.fetch as jest.Mock;

function Probe({ onReady }: { onReady: (ctx: TogglyContextValue) => void }) {
  const ctx = useTogglyContext();
  React.useEffect(() => {
    if (ctx.isReady) onReady(ctx);
  }, [ctx, onReady]);
  return null;
}

describe('enableVariants (client)', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('fetches evaluated-variants-signed and exposes getVariant / getVariantValue', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        defs: {
          Checkout: {
            enabled: true,
            variant: 'treatment',
            configurationValue: { color: 'blue' },
          },
          Off: { enabled: false, variant: 'control' },
        },
      }),
    });

    let context: TogglyContextValue | undefined;
    render(
      <TogglyProvider
        config={{
          appKey: 'test-key',
          environment: 'Production',
          enableVariants: true,
          enableTelemetry: false,
        }}
      >
        <Probe onReady={(ctx) => { context = ctx; }} />
      </TogglyProvider>,
    );

    await waitFor(() => expect(context?.isReady).toBe(true));

    const url = String(mockFetch.mock.calls[0]?.[0]);
    expect(url).toContain('/evaluated-variants-signed/test-key/Production');
    expect(url).not.toContain('/evaluated-signed/');

    expect(context!.flags).toEqual({ Checkout: true, Off: false });
    expect(context!.getVariant('Checkout')).toEqual({
      name: 'treatment',
      configurationValue: { color: 'blue' },
    });
    expect(context!.getVariant('Off')).toBeNull();
    expect(context!.getVariant('Missing')).toBeNull();
    expect(context!.getVariantValue('Checkout')).toEqual({ color: 'blue' });
    expect(
      context!.getVariantValue('Checkout', (v): v is { color: string } =>
        typeof v === 'object' && v !== null && typeof (v as { color?: unknown }).color === 'string',
      ),
    ).toEqual({ color: 'blue' });
    expect(
      context!.getVariantValue('Checkout', (v): v is number => typeof v === 'number'),
    ).toBeNull();
  });

  it('returns null from getVariant when enableVariants is unset', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ Plain: true }),
    });

    let context: TogglyContextValue | undefined;
    render(
      <TogglyProvider
        config={{
          appKey: 'test-key',
          enableTelemetry: false,
        }}
      >
        <Probe onReady={(ctx) => { context = ctx; }} />
      </TogglyProvider>,
    );

    await waitFor(() => expect(context?.isReady).toBe(true));
    expect(String(mockFetch.mock.calls[0]?.[0])).toContain('/evaluated-signed/');
    expect(context!.getVariant('Plain')).toBeNull();
    expect(context!.getVariantValue('Plain')).toBeNull();
  });

  it('soft-nulls when a local gate suppresses the feature', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        defs: {
          Checkout: {
            enabled: true,
            variant: 'treatment',
            configurationValue: 1,
          },
        },
      }),
    });

    let context: TogglyContextValue | undefined;
    render(
      <TogglyProvider
        config={{
          appKey: 'test-key',
          enableVariants: true,
          enableTelemetry: false,
          localGates: [
            {
              id: 'deny',
              flagKeys: ['Checkout'],
              isEnabled: () => false,
            },
          ],
        }}
      >
        <Probe onReady={(ctx) => { context = ctx; }} />
      </TogglyProvider>,
    );

    await waitFor(() => expect(context?.isReady).toBe(true));
    expect(context!.getVariant('Checkout')).toBeNull();
    expect(context!.getVariantValue('Checkout')).toBeNull();
  });

  it('clears stale variants across identify()', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          defs: {
            Checkout: { enabled: true, variant: 'control', configurationValue: 'a' },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          defs: {
            Checkout: { enabled: true, variant: 'treatment', configurationValue: 'b' },
          },
        }),
      });

    let context: TogglyContextValue | undefined;
    render(
      <TogglyProvider
        config={{
          appKey: 'test-key',
          enableVariants: true,
          enableTelemetry: false,
        }}
      >
        <Probe onReady={(ctx) => { context = ctx; }} />
      </TogglyProvider>,
    );

    await waitFor(() => expect(context?.getVariant('Checkout')?.name).toBe('control'));

    await act(async () => {
      await context!.identify('user-2');
    });

    await waitFor(() => expect(context?.getVariant('Checkout')?.name).toBe('treatment'));
    expect(context!.getVariantValue('Checkout')).toBe('b');
  });
});
