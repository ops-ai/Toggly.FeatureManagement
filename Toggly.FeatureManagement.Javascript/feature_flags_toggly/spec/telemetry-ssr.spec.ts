/** @jest-environment node */
import { Toggly } from '../lib/toggly';

test('server initialization evaluates flags without starting frontend telemetry', async () => {
  const requests: string[] = [];
  global.fetch = jest.fn(async (url: RequestInfo | URL) => {
    requests.push(String(url));
    return { status: 200, ok: true, json: async () => ({ defs: { On: true } }) } as Response;
  });

  await Toggly.init({
    appKey: 'server-key',
    enableLiveUpdates: false,
    featureFlagsRefreshInterval: 0,
  });
  expect(Toggly.isFeatureOn('On')).toBe(true);
  Toggly.recordUsage('On');
  await Toggly.flushTelemetry();
  Toggly.cancelRefreshInterval();

  expect(requests).toHaveLength(1);
  expect(requests[0]).toContain('/evaluated-signed/server-key/Production');
});
