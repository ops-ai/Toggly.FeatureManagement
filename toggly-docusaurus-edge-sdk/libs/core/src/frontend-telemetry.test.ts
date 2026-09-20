import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntityGate } from '@ops-ai/toggly-hooks-types';

const telemetry = vi.hoisted(() => {
  const reporter = {
    recordCheck: vi.fn(),
    recordUsage: vi.fn(),
    recordView: vi.fn(),
    incrementCounter: vi.fn(),
    setGauge: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
    setContext: vi.fn(),
    dispose: vi.fn(),
  };
  return {
    reporter,
    createTelemetryReporter: vi.fn(() => reporter),
    detach: vi.fn(),
    attachBrowserLifecycle: vi.fn(() => telemetry.detach),
  };
});

vi.mock('@ops-ai/toggly-client-telemetry', () => ({
  createTelemetryReporter: telemetry.createTelemetryReporter,
}));

vi.mock('@ops-ai/toggly-client-telemetry/browser', () => ({
  attachBrowserLifecycle: telemetry.attachBrowserLifecycle,
}));

import { createTogglyClient as createPortableClient } from './index';
import { createTogglyClient as createBrowserClient } from './browser';

function response(flags: Record<string, unknown>): Response {
  const body = JSON.stringify(flags);
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => body,
    json: async () => flags,
  } as Response;
}

