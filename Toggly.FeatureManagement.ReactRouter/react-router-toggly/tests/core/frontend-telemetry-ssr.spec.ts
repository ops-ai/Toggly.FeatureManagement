import {createBrowserTelemetry} from '../../src/client/telemetry';
test('SSR owner never starts frontend timers, listeners or transport',async()=>{
  jest.useFakeTimers();const fetcher=jest.fn();
  const owner=createBrowserTelemetry({appKey:'app',telemetryFetch:fetcher});
  owner.recordCheck('On',true);owner.api.recordUsage('On');owner.api.setGauge('cart',2);owner.activate();
  await owner.api.flushTelemetry();owner.dispose();
  expect(fetcher).not.toHaveBeenCalled();expect(jest.getTimerCount()).toBe(0);jest.useRealTimers();
});
