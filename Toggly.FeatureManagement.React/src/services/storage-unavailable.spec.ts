import type { TogglyOptions } from './toggly.service'

it.each(['missing', 'denied'])('imports and retains active variants when browser storage is %s', async availability => {
  const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage')!
  const originalFetch = globalThis.fetch
  let owner: import('./toggly.service').default | undefined
  try {
    Object.defineProperty(window, 'localStorage', availability === 'missing'
      ? { configurable: true, value: undefined }
      : { configurable: true, get: () => { throw new Error('Storage denied') } })
    let Client: typeof import('./toggly.service').default
    jest.isolateModules(() => { Client = require('./toggly.service').default })
    const sent: any[] = []
    globalThis.fetch = jest.fn(async (url, init) => {
      if (String(url).includes('/api/frontend/telemetry')) {
        sent.push(JSON.parse(init!.body as string))
        return { status: 202 } as Response
      }
      return { ok: true, status: 200, text: async () => JSON.stringify({ Flag: { enabled: true, variant: 'blue', configurationValue: 7 } }) } as Response
    })
    const options: TogglyOptions = { appKey: 'storage-test', environment: 'Production', instanceId: 'token', enableVariants: true, persistCache: true, enableLiveUpdates: false }
    owner = new Client!(options)
    await owner._loadFeatures()
    expect(await owner.isFeatureOn('Flag')).toBe(true)
    expect(owner.getVariant('Flag')).toEqual({ name: 'blue', configurationValue: 7 })
    expect(owner.getVariantValue('Flag')).toBe(7)
    await owner.flushTelemetry()
    expect(sent[0].f.Flag).toEqual({ blue: [3] })
    owner.clearFeatureFlagsCache()
    expect(owner.getVariant('Flag')).toBeNull()
  } finally {
    owner?.dispose()
    Object.defineProperty(window, 'localStorage', descriptor)
    globalThis.fetch = originalFetch
  }
})
