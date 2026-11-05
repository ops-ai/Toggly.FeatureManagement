/**
 * Flag evaluation against the Toggly HTTP API contract (mocked responses).
 *
 * Browser clients consume evaluated-signed payloads (boolean / entity-rule maps).
 * Assertions exercise real createClient / createToggly / Feature / useFeatureFlag
 * paths — not stubbed evaluation helpers or build-only checks.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@solidjs/testing-library';
import { createRoot } from 'solid-js';
import { createClient } from '../src/client';
import { createToggly, Feature, TogglyProvider, useFeatureFlag, useToggly } from '../src';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function evaluatedSignedResponse(defs: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(defs), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('Toggly API contract — browser evaluated-signed evaluation', () => {
  it('GETs evaluated-signed and evaluates through createClient', async () => {
    const fetcher = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(evaluatedSignedResponse({ 'feature-on': true, 'feature-off': false })),
      );

    const client = createClient({
      appKey: 'contract-app',
      environment: 'Production',
      identity: 'user-1',
      verifySignatures: false,
      enableLiveUpdates: false,
      enableTelemetry: false,
      fetch: fetcher,
    });

    await client.refresh();

    expect(fetcher).toHaveBeenCalled();
    const url = new URL(String(fetcher.mock.calls[0][0]));
    expect(url.pathname).toBe('/evaluated-signed/contract-app/Production');
    expect(url.searchParams.get('u')).toBe('user-1');

    expect(client.evaluate(['feature-on'])).toBe(true);
    expect(client.evaluate(['feature-off'])).toBe(false);
    expect(client.evaluate(['missing'])).toBe(false);
    expect(client.evaluate(['feature-on', 'feature-off'], 'any')).toBe(true);
    expect(client.evaluate(['feature-on', 'feature-off'], 'all')).toBe(false);
    client.dispose();
  });

  it('evaluates a realistic evaluated-signed boolean map through createClient', async () => {
    // Browser Solid client consumes the evaluated defs object (envelope.defs /
    // plain map). features[] is a node-core remote-rail shape; here we assert
    // the browser contract: a realistic evaluated map drives public gates.
    const fetcher = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(evaluatedSignedResponse({ alpha: true, beta: false })),
      );

    const client = createClient({
      appKey: 'contract-app',
      verifySignatures: false,
      enableLiveUpdates: false,
      enableTelemetry: false,
      fetch: fetcher,
    });
    await client.refresh();
    expect(String(fetcher.mock.calls[0][0])).toContain('/evaluated-signed/');
    expect(client.evaluate(['alpha'])).toBe(true);
    expect(client.evaluate(['beta'])).toBe(false);
    client.dispose();
  });

  it('exposes evaluated results through createToggly and Feature / useFeatureFlag', async () => {
    const fetcher = vi.fn().mockImplementation(() =>
      Promise.resolve(
        evaluatedSignedResponse({
          dashboard: true,
          legacy: false,
        }),
      ),
    );

    await new Promise<void>((resolve, reject) => {
      createRoot((dispose) => {
        const toggly = createToggly({
          appKey: 'contract-app',
          environment: 'Staging',
          verifySignatures: false,
          enableLiveUpdates: false,
          enableTelemetry: false,
          fetch: fetcher,
        });
        void toggly.client
          .refresh()
          .then(() => {
            expect(toggly.evaluate(['dashboard'])).toBe(true);
            expect(toggly.evaluate(['legacy'])).toBe(false);
            dispose();
            resolve();
          })
          .catch(reject);
      });
    });

    const View = () => {
      const enabled = useFeatureFlag('dashboard');
      const toggly = useToggly();
      return (
        <>
          <Feature feature="dashboard">
            <span>dashboard on</span>
          </Feature>
          <Feature feature="legacy">
            <span>legacy on</span>
          </Feature>
          <Feature feature="legacy" negate>
            <span>legacy off</span>
          </Feature>
          <p>
            {String(enabled())}/{String(toggly.evaluate(['dashboard', 'legacy'], 'all'))}
          </p>
        </>
      );
    };

    render(() => (
      <TogglyProvider
        config={{
          appKey: 'contract-app',
          environment: 'Staging',
          verifySignatures: false,
          enableLiveUpdates: false,
          enableTelemetry: false,
          fetch: fetcher,
        }}
      >
        <View />
      </TogglyProvider>
    ));

    await screen.findByText('dashboard on');
    expect(screen.getByText('legacy off')).toBeTruthy();
    expect(screen.queryByText('legacy on')).toBeNull();
    await waitFor(() => {
      expect(screen.getByText('true/false')).toBeTruthy();
    });

    const url = new URL(String(fetcher.mock.calls[0][0]));
    expect(url.pathname).toBe('/evaluated-signed/contract-app/Staging');
  });
});
