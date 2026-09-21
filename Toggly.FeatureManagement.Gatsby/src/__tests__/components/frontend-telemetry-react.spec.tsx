import { gunzipSync } from 'node:zlib';
import React from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Feature } from '../../components/Feature.js';
import { FeatureGate } from '../../components/FeatureGate.js';
import { TogglyProvider } from '../../components/TogglyProvider.js';
import { disposeTogglyClient, flushTelemetry, initTogglyClient, refreshFlags, incrementCounter } from '../../client/store.js';
import { useFeatureFlag } from '../../hooks/useFeatureFlag.js';

type Envelope = {
  i?: string;
  m?: Record<string, number>;
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

  it('keeps discarded warm hydration silent and counts the committed consumers', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => { /* Captured below for hydration assertions. */ });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).includes('/api/frontend/telemetry')) {
        envelopes.push(await bodyJson(init?.body));
        return new Response(null, { status: 202 });
      }
      return new Response(JSON.stringify({ HookFlag: true, FeatureFlag: true, GateOn: true }), { status: 200 });
    });
    const config = { appKey: 'hydrate-app', enableLiveUpdates: false, featureFlagsRefreshInterval: 0, metricsBaseUrl: 'https://collector.example' };
    const children = <TogglyProvider config={config}><HookConsumer /><Feature flag="FeatureFlag">feature-on</Feature><FeatureGate flags={['GateOn', 'Skipped']} requirement="any">gate-on</FeatureGate></TogglyProvider>;
    const container = document.createElement('div');
    container.innerHTML = renderToString(children);
    document.body.appendChild(container);
    await initTogglyClient(config);
    let root!: ReturnType<typeof hydrateRoot>;
    try {
      await act(async () => { root = hydrateRoot(container, children); });
      await flushTelemetry();
      // No server snapshot is serialized: this deliberately exercises React's discarded render.
      expect(errors.mock.calls.some(call => String(call[0]).includes('hydration'))).toBe(true);
      expect(container.textContent).toBe('hook-onfeature-ongate-on');
      expect(envelopes[0]?.f).toEqual({ HookFlag: { enabled: [1] }, FeatureFlag: { enabled: [1] }, GateOn: { enabled: [1] } });
    } finally {
      await act(async () => root?.unmount());
      container.remove();
    }
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
  it('updates mounted provider consumers once under the new token without replacing queued attribution', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).includes('/api/frontend/telemetry')) {
        envelopes.push(await bodyJson(init?.body));
        return new Response(null, { status: 202 });
      }
      return new Response(JSON.stringify({ HookFlag: new URL(String(input)).searchParams.get('i') === 'a' }));
    });
    const config = { appKey: 'react-app', instanceId: 'a', enableLiveUpdates: false, featureFlagsRefreshInterval: 0 };
    const view = render(<React.StrictMode><TogglyProvider config={config}><HookConsumer /></TogglyProvider></React.StrictMode>);
    await screen.findByText('hook-on');
    view.rerender(<React.StrictMode><TogglyProvider config={{ ...config, instanceId: 'b' }}><HookConsumer /></TogglyProvider></React.StrictMode>);
    await screen.findByText('hook-off');
    await act(async () => { await flushTelemetry(); });
    expect(envelopes.map(e => [e.i, e.f])).toEqual([
      ['a', { HookFlag: { enabled: [1] } }],
      ['b', { HookFlag: { disabled: [1] } }],
    ]);
    act(() => view.unmount());
  });

  it('counts already-ready mounted consumers once', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).includes('/api/frontend/telemetry')) {
        envelopes.push(await bodyJson(init?.body)); return new Response(null, { status: 202 });
      }
      return new Response(JSON.stringify({ HookFlag: true, FeatureFlag: true, GateOn: true }));
    });
    const config = { appKey: 'ready-app', enableLiveUpdates: false, featureFlagsRefreshInterval: 0 };
    await initTogglyClient(config);
    const view = render(<TogglyProvider config={config}><HookConsumer /><Feature flag="FeatureFlag">feature-on</Feature><FeatureGate flags={['GateOn','Skipped']} requirement="any">gate-on</FeatureGate></TogglyProvider>);
    await act(async () => { await flushTelemetry(); });
    expect(envelopes.map(e => e.f)).toEqual([{ HookFlag: { enabled: [1] }, FeatureFlag: { enabled: [1] }, GateOn: { enabled: [1] } }]);
    act(() => view.unmount());
  });

  it('counts a committed ready mount once across StrictMode replay and counts a genuine remount again', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).includes('/api/frontend/telemetry')) { envelopes.push(await bodyJson(init?.body)); return new Response(null, { status: 202 }); }
      return new Response(JSON.stringify({ HookFlag: true, FeatureFlag: true, GateOn: true }));
    });
    await initTogglyClient({ appKey: 'strict-app', enableLiveUpdates: false, featureFlagsRefreshInterval: 0 });
    const consumers = <React.StrictMode><HookConsumer /><Feature flag="FeatureFlag">feature-on</Feature><FeatureGate flags={['GateOn', 'Skipped']} requirement="any">gate-on</FeatureGate></React.StrictMode>;
    const first = render(consumers);
    await flushTelemetry();
    expect(envelopes[0]?.f).toEqual({ HookFlag: { enabled: [1] }, FeatureFlag: { enabled: [1] }, GateOn: { enabled: [1] } });
    act(() => first.unmount());
    const second = render(consumers);
    await flushTelemetry();
    expect(envelopes[1]?.f).toEqual(envelopes[0].f);
    act(() => second.unmount());
  });

  it('retains every subscribed recomputation, including an unchanged public result, and silences detached stores', async () => {
    let enabled = true;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).includes('/api/frontend/telemetry')) { envelopes.push(await bodyJson(init?.body)); return new Response(null, { status: 202 }); }
      return new Response(JSON.stringify({ HookFlag: enabled, FeatureFlag: enabled, GateOn: enabled, Skipped: false }));
    });
    await initTogglyClient({ appKey: 'refresh-app', enableLiveUpdates: false, featureFlagsRefreshInterval: 0 });
    const view = render(<><HookConsumer /><Feature flag="FeatureFlag">feature-on</Feature><FeatureGate flags={['GateOn', 'Skipped']} requirement="any">gate-on</FeatureGate></>);
    await act(async () => { await refreshFlags(); });
    enabled = false;
    await act(async () => { await refreshFlags(); });
    expect(screen.getByText('hook-off')).toBeTruthy();
    expect(screen.queryByText('feature-on')).toBeNull();
    expect(screen.queryByText('gate-on')).toBeNull();
    await flushTelemetry();
    expect(envelopes[0]?.f).toEqual({ HookFlag: { enabled: [2], disabled: [1] }, FeatureFlag: { enabled: [2], disabled: [1] }, GateOn: { enabled: [2], disabled: [1] }, Skipped: { disabled: [1] } });
    act(() => view.unmount());
    await refreshFlags();
    await flushTelemetry();
    expect(envelopes).toHaveLength(1);
  });

  it('keeps cold server rendering silent and counts delayed hydration exactly once', async () => {
    let resolveDefinitions!: (response: Response) => void;
    const definitions = new Promise<Response>(resolve => { resolveDefinitions = resolve; });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => { /* Captured below for hydration assertions. */ });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).includes('/api/frontend/telemetry')) { envelopes.push(await bodyJson(init?.body)); return new Response(null, { status: 202 }); }
      return definitions;
    });
    const config = { appKey: 'delayed-app', enableLiveUpdates: false, featureFlagsRefreshInterval: 0 };
    const consumers = <TogglyProvider config={config}><HookConsumer /><Feature flag="FeatureFlag">feature-on</Feature><FeatureGate flags={['GateOn', 'Skipped']} requirement="any">gate-on</FeatureGate></TogglyProvider>;
    const container = document.createElement('div');
    container.innerHTML = renderToString(consumers);
    document.body.appendChild(container);
    let root!: ReturnType<typeof hydrateRoot>;
    try {
      await act(async () => { root = hydrateRoot(container, consumers); });
      await flushTelemetry();
      expect(envelopes).toHaveLength(0);
      await act(async () => { resolveDefinitions(new Response(JSON.stringify({ HookFlag: true, FeatureFlag: true, GateOn: true }))); });
      expect(container.textContent).toBe('hook-onfeature-ongate-on');
      await flushTelemetry();
      expect(envelopes[0]?.f).toEqual({ HookFlag: { enabled: [1] }, FeatureFlag: { enabled: [1] }, GateOn: { enabled: [1] } });
      expect(errors).not.toHaveBeenCalled();
    } finally { await act(async () => root?.unmount()); container.remove(); }
  });

  it('keeps the newest overlapping refresh visible and counts only its committed recomputation', async () => {
    let respond = async () => new Response(JSON.stringify({ HookFlag: true }));
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).includes('/api/frontend/telemetry')) { envelopes.push(await bodyJson(init?.body)); return new Response(null, { status: 202 }); }
      return respond();
    });
    await initTogglyClient({ appKey: 'overlap-app', enableLiveUpdates: false, featureFlagsRefreshInterval: 0 });
    const view = render(<HookConsumer />);
    await flushTelemetry();
    let resolveOld!: (response: Response) => void;
    respond = () => new Promise(resolve => { resolveOld = resolve; });
    const old = refreshFlags();
    respond = async () => new Response(JSON.stringify({ HookFlag: false }));
    await act(async () => { await refreshFlags(); });
    await act(async () => { resolveOld(new Response(JSON.stringify({ HookFlag: true }))); await old; });
    expect(screen.getByText('hook-off')).toBeTruthy();
    await flushTelemetry();
    expect(envelopes.map(envelope => envelope.f)).toEqual([{ HookFlag: { enabled: [1] } }, { HookFlag: { disabled: [1] } }]);
    act(() => view.unmount());
  });

  it('discards retired Provider queues on replacement while final unmount flushes the current owner', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).includes('/api/frontend/telemetry')) { envelopes.push(await bodyJson(init?.body)); return new Response(null, { status: 202 }); }
      return new Response(JSON.stringify({ HookFlag: true }));
    });
    const config = { appKey: 'replacement', enableLiveUpdates: false, featureFlagsRefreshInterval: 0, metricsBaseUrl: 'https://old.example' };
    const view = render(<React.StrictMode><TogglyProvider config={config}><HookConsumer /></TogglyProvider></React.StrictMode>);
    await screen.findByText('hook-on');
    await flushTelemetry(); envelopes.length = 0;
    incrementCounter('retired');
    view.rerender(<React.StrictMode><TogglyProvider config={{ ...config, metricsBaseUrl: 'https://off.example', enableTelemetry: false }}><HookConsumer /></TogglyProvider></React.StrictMode>);
    await act(async () => { await Promise.resolve(); });
    expect(envelopes).toEqual([]);
    view.rerender(<React.StrictMode><TogglyProvider config={{ ...config, metricsBaseUrl: 'https://new.example' }}><HookConsumer /></TogglyProvider></React.StrictMode>);
    await act(async () => { await Promise.resolve(); });
    incrementCounter('current');
    await act(async () => view.unmount());
    await vi.waitFor(() => expect(envelopes.some(envelope => envelope.m?.current === 1)).toBe(true));
    expect(envelopes.some(envelope => envelope.m?.retired)).toBe(false);
  });

  it('keeps mounted gate selection immutable and counts only the selected leaves', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).includes('/api/frontend/telemetry')) { envelopes.push(await bodyJson(init?.body)); return new Response(null, { status: 202 }); }
      return new Response(JSON.stringify({ First: true, Later: true, Injected: false }));
    });
    const keys = ['First', 'Later'];
    const later = { id: 'later', flagKeys: ['Later'], isEnabled: () => true };
    await initTogglyClient({ appKey: 'mounted-gates', enableLiveUpdates: false, featureFlagsRefreshInterval: 0, localGates: [
      { id: 'first', flagKeys: ['First'], isEnabled: () => { later.isEnabled = () => false; keys[1] = 'Injected'; return true; } }, later,
    ] });
    const view = render(<FeatureGate flags={keys}>selected-on</FeatureGate>);
    expect(screen.getByText('selected-on')).toBeTruthy();
    await flushTelemetry();
    expect(envelopes[0]?.f).toEqual({ First: { enabled: [1] }, Later: { enabled: [1] } });
    act(() => view.unmount());
  });

  it('keeps a genuinely remounted Provider owner alive through the previous cleanup', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).includes('/api/frontend/telemetry')) { envelopes.push(await bodyJson(init?.body)); return new Response(null, { status: 202 }); }
      return new Response(JSON.stringify({ HookFlag: true }));
    });
    const config = { appKey: 'remount-provider', enableLiveUpdates: false, featureFlagsRefreshInterval: 0 };
    const view = render(<TogglyProvider key="first" config={config}><HookConsumer /></TogglyProvider>);
    await screen.findByText('hook-on');
    await flushTelemetry(); envelopes.length = 0;
    view.rerender(<TogglyProvider key="second" config={config}><HookConsumer /></TogglyProvider>);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText('hook-on')).toBeTruthy();
    incrementCounter('remounted'); await flushTelemetry();
    expect(envelopes.some(envelope => envelope.m?.remounted === 1)).toBe(true);
    await act(async () => view.unmount());
  });

  it('aborts the active retired Provider transport when replacement opts out', async () => {
    let activeSignal: AbortSignal | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).includes('/api/frontend/telemetry')) {
        activeSignal = init?.signal ?? undefined;
        return new Promise<Response>((_resolve, reject) => activeSignal?.addEventListener('abort', () => reject(new DOMException('Retired', 'AbortError')), { once: true }));
      }
      return new Response(JSON.stringify({ HookFlag: true }));
    });
    const config = { appKey: 'active-replacement', enableLiveUpdates: false, featureFlagsRefreshInterval: 0, metricsBaseUrl: 'https://old.example' };
    const view = render(<TogglyProvider config={config}><HookConsumer /></TogglyProvider>);
    await screen.findByText('hook-on');
    incrementCounter('inflight');
    const flushing = flushTelemetry();
    await vi.waitFor(() => expect(activeSignal).toBeDefined());
    view.rerender(<TogglyProvider config={{ ...config, metricsBaseUrl: 'https://new.example', enableTelemetry: false }}><HookConsumer /></TogglyProvider>);
    expect(activeSignal?.aborted).toBe(true);
    await flushing;
    await act(async () => view.unmount());
  });

});
