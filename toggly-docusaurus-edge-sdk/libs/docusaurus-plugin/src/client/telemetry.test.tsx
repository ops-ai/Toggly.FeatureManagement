// @vitest-environment jsdom
import React, { StrictMode, Suspense } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { waitFor } from '@testing-library/react';
import { Feature, TogglyProvider, useFlag, useToggly, type TogglyContextValue } from './index';
import { createTogglyClient } from '../lib/toggly-client';

afterEach(async () => {
  cleanup();
  await Promise.resolve();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete (window as any).__TOGGLY_EDGE_FLAGS__;
});
function collector() {
  vi.stubGlobal('CompressionStream', undefined);
  vi.stubGlobal('WebSocket', undefined);
  const bodies: any[] = [];
  const requests: any[] = [];
  const telemetryFetch = async (url: string, init: any) => {
    requests.push({ url, ...init });
    bodies.push(JSON.parse(init.body));
    return { status: 202 };
  };
  return { bodies, requests, telemetryFetch };
}
it('counts cached direct checks and explicit variants without leaking targeting', async () => {
  const c = collector();
  const client = createTogglyClient({
    appKey: 'app',
    environment: 'QA',
    identity: 'private',
    telemetryFetch: c.telemetryFetch,
    metricsBaseUrl: 'https://metrics.test/base',
    fetch: async () => new Response('{"on":true,"off":false}'),
  });
  await client.getFlags();
  expect(c.bodies).toEqual([]);
  expect(await client.getFlag('on')).toBe(true);
  expect(await client.getFlag('on')).toBe(true);
  expect(await client.getFlag('missing', true)).toBe(true);
  client.recordUsage('on', 'control');
  client.recordView('on');
  client.incrementCounter('orders', 2);
  client.setGauge('cart', 3);
  await client.flushTelemetry();
  expect(c.bodies).toEqual([
    {
      k: 'app',
      e: 'QA',
      f: { on: { enabled: [2, 0, 1], control: [0, 1] }, missing: { enabled: [1] } },
      m: { orders: 2, cart: 3 },
    },
  ]);
  expect(c.requests[0].url).toBe('https://metrics.test/base/api/frontend/telemetry');
  client.dispose();
});
it('shares an owner across cached hooks, negation and StrictMode replay without render counts', async () => {
  const c = collector();
  let context!: TogglyContextValue;
  const Reader = () => {
    context = useToggly();
    const flag = useFlag('on');
    return <span>{String(flag.enabled)}</span>;
  };
  const config = {
    appKey: 'app',
    telemetryFetch: c.telemetryFetch,
    fetch: async () => new Response('{"on":true,"off":false}'),
  };
  const tree = () => (
    <StrictMode>
      <TogglyProvider config={config}>
        <Reader />
        <Feature flag="off" negate>
          off
        </Feature>
      </TogglyProvider>
    </StrictMode>
  );
  const host = render(tree());
  await act(async () => {
    await Promise.resolve();
  });
  await context.flushTelemetry();
  expect(c.bodies[0].f).toEqual({ on: { enabled: [1] }, off: { disabled: [1] } });
  host.rerender(tree());
  await context.flushTelemetry();
  expect(c.bodies).toHaveLength(1);
  context.recordUsage('last');
  host.unmount();
  await act(async () => {
    await Promise.resolve();
  });
  expect(c.bodies[1].f).toEqual({ last: { enabled: [0, 1] } });
  context.recordView('late');
  await context.flushTelemetry();
  expect(c.bodies).toHaveLength(2);
});
it('replaces provider app/environment without carrying old snapshots or late completion', async () => {
  const c = collector();
  let context!: TogglyContextValue;
  let finish!: (r: Response) => void;
  (window as any).__TOGGLY_EDGE_FLAGS__ = { on: true };
  const Reader = () => {
    context = useToggly();
    useFlag('on');
    return null;
  };
  const host = render(
    <TogglyProvider
      config={{
        appKey: 'old',
        environment: 'Old',
        telemetryFetch: c.telemetryFetch,
        fetch: () =>
          new Promise((r) => {
            finish = r;
          }),
      }}
    >
      <Reader />
    </TogglyProvider>
  );
  context.recordUsage('queued');
  host.rerender(
    <TogglyProvider
      config={{
        appKey: 'new',
        environment: 'New',
        telemetryFetch: c.telemetryFetch,
        fetch: async () => new Response('{"on":false}'),
      }}
    >
      <Reader />
    </TogglyProvider>
  );
  await act(async () => {
    finish(new Response('{"on":true}'));
    await Promise.resolve();
  });
  await context.flushTelemetry();
  expect(c.bodies.find((b) => b.k === 'old').f).toEqual({
    on: { enabled: [1] },
    queued: { enabled: [0, 1] },
  });
  expect(c.bodies.find((b) => b.k === 'new').f).toEqual({ on: { disabled: [1] } });
});
it('keeps static browser evaluations and explicit events while making no definitions request', async () => {
  const c = collector();
  let context!: TogglyContextValue;
  const fetch = vi.fn();
  vi.stubGlobal('__TOGGLY_STATIC_GATING__', true);
  vi.stubGlobal('__TOGGLY_BUILD_FLAGS__', { on: true, off: false });
  const Reader = () => {
    context = useToggly();
    useFlag('on');
    return null;
  };
  render(
    <TogglyProvider config={{ appKey: 'static', telemetryFetch: c.telemetryFetch, fetch }}>
      <Reader />
      <Feature flag="off" negate>
        off
      </Feature>
    </TogglyProvider>
  );
  await act(async () => {
    await Promise.resolve();
  });
  context.recordView('page');
  await context.flushTelemetry();
  expect(c.bodies[0].f).toEqual({
    on: { enabled: [1] },
    off: { disabled: [1] },
    page: { enabled: [0, 0, 1] },
  });
  expect(fetch).not.toHaveBeenCalled();
});
it('never starts work for a suspended uncommitted provider', async () => {
  vi.useFakeTimers();
  const c = collector();
  const fetch = vi.fn();
  const Suspend = () => {
    useFlag('on');
    throw new Promise(() => {});
  };
  const host = render(
    <Suspense fallback="waiting">
      <TogglyProvider config={{ appKey: 'app', fetch, telemetryFetch: c.telemetryFetch }}>
        <Suspend />
      </TogglyProvider>
    </Suspense>
  );
  host.unmount();
  await Promise.resolve();
  expect(c.bodies).toEqual([]);
  expect(fetch).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
it.each([{ enableTelemetry: false }, { appKey: '' }])(
  'does not start disabled telemetry %j',
  async (extra) => {
    vi.useFakeTimers();
    const c = collector();
    const client = createTogglyClient({
      appKey: 'app',
      telemetryFetch: c.telemetryFetch,
      ...extra,
      fetch: async () => new Response('{}'),
    });
    client.recordView('x');
    await client.flushTelemetry();
    client.dispose();
    expect(c.bodies).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  }
);
it('counts only mapped navbar leaves and releases its short-lived owner', async () => {
  const c = collector();
  vi.stubGlobal('__TOGGLY_PAGE_FEATURES__', { '/on': 'on', '/off': 'off' });
  vi.stubGlobal('__TOGGLY_CONFIG__', {
    appKey: 'nav',
    telemetryFetch: c.telemetryFetch,
    fetch: async () => new Response('{"on":true,"off":false}'),
  });
  document.body.innerHTML =
    '<div><a class="navbar__link" href="/on">on</a><a class="navbar__link" href="/off">off</a><a class="navbar__link" href="/other">other</a></div>';
  const navigation = await import('./nav-gate');
  document.dispatchEvent(new Event('DOMContentLoaded'));
  await waitFor(() => expect(document.querySelector('[href="/off"]')).toBeNull());
  await waitFor(() => expect(c.bodies).toHaveLength(1));
  expect(c.bodies[0].f).toEqual({ on: { enabled: [1] }, off: { disabled: [1] } });
  expect(c.requests[0].keepalive).toBe(true);
  document.body.innerHTML = '<div><a class="menu__link" href="/off">new route</a></div>';
  navigation.onRouteDidUpdate();
  await waitFor(() => expect(c.bodies).toHaveLength(2));
  expect(c.bodies[1].f).toEqual({ off: { disabled: [1] } });
});
it('keeps simultaneous provider owners independent through unmount', async () => {
  const c = collector();
  let first!: TogglyContextValue;
  let second!: TogglyContextValue;
  const Reader = ({ assign }: { assign: (value: TogglyContextValue) => void }) => {
    assign(useToggly());
    useFlag('on');
    return null;
  };
  const one = render(
    <TogglyProvider
      config={{
        appKey: 'one',
        telemetryFetch: c.telemetryFetch,
        fetch: async () => new Response('{"on":true}'),
      }}
    >
      <Reader
        assign={(value) => {
          first = value;
        }}
      />
    </TogglyProvider>
  );
  render(
    <TogglyProvider
      config={{
        appKey: 'two',
        telemetryFetch: c.telemetryFetch,
        fetch: async () => new Response('{"on":false}'),
      }}
    >
      <Reader
        assign={(value) => {
          second = value;
        }}
      />
    </TogglyProvider>
  );
  await act(async () => {
    await Promise.resolve();
  });
  await first.flushTelemetry();
  await second.flushTelemetry();
  expect(c.bodies.map((b) => b.f)).toEqual([{ on: { enabled: [1] } }, { on: { disabled: [1] } }]);
  one.unmount();
  await Promise.resolve();
  second.recordUsage('alive');
  await second.flushTelemetry();
  expect(c.bodies[2].k).toBe('two');
});
it('does not attribute a prior application baked snapshot to a replacement static owner', async () => {
  const c = collector();
  vi.stubGlobal('__TOGGLY_STATIC_GATING__', true);
  vi.stubGlobal('__TOGGLY_BUILD_FLAGS__', { on: true });
  let context!: TogglyContextValue;
  const Reader = () => {
    context = useToggly();
    return <Feature flag="on">old content</Feature>;
  };
  const host = render(
    <TogglyProvider config={{ appKey: 'old', telemetryFetch: c.telemetryFetch }}>
      <Reader />
    </TogglyProvider>
  );
  await context.flushTelemetry();
  host.rerender(
    <TogglyProvider
      config={{ appKey: 'new', telemetryFetch: c.telemetryFetch, flagDefaults: { on: false } }}
    >
      <Reader />
    </TogglyProvider>
  );
  await context.flushTelemetry();
  expect(host.queryByText('old content')).toBeNull();
  expect(c.bodies.find((packet) => packet.k === 'new').f).toEqual({ on: { disabled: [1] } });
});

it('disposes pending definitions and remains silent in SSR', async () => {
  vi.useFakeTimers();
  const c = collector();
  let finish!: (r: Response) => void;
  let signal!: AbortSignal;
  const client = createTogglyClient({
    appKey: 'app',
    telemetryFetch: c.telemetryFetch,
    fetch: (_url, init) => {
      signal = init!.signal!;
      return new Promise((r) => {
        finish = r;
      });
    },
  });
  const pending = client.getFlags();
  client.dispose();
  expect(signal.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
  finish(new Response('{"late":true}'));
  await pending;
  expect(await client.getFlags()).toEqual({});
  vi.stubGlobal('window', undefined);
  const server = createTogglyClient({ appKey: 'app', telemetryFetch: c.telemetryFetch });
  server.startTelemetry();
  server.recordView('ssr');
  await server.flushTelemetry();
  server.dispose();
  expect(c.bodies).toEqual([]);
});
