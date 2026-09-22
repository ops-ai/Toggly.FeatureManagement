/** @jest-environment node */
import { Toggly } from './services'
import createTogglyProvider from './components/TogglyProvider'

it('SSR services and provider factories do not start frontend telemetry', async () => {
  const timeout = jest.spyOn(globalThis, 'setTimeout')
  const fetchMock = jest.fn(async () => ({ok: true, status: 200, text: async () => JSON.stringify({On: true})}))
  globalThis.fetch = fetchMock as unknown as typeof fetch
  const service = new Toggly({appKey: 'server', environment: 'Test', enableLiveUpdates: false})
  await createTogglyProvider({appKey: 'provider-server', environment: 'Test'})
  service.recordUsage('On'); service.recordView('On'); service.incrementCounter('orders'); service.setGauge('cart', 3)
  expect(await service.isFeatureOn('On')).toBe(true)
  await service.flushTelemetry(); service.dispose()
  expect(timeout).not.toHaveBeenCalled()
  expect(fetchMock.mock.calls).toHaveLength(1)
  expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toContain('/evaluated-signed/')
  jest.restoreAllMocks()
})
