import { gunzipSync } from 'node:zlib';
import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Feature } from '../../components/Feature.js';
import { FeatureGate } from '../../components/FeatureGate.js';
import { TogglyProvider } from '../../components/TogglyProvider.js';
import { disposeTogglyClient, flushTelemetry } from '../../client/store.js';
import { useFeatureFlag } from '../../hooks/useFeatureFlag.js';

type Envelope = {
  f?: Record<string, Record<string, number[]>>;
};

async function bodyJson(body: BodyInit | null | undefined): Promise<Envelope> {
  if (typeof body === 'string') return JSON.parse(body) as Envelope;
  const bytes =
    body instanceof ArrayBuffer
      ? new Uint8Array(body)
      : ArrayBuffer.isView(body)
        ? new Uint8Array(body.buffer, body.byteOffset, body.byteLength)
        : null;
  if (!bytes) throw new Error(`Unsupported body: ${String(body)}`);
  return JSON.parse(gunzipSync(bytes).toString('utf8')) as Envelope;
}

function HookConsumer() {
  const { isEnabled } = useFeatureFlag('HookFlag');
  return <span>{isEnabled ? 'hook-on' : 'hook-off'}</span>;
}

describe('React consumer telemetry', () => {
  const envelopes: Envelope[] = [];

  beforeEach(() => {
    envelopes.length = 0;
    vi.spyOn(console, 'warn').mockImplementation(() => {
      // Suppress expected bounded diagnostics in transport mocks.
    });
  });

  afterEach(() => {
    disposeTogglyClient();
    vi.restoreAllMocks();
  });

  it('counts cold provider hydration and each mounted consumer evaluation once', async () => {
    let resolveDefinitions!: (response: Response) => void;
    const definitions = new Promise<Response>((resolve) => {
      resolveDefinitions = resolve;
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).includes('/api/frontend/telemetry')) {
        envelopes.push(await bodyJson(init?.body));
        return new Response(null, { status: 202 });
      }
      return definitions;
    });

    const view = render(
      <TogglyProvider
        config={{
          appKey: 'react-app',
          enableLiveUpdates: false,
          featureFlagsRefreshInterval: 0,
          metricsBaseUrl: 'https://collector.example',
        }}
      >
        <HookConsumer />
        <Feature flag="FeatureFlag" loading={<span>loading</span>}>
          <span>feature-on</span>
        </Feature>
        <FeatureGate flags={['GateOn', 'GateSkipped']} requirement="any">
          <span>gate-on</span>
        </FeatureGate>
      </TogglyProvider>,
    );

    expect(screen.getByText('loading')).toBeTruthy();
    await act(async () => {
      resolveDefinitions(
        new Response(
          JSON.stringify({
            HookFlag: true,
            FeatureFlag: true,
            GateOn: true,
            GateSkipped: false,
          }),
          { status: 200 },
        ),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await screen.findByText('hook-on');
    await screen.findByText('feature-on');
    await screen.findByText('gate-on');
    await flushTelemetry();

    expect(envelopes).toHaveLength(1);
    expect(envelopes[0].f).toEqual({
      HookFlag: { enabled: [1] },
      FeatureFlag: { enabled: [1] },
      GateOn: { enabled: [1] },
    });
    act(() => view.unmount());
  });
});
