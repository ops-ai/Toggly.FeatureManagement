import { afterEach, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { createToggly } from '../src/index.js';
import type { TogglySnapshot } from '../src/types.js';
const initial: TogglySnapshot = {
  definitions: { A: true, B: true },
  context: { identity: 'alice' },
  expose: ['A', 'B'],
};
type Envelope = {
  i?: string;
  u?: string;
  f?: Record<string, Record<string, number[]>>;
  m?: Record<string, number>;
};
const owners: ReturnType<typeof createToggly>[] = [];
function setup() {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
  vi.stubGlobal('CompressionStream', undefined);
  vi.stubGlobal('WebSocket', undefined);
  const envelopes: Envelope[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('telemetry')) {
        envelopes.push(JSON.parse(String(init?.body)));
        return new Response(null, { status: 202 });
      }
      return new Response(null, { status: 503 });
    }),
  );
  return envelopes;
}
afterEach(async () => {
  for (const owner of owners.splice(0)) {
    await owner.flushTelemetry();
    owner.dispose();
  }
  vi.unstubAllGlobals();
});
it('uses initial token convenience once, then update owns token replacement and clearing', async () => {
  const envelopes = setup();
  const t = createToggly(initial, { appKey: 'app', instanceId: '  token-a  ' });
  owners.push(t);
  t.recordUsage('A');
  t.update({ ...initial, context: { identity: 'bob', instanceId: 'token-b' } });
  t.recordView('B');
  t.update({ ...initial, context: { identity: 'carol' } });
  t.incrementCounter('counter');
  t.update({ ...initial, context: { identity: 'dave', instanceId: '   ' } });
  t.setGauge('gauge', 4);
  await t.flushTelemetry();
  expect(envelopes.map((e) => [e.i, e.u])).toEqual([
    ['token-a', undefined],
    ['token-b', undefined],
    [undefined, 'carol'],
    [undefined, 'dave'],
  ]);
  expect(get(t).context.instanceId).toBeUndefined();
});
it('captures definitions and attribution once before a gate callback updates the owner', async () => {
  const envelopes = setup();
  let changed = false;
  const t = createToggly(initial, {
    appKey: 'app',
    localGates: [
      {
        id: 'transition',
        flagKeys: ['A'],
        isEnabled: () => {
          if (!changed) {
            changed = true;
            t.update({
              definitions: { A: false, B: false },
              context: { identity: 'bob' },
              expose: ['A', 'B'],
            });
          }
          return true;
        },
      },
    ],
  });
  owners.push(t);
  expect(t.gate(['A', 'B'])).toBe(true);
  t.recordUsage('New');
  await t.flushTelemetry();
  expect(Object.assign({}, ...envelopes.filter((e) => e.u === 'alice').map((e) => e.f))).toEqual({
    A: { enabled: [1] },
    B: { enabled: [1] },
  });
  expect(envelopes.find((e) => e.u === 'bob')?.f).toEqual({ New: { enabled: [0, 1] } });
  expect(get(t).definitions).toEqual({ A: false, B: false });
});
it('keeps route reconnects and unused hydration silent while retaining the same context queue', async () => {
  const envelopes = setup();
  const t = createToggly(initial, { appKey: 'app', refreshInterval: 0 });
  owners.push(t);
  t.recordUsage('Queued');
  await t.start();
  t.update(initial);
  await t.start();
  get(t);
  t.notifyLocalGatesChanged();
  await t.flushTelemetry();
  expect(envelopes).toEqual([
    { k: 'app', e: 'Production', u: 'alice', f: { Queued: { enabled: [0, 1] } } },
  ]);
});

