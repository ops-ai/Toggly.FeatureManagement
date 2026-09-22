// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { Toggly } from '../plugins/toggly.service'
import plugin from '../plugins/toggly'
import { useFeatureFlag } from '../composables/useFeatureGate'
import { useVariant } from '../composables/useVariant'

it('SSR services, plugin installation, and composables start no frontend background work', async () => {
  const timeout = vi.spyOn(globalThis, 'setTimeout')
  const fetchMock = vi.fn(async () => ({ok: true, status: 200, text: async () => JSON.stringify({On: true})}))
  vi.stubGlobal('fetch', fetchMock)
  try {
    const service = new Toggly().init({appKey: 'server', environment: 'Test'})
    const app = createSSRApp({setup() {useFeatureFlag('On'); useVariant('On'); return () => h('span', 'server')}})
    app.use(plugin, {appKey: 'ssr', environment: 'Test'})
    expect(await renderToString(app)).toContain('server')
    service.recordUsage('On'); service.recordView('On'); service.incrementCounter('orders'); service.setGauge('cart', 1)
    expect(await service.isFeatureOn('On')).toBe(true)
    await service.flushTelemetry(); service.dispose()
    expect(timeout).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  } finally {vi.restoreAllMocks(); vi.unstubAllGlobals()}
})
