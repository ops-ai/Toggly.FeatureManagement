import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render } from '@solidjs/testing-library';
import { createSignal, Show } from 'solid-js';
import {
  createClient,
  Feature,
  TogglyProvider,
  useFeatureFlag,
  useToggly,
  type Toggly,
} from '../src';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function collector() {
  const bodies: any[] = [];
  const requests: any[] = [];
  const telemetryFetch = async (url: string, init: any) => {
    requests.push({ url, ...init });
    bodies.push(JSON.parse(init.body));
    return { status: 202 };
  };
  vi.stubGlobal('CompressionStream', undefined);
  return { bodies, requests, telemetryFetch };
}
const snapshot = (on = true) => ({
  definitions: { on, off: false },
  expose: ['on', 'off'],
  context: {},
  source: 'signed' as const,
});
it('records only effective short-circuited leaves and explicit compact events without identity', async () => {
  const c = collector();
  const client = createClient(
    {
      appKey: 'app',
      environment: 'QA',
      identity: 'private',
      metricsBaseUrl: 'https://collector.test/base',
      telemetryFetch: c.telemetryFetch,
    },
    snapshot(),
  );
  expect(client.evaluate(['on', 'off'], 'any')).toBe(true);
  expect(client.evaluate(['off', 'on'], 'all', true)).toBe(true);
  client.setLocalGates([{ id: 'device', flagKeys: ['on'], isEnabled: () => false }]);
  expect(client.evaluate(['on'])).toBe(false);
  client.recordUsage('on', 'control');
  client.recordView('on');
  client.incrementCounter('orders', 2);
  client.incrementCounter('orders');
  client.setGauge('cart', 3);
  await client.flushTelemetry();
  expect(c.bodies).toEqual([
    {
      k: 'app',
      e: 'QA',
      f: { on: { enabled: [1, 0, 1], disabled: [1], control: [0, 1] }, off: { disabled: [1] } },
      m: { orders: 3, cart: 3 },
    },
  ]);
  expect(c.requests[0].url).toBe('https://collector.test/base/api/frontend/telemetry');
  expect(c.requests[0].credentials).toBe('omit');
  client.dispose();
});
it('memoizes UI checks and ignores loading/error projection while counting changed gates', async () => {
  const c = collector();
  let t!: Toggly;
  let read!: () => boolean;
  const View = () => {
    t = useToggly();
    read = useFeatureFlag('on');
    return <span>{String(read())}</span>;
  };
  const host = render(() => (
    <TogglyProvider
      config={{
        appKey: 'app',
        telemetryFetch: c.telemetryFetch,
        fetch: async () => new Response(null, { status: 304 }),
        refreshInterval: 0,
        enableLiveUpdates: false,
      }}
      snapshot={snapshot()}
    >
      <View />
      <Feature feature="off" negate>
        off
      </Feature>
    </TogglyProvider>
  ));
  await t.client.refresh();
  read();
  read();
  t.flags();
  await t.flushTelemetry();
  expect(c.bodies[0].f).toEqual({ on: { enabled: [1] }, off: { disabled: [1] } });
  t.client.setLocalGates([{ id: 'device', flagKeys: ['on'], isEnabled: () => false }]);
  expect(read()).toBe(false);
  await t.flushTelemetry();
  expect(c.bodies[1].f).toEqual({ on: { disabled: [1] }, off: { disabled: [1] } });
  t.recordUsage('explicit');
  host.unmount();
  await Promise.resolve();
  expect(c.bodies.at(-1).f).toEqual({ explicit: { enabled: [0, 1] } });
  t.recordView('late');
  await t.flushTelemetry();
  expect(c.bodies).toHaveLength(3);
});
it('isolates remounted provider owners and never adopts a late disposed response', async () => {
  const c = collector();
  let old!: Toggly;
  let current!: Toggly;
  let finish!: (r: Response) => void;
  const pending = new Promise<Response>((r) => {
    finish = r;
  });
  const [owner, change] = createSignal('old');
  const View = () => {
    current = useToggly();
    const flag = useFeatureFlag('on');
    return <span>{String(flag())}</span>;
  };
  render(() => (
    <Show when={owner()} keyed>
      {(key) => (
        <TogglyProvider
          snapshot={snapshot(key === 'old')}
          config={{
            appKey: key,
            environment: key,
            telemetryFetch: c.telemetryFetch,
            refreshInterval: 0,
            enableLiveUpdates: false,
            verifySignatures: false,
            fetch: () =>
              key === 'old' ? pending : Promise.resolve(new Response(null, { status: 304 })),
          }}
        >
          <View />
        </TogglyProvider>
      )}
    </Show>
  ));
  old = current;
  old.recordUsage('queued');
  change('new');
  finish(new Response('{"on":true}'));
  await pending;
  await Promise.resolve();
  await current.flushTelemetry();
  expect(c.bodies.find((b) => b.k === 'old').f).toEqual({
    on: { enabled: [1] },
    queued: { enabled: [0, 1] },
  });
  expect(c.bodies.find((b) => b.k === 'new').f).toEqual({ on: { disabled: [1] } });
  expect(current.client.flags().on).toBe(false);
});
it.each([{ enableTelemetry: false }, { appKey: '' }])(
  'does not allocate disabled telemetry %j',
  async (overrides) => {
    vi.useFakeTimers();
    const c = collector();
    const client = createClient(
      { appKey: 'app', telemetryFetch: c.telemetryFetch, ...overrides },
      snapshot(),
    );
    client.evaluate(['on']);
    client.recordView('on');
    client.incrementCounter('x');
    await client.flushTelemetry();
    client.dispose();
    expect(c.bodies).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  },
);
it('releases pending request timeout and telemetry lifecycle on synchronous disposal', async () => {
  vi.useFakeTimers();
  const c = collector();
  let finish!: (r: Response) => void;
  const client = createClient({
    appKey: 'app',
    telemetryFetch: c.telemetryFetch,
    verifySignatures: false,
    fetch: () =>
      new Promise((r) => {
        finish = r;
      }),
  });
  const pending = client.refresh();
  client.recordView('last');
  client.dispose();
  await vi.advanceTimersByTimeAsync(0);
  expect(c.bodies[0].f.last.enabled).toEqual([0, 0, 1]);
  expect(c.requests[0].keepalive).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
  finish(new Response('{"late":true}'));
  await pending;
  expect(client.flags()).toEqual({});
  expect(vi.getTimerCount()).toBe(0);
  window.dispatchEvent(new Event('pagehide'));
  expect(c.bodies).toHaveLength(1);
});
it('counts entity denial before negation and preserves sibling clients through lifecycle', async () => {
  const c = collector();
  const options = { appKey: 'app', telemetryFetch: c.telemetryFetch, flagDefaults: { on: true } };
  const one = createClient(options);
  const two = createClient({ ...options, environment: 'Other' });
  one.hydrate({
    definitions: {
      entity: {
        requirement: 'all',
        rules: [{ property: 'Vip', op: 'eq', value: 'true', type: 'boolean' }],
      },
    },
    expose: ['entity'],
    context: {},
    source: 'signed',
  });
  expect(one.evaluate(['entity'], 'all', true)).toBe(true);
  expect(
    one.evaluate(['entity'], 'all', false, {
      kind: 'Order',
      key: 'private',
      attributes: { Vip: true },
    }),
  ).toBe(true);
  await one.flushTelemetry();
  expect(c.bodies[0].f).toEqual({ entity: { disabled: [1], enabled: [1] } });
  one.dispose();
  two.recordUsage('alive');
  window.dispatchEvent(new Event('pagehide'));
  await Promise.resolve();
  await Promise.resolve();
  expect(c.bodies[1]).toEqual({ k: 'app', e: 'Other', f: { alive: { enabled: [0, 1] } } });
  expect(c.requests[1].keepalive).toBe(true);
  two.dispose();
});
it('keeps invalid telemetry configuration and throwing diagnostics out of evaluation', async () => {
  const c = collector();
  const client = createClient(
    {
      appKey: 'app',
      telemetryFetch: c.telemetryFetch,
      metricsBaseUrl: 'https://metrics.test/?',
      telemetryFlushIntervalMs: 1,
      onTelemetryDiagnostic: () => {
        throw new Error('observer');
      },
    },
    snapshot(),
  );
  expect(client.evaluate(['on'])).toBe(true);
  await client.flushTelemetry();
  client.dispose();
  expect(c.bodies).toEqual([]);
});
it('does not create browser resources in a server runtime', async () => {
  vi.useFakeTimers();
  const c = collector();
  vi.stubGlobal('window', undefined);
  vi.stubGlobal('document', undefined);
  const client = createClient({ appKey: 'app', telemetryFetch: c.telemetryFetch }, snapshot());
  client.start();
  client.evaluate(['on']);
  client.recordView('on');
  await client.flushTelemetry();
  client.dispose();
  expect(c.bodies).toEqual([]);
  expect(vi.getTimerCount()).toBe(0);
});