it('lets an explicit blank initial snapshot token override the initial option', async () => {
  const envelopes = setup();
  const t = createToggly(
    { ...initial, context: { identity: 'alice', instanceId: ' ' } },
    { appKey: 'app', instanceId: 'ignored' },
  );
  owners.push(t);
  t.recordUsage('A');
  await t.flushTelemetry();
  expect(envelopes[0]).toMatchObject({ u: 'alice' });
  expect(envelopes[0].i).toBeUndefined();
});
it('captures local callbacks, selected keys and publicly mutable nested definitions before reentry', async () => {
  const envelopes = setup();
  const keys = ['A', 'B'];
  const later = { id: 'later', flagKeys: ['B'], isEnabled: () => true };
  const t = createToggly(
    {
      ...initial,
      definitions: {
        A: true,
        B: {
          requirement: 'all',
          rules: [{ property: 'Vip', op: 'eq', value: 'true', type: 'boolean' }],
        },
      },
    },
    {
      appKey: 'app',
      localGates: [
        {
          id: 'first',
          flagKeys: ['A'],
          isEnabled: () => {
            later.isEnabled = () => false;
            keys[1] = 'Injected';
            (get(t).definitions.B as any).rules[0].value = 'false';
            t.update({ ...initial, context: { identity: 'bob' } });
            return true;
          },
        },
        later,
      ],
    },
  );
  owners.push(t);
  expect(t.gate(keys, { entity: { kind: 'Order', key: '1', attributes: { Vip: true } } })).toBe(
    true,
  );
  await t.flushTelemetry();
  expect(envelopes.every((e) => e.u === 'alice' && e.i === undefined)).toBe(true);
  expect(Object.assign({}, ...envelopes.map((e) => e.f))).toEqual({
    A: { enabled: [1] },
    B: { enabled: [1] },
  });
});
it('shares the admission bound across 2200 context updates and recovers after flushing', async () => {
  const envelopes = setup();
  const t = createToggly(initial, { appKey: 'app' });
  owners.push(t);
  const started = performance.now();
  for (let i = 0; i < 2200; i++) {
    t.update({ ...initial, context: { instanceId: `token-${i}` } });
    t.recordUsage('A');
  }
  const admitted = performance.now();
  await t.flushTelemetry();
  expect(envelopes).toHaveLength(2000);
  expect(envelopes[0].i).toBe('token-0');
  expect(envelopes.at(-1)?.i).toBe('token-1999');
  expect(
    envelopes.reduce((sum, value) => sum + Buffer.byteLength(JSON.stringify(value)), 0),
  ).toBeLessThanOrEqual(256 * 1024);
  t.recordUsage('Recovered');
  await t.flushTelemetry();
  expect(envelopes.at(-1)).toMatchObject({
    i: 'token-2199',
    f: { Recovered: { enabled: [0, 1] } },
  });
  console.log('SVELTEKIT_ADMISSION_TIMING', {
    admissionMs: admitted - started,
    totalMs: performance.now() - started,
  });
  // Full admission is CPU-bound under coverage; retain every transition and a bounded allowance.
}, 15000);

it('preserves arbitrary entity attributes and captures ownership before custom value conversion', async () => {
  const envelopes = setup();
  const t = createToggly(
    {
      ...initial,
      definitions: {
        A: { requirement: 'all', rules: [{ property: 'Vip', op: 'eq', value: 'true' }] },
        B: true,
      },
    },
    { appKey: 'app' },
  );
  owners.push(t);
  const entity = {
    kind: 'Order',
    key: '1',
    attributes: {
      unused: () => false,
      Vip: {
        toString() {
          t.update({
            ...initial,
            context: { identity: 'bob' },
            definitions: { A: false, B: false },
          });
          return 'true';
        },
      },
    },
  };
  expect(t.gate(['A', 'B'], { entity })).toBe(true);
  await t.flushTelemetry();
  expect(envelopes.every((e) => e.u === 'alice')).toBe(true);
  expect(Object.assign({}, ...envelopes.map((e) => e.f))).toEqual({
    A: { enabled: [1] },
    B: { enabled: [1] },
  });
  expect(t.isEnabled('B')).toBe(false);
});