function installBrowserGlobals(): void {
  vi.stubGlobal('window', {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal('document', {
    visibilityState: 'visible',
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
}

describe('frontend telemetry ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    telemetry.reporter.flush.mockResolvedValue(undefined);
    telemetry.createTelemetryReporter.mockReturnValue(telemetry.reporter);
    telemetry.attachBrowserLifecycle.mockReturnValue(telemetry.detach);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps the portable and SSR entry silent', async () => {
    const fetch = vi.fn().mockResolvedValue(response({ Enabled: true }));
    const portable = createPortableClient({ appKey: 'app', fetch });
    const browserDuringSsr = createBrowserClient({ appKey: 'app', fetch });

    await expect(portable.getFlag('Enabled')).resolves.toBe(true);
    await expect(browserDuringSsr.getFlag('Enabled')).resolves.toBe(true);

    expect(telemetry.createTelemetryReporter).not.toHaveBeenCalled();
    expect(telemetry.attachBrowserLifecycle).not.toHaveBeenCalled();
  });

  it('records each actual browser evaluation after entity resolution without counting refreshes', async () => {
    installBrowserGlobals();
    const gate: EntityGate = {
      requirement: 'all',
      rules: [{ property: 'Plan', op: 'eq', value: 'pro', type: 'string' }],
    };
    const fetch = vi.fn().mockResolvedValue(response({ Enabled: true, Disabled: false, Gated: gate }));
    const client = createBrowserClient({
      appKey: 'app',
      environment: 'Staging',
      metricsBaseUrl: 'https://metrics.example/base',
      telemetryFlushIntervalMs: 30_000,
      fetch,
    });

    await client.getFlags();
    expect(telemetry.reporter.recordCheck).not.toHaveBeenCalled();

    await expect(client.getFlag('Enabled')).resolves.toBe(true);
    await expect(client.getFlag('Disabled')).resolves.toBe(false);
    await expect(client.getFlag('Gated', false, {
      kind: 'Account',
      key: 'a-1',
      attributes: { Plan: 'free' },
    })).resolves.toBe(false);

    expect(telemetry.createTelemetryReporter).toHaveBeenCalledWith(expect.objectContaining({
      appKey: 'app',
      environment: 'Staging',
      enableTelemetry: true,
      metricsBaseUrl: 'https://metrics.example/base',
      telemetryFlushIntervalMs: 30_000,
    }));
    expect(telemetry.reporter.recordCheck.mock.calls).toEqual([
      ['Enabled', 'enabled'],
      ['Disabled', 'disabled'],
      ['Gated', 'disabled'],
    ]);
  });

  it('forwards explicit APIs with independent category opt-outs', async () => {
    installBrowserGlobals();
    const usageDisabled = createBrowserClient({
      appKey: 'usage-off',
      fetch: vi.fn(),
      enableUsageTracking: false,
    });
    usageDisabled.recordUsage('A');
    usageDisabled.recordView('A', 'blue');
    usageDisabled.incrementCounter('clicks', 2);
    usageDisabled.setGauge('depth', 3);
    await usageDisabled.flushTelemetry();

    expect(telemetry.reporter.recordUsage).not.toHaveBeenCalled();
    expect(telemetry.reporter.recordView).not.toHaveBeenCalled();
    expect(telemetry.reporter.incrementCounter).toHaveBeenCalledWith('clicks', 2);
    expect(telemetry.reporter.setGauge).toHaveBeenCalledWith('depth', 3);
    expect(telemetry.reporter.flush).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    telemetry.createTelemetryReporter.mockReturnValue(telemetry.reporter);
    telemetry.attachBrowserLifecycle.mockReturnValue(telemetry.detach);
    const metricsDisabled = createBrowserClient({
      appKey: 'metrics-off',
      fetch: vi.fn(),
      enableMetrics: false,
    });
    metricsDisabled.recordUsage('B');
    metricsDisabled.recordView('B', 'green');
    metricsDisabled.incrementCounter('ignored');
    metricsDisabled.setGauge('ignored', 1);

    expect(telemetry.reporter.recordUsage).toHaveBeenCalledWith('B', undefined);
    expect(telemetry.reporter.recordView).toHaveBeenCalledWith('B', 'green');
    expect(telemetry.reporter.incrementCounter).not.toHaveBeenCalled();
    expect(telemetry.reporter.setGauge).not.toHaveBeenCalled();
  });

  it.each([
    { appKey: undefined, enableTelemetry: true },
    { appKey: 'app', enableTelemetry: false },
    { appKey: 'app', enableTelemetry: true, enableUsageTracking: false, enableMetrics: false },
  ])('does not create resources for disabled configuration %#', (options) => {
    installBrowserGlobals();
    createBrowserClient({ ...options, fetch: vi.fn() });
    expect(telemetry.createTelemetryReporter).not.toHaveBeenCalled();
    expect(telemetry.attachBrowserLifecycle).not.toHaveBeenCalled();
  });

  it('contains reporter failures so boolean evaluation is unchanged', async () => {
    installBrowserGlobals();
    telemetry.createTelemetryReporter.mockImplementationOnce(() => {
      throw new Error('reporter setup failed');
    });
    const client = createBrowserClient({
      appKey: 'app',
      fetch: vi.fn().mockResolvedValue(response({ Enabled: true })),
    });
    await expect(client.getFlag('Enabled')).resolves.toBe(true);

    telemetry.createTelemetryReporter.mockReturnValue(telemetry.reporter);
    telemetry.reporter.recordCheck.mockImplementationOnce(() => {
      throw new Error('record failed');
    });
    const second = createBrowserClient({
      appKey: 'app-2',
      fetch: vi.fn().mockResolvedValue(response({ Enabled: true })),
    });
    await expect(second.getFlag('Enabled')).resolves.toBe(true);
  });

  it('disposes a reporter when browser lifecycle attachment fails', async () => {
    installBrowserGlobals();
    telemetry.attachBrowserLifecycle.mockImplementationOnce(() => {
      throw new Error('listener setup failed');
    });
    const client = createBrowserClient({
      appKey: 'app',
      fetch: vi.fn().mockResolvedValue(response({ Enabled: true })),
    });

    await expect(client.getFlag('Enabled')).resolves.toBe(true);
    expect(telemetry.reporter.dispose).toHaveBeenCalledTimes(1);
    expect(telemetry.reporter.recordCheck).not.toHaveBeenCalled();
  });

  it('disposes browser lifecycle, reporter, websocket, and in-flight definition work once', async () => {
    installBrowserGlobals();
    let aborted = false;
    const fetch = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        aborted = true;
        reject(new DOMException('aborted', 'AbortError'));
      });
    }));
    const close = vi.fn();
    class FakeWebSocket {
      onopen: (() => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      onclose: (() => void) | null = null;
      close = close;
    }
    vi.stubGlobal('WebSocket', FakeWebSocket);

    const client = createBrowserClient({ appKey: 'app', fetch, flagDefaults: { Fallback: true } });
    client.startWebSocket();
    const pending = client.getFlags();
    client.dispose();
    client.dispose();

    await expect(pending).resolves.toEqual({ Fallback: true });
    await expect(client.getFlags()).resolves.toEqual({ Fallback: true });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(aborted).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
    expect(telemetry.detach).toHaveBeenCalledTimes(1);
    expect(telemetry.reporter.dispose).toHaveBeenCalledTimes(1);
  });

  it('prefers minted instanceId on telemetry and definitions and suppresses client context', async () => {
    installBrowserGlobals();
    const fetch = vi.fn().mockResolvedValue(response({ Enabled: true }));
    const client = createBrowserClient({
      appKey: 'app',
      identity: 'alice',
      groups: ['beta'],
      claims: { plan: 'pro' },
      instanceId: ' mint-token ',
      fetch,
    });

    await client.getFlags();
    const url = new URL(String(fetch.mock.calls[0]?.[0]));
    expect(url.searchParams.get('i')).toBe('mint-token');
    expect(url.searchParams.get('u')).toBeNull();
    expect(url.searchParams.getAll('g')).toEqual([]);
    expect(url.searchParams.get('claim.plan')).toBeNull();
    expect(telemetry.createTelemetryReporter).toHaveBeenCalledWith(expect.objectContaining({
      instanceId: 'mint-token',
      identity: 'alice',
    }));
  });

  it('sends client identity as telemetry u when instanceId is absent', async () => {
    installBrowserGlobals();
    createBrowserClient({
      appKey: 'app',
      identity: 'alice',
      fetch: vi.fn().mockResolvedValue(response({ Enabled: true })),
    });
    expect(telemetry.createTelemetryReporter).toHaveBeenCalledWith(expect.objectContaining({
      instanceId: undefined,
      identity: 'alice',
    }));
  });

  it('setContext replaces minted i, keeps admitted events on the previous owner, and does not restore the prior cache', async () => {
    installBrowserGlobals();
    const fetch = vi.fn()
      .mockResolvedValueOnce(response({ Flag: true }))
      .mockResolvedValueOnce(response({ Flag: false }))
      .mockResolvedValueOnce(response({ Flag: true }));
    const client = createBrowserClient({
      appKey: 'app',
      instanceId: 'token-a',
      fetch,
      featureFlagsRefreshInterval: 60_000,
    });

    await expect(client.getFlag('Flag')).resolves.toBe(true);
    await client.setContext({ instanceId: 'token-b' });
    await expect(client.getFlag('Flag')).resolves.toBe(false);
    await client.setContext({ instanceId: 'token-a' });
    await expect(client.getFlag('Flag')).resolves.toBe(true);

    expect(fetch.mock.calls.map((call) => new URL(String(call[0])).searchParams.get('i'))).toEqual([
      'token-a',
      'token-b',
      'token-a',
    ]);
    expect(telemetry.reporter.setContext).toHaveBeenCalledWith({ instanceId: 'token-b', identity: '' });
    expect(telemetry.reporter.setContext).toHaveBeenCalledWith({ instanceId: 'token-a', identity: '' });
  });

  it('dispose({ flush: false }) discards the reporter without a final envelope', () => {
    installBrowserGlobals();
    const client = createBrowserClient({ appKey: 'app', fetch: vi.fn() });
    client.dispose({ flush: false });
    expect(telemetry.reporter.dispose).toHaveBeenCalledWith({ flush: false });
  });
});
