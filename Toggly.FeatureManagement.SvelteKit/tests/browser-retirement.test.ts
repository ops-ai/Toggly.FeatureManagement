import { afterEach, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { createToggly } from '../src/index.js';

let owner: ReturnType<typeof createToggly> | undefined;
afterEach(() => {
  owner?.dispose();
  owner = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it.each(
  ['fetch', 'onError'].flatMap((source) => ['dispose', 'update'].map((mode) => ({ source, mode }))),
)(
  'retires the entering connection after synchronous $source $mode reentry',
  async ({ source, mode }) => {
    vi.useFakeTimers();
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
    vi.stubGlobal('CompressionStream', undefined);
    const packets: any[] = [];
    const requests: { url: URL; signal: AbortSignal }[] = [];
    const sockets: { close: ReturnType<typeof vi.fn> }[] = [];
    let reentered = false;
    const reenter = () => {
      if (reentered) return;
      reentered = true;
      if (mode === 'dispose') owner!.dispose();
      else
        owner!.update({ definitions: { On: false }, context: { identity: 'bob' }, expose: ['On'] });
    };
    vi.stubGlobal(
      'fetch',
      vi.fn((input, init) => {
        const url = new URL(String(input));
        if (url.pathname.includes('/api/frontend/telemetry')) {
          packets.push(JSON.parse(String(init?.body)));
          return Promise.resolve(new Response(null, { status: 202 }));
        }
        requests.push({ url, signal: init!.signal as AbortSignal });
        if (source === 'fetch') reenter();
        return new Promise<Response>(() => {});
      }),
    );
    vi.stubGlobal(
      'WebSocket',
      class {
        close = vi.fn();
        constructor() {
          if (source === 'onError' && !reentered) throw new Error('synchronous connection error');
          sockets.push(this);
        }
      },
    );
    owner = createToggly(
      { definitions: { On: true }, context: { identity: 'alice' }, expose: ['On'] },
      {
        appKey: 'front',
        refreshInterval: 100000,
        timeout: 100000,
        onError: () => {
          if (source === 'onError') reenter();
        },
      },
    );
    owner.recordUsage('Before');
    await owner.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(reentered).toBe(true);
    expect(requests[0].signal.aborted).toBe(true);
    if (mode === 'update') {
      expect(requests).toHaveLength(2);
      expect(requests[1].url.searchParams.get('u')).toBe('bob');
      expect(requests[1].signal.aborted).toBe(false);
      expect(get(owner).definitions).toEqual({ On: false });
      expect(sockets.filter((socket) => socket.close.mock.calls.length === 0)).toHaveLength(1);
      expect(packets).toEqual([]); // Route replacement retains the owner's original queue.
      owner.recordUsage('After');
      await owner.flushTelemetry();
      expect(packets.map((packet) => [packet.u, packet.f])).toEqual([
        ['alice', { Before: { enabled: [0, 1] } }],
        ['bob', { After: { enabled: [0, 1] } }],
      ]);
      expect(vi.getTimerCount()).toBe(3); // Bob's request/poll plus the one layout reporter scheduler.
    } else {
      expect(requests).toHaveLength(1);
      await owner.flushTelemetry();
      expect(packets).toEqual([
        { k: 'front', e: 'Production', u: 'alice', f: { Before: { enabled: [0, 1] } } },
      ]);
    }
    owner.dispose();
    owner.dispose();
    expect(requests.every((request) => request.signal.aborted)).toBe(true);
    expect(sockets.every((socket) => socket.close.mock.calls.length === 1)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    const count = requests.length;
    await owner.start();
    await vi.advanceTimersByTimeAsync(200000);
    expect(requests).toHaveLength(count);
  },
);
