import { afterEach, expect, it, vi } from 'vitest';
import { isServer, renderToString } from 'solid-js/web';
import {
  createToggly,
  TogglyProvider,
  useFeatureFlags,
  useToggly,
  type Toggly,
  type TogglySnapshot,
} from '../src';

afterEach(() => vi.restoreAllMocks());

const signed: TogglySnapshot = {
  definitions: { On: true, Hidden: true },
  context: { instanceId: 'current' },
  expose: ['On'],
  source: 'signed',
};

for (const provider of [false, true]) {
  it.each([
    { name: 'accepted signed snapshot', snapshot: signed, expected: true },
    { name: 'configured defaults', snapshot: undefined, expected: false },
    {
      name: 'defaults after a mismatched token snapshot',
      snapshot: { ...signed, context: { instanceId: 'retired' } },
      expected: false,
    },
  ])(
    `renders $name consistently through ${provider ? 'Provider/useFeatureFlags' : 'createToggly'}`,
    async ({ snapshot, expected }) => {
      expect(isServer).toBe(true);
      expect(typeof window).toBe('undefined');
      const fetch = vi.fn(() => {
        throw new Error('SSR must not fetch');
      });
      const telemetryFetch = vi.fn(() => {
        throw new Error('SSR must not report');
      });
      const diagnostic = vi.fn();
      const interval = vi.spyOn(globalThis, 'setInterval');
      const timeout = vi.spyOn(globalThis, 'setTimeout');
      const config = {
        appKey: 'app',
        instanceId: 'current',
        flagDefaults: { On: false },
        fetch,
        telemetryFetch,
        telemetryFlushIntervalMs: -1,
        onTelemetryDiagnostic: diagnostic,
      };
      let value!: Toggly;
      let observed: unknown;
      const read = () => {
        const flags = provider ? useFeatureFlags() : value.flags;
        observed = {
          flags: flags(),
          client: value.client.flags(),
          resource: value.resource(),
          decision: value.evaluate(['On']),
        };
        value.recordUsage('ssr');
        return <span>{flags().On ? 'enabled' : 'disabled'}</span>;
      };
      const View = () => {
        value = useToggly();
        return read();
      };
      const html = renderToString(() => {
        if (provider)
          return (
            <TogglyProvider config={config} snapshot={snapshot}>
              <View />
            </TogglyProvider>
          );
        value = createToggly(config, snapshot);
        return read();
      });
      await value.flushTelemetry();
      expect(observed).toEqual({
        flags: { On: expected },
        client: { On: expected },
        resource: snapshot ? { On: expected } : undefined,
        decision: expected,
      });
      expect(html).toContain(expected ? 'enabled' : 'disabled');
      expect(fetch).not.toHaveBeenCalled();
      expect(telemetryFetch).not.toHaveBeenCalled();
      expect(diagnostic).not.toHaveBeenCalled();
      expect(interval).not.toHaveBeenCalled();
      // Native renderToString schedules its root disposal before invoking the view.
      expect(timeout).toHaveBeenCalledTimes(1);
      value.client.dispose();
    },
  );
}
