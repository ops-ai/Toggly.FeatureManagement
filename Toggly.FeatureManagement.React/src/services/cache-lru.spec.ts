import { evaluationContextCacheKey } from '@ops-ai/toggly-hooks-types'
import Toggly from './toggly.service'

const mockFetch = jest.fn()
;(global as any).fetch = mockFetch

function flagsCacheKeyForContext(appKey: string, environment: string, identity: string): string {
  return `toggly:flags:${appKey}:${environment}:${evaluationContextCacheKey({ identity })}`
}

function variantsCacheKeyForContext(appKey: string, environment: string, identity: string): string {
  return `toggly:variants:${appKey}:${environment}:${evaluationContextCacheKey({ identity })}`
}

function okResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: { get: () => null },
    json: () => Promise.resolve(body),
  }
}

describe('maxCacheKeys LRU', () => {
  const appKey = 'lru-app'
  const environment = 'Production'

  beforeEach(() => {
    jest.clearAllMocks()
    localStorage.clear()
    mockFetch.mockReset()
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-07-11T12:00:00.000Z'))
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  function createService(maxCacheKeys: number | null | undefined) {
    return new Toggly({
      appKey,
      environment,
      maxCacheKeys,
      enableLiveUpdates: false,
    })
  }

  async function writeFlagsForIdentity(
    service: Toggly,
    identity: string,
    flags: { [key: string]: boolean },
  ) {
    mockFetch.mockResolvedValueOnce(okResponse(flags))
    await service.setContext({ identity })
  }

  it('evicts oldest flags key by lastAccessed when maxCacheKeys is exceeded', async () => {
    const service = createService(2)

    await writeFlagsForIdentity(service, 'user-a', { A: true })
    jest.setSystemTime(new Date('2026-07-11T12:00:01.000Z'))
    await writeFlagsForIdentity(service, 'user-b', { B: true })
    jest.setSystemTime(new Date('2026-07-11T12:00:02.000Z'))
    await writeFlagsForIdentity(service, 'user-c', { C: true })

    expect(localStorage.getItem(flagsCacheKeyForContext(appKey, environment, 'user-a'))).toBeNull()
    expect(JSON.parse(localStorage.getItem(flagsCacheKeyForContext(appKey, environment, 'user-b'))!)).toEqual({
      B: true,
    })
    expect(JSON.parse(localStorage.getItem(flagsCacheKeyForContext(appKey, environment, 'user-c'))!)).toEqual({
      C: true,
    })
  })

  it('reading a key bumps lastAccessed so it survives eviction', async () => {
    const service = createService(2)

    await writeFlagsForIdentity(service, 'user-a', { A: true })
    jest.setSystemTime(new Date('2026-07-11T12:00:01.000Z'))
    await writeFlagsForIdentity(service, 'user-b', { B: true })

    jest.setSystemTime(new Date('2026-07-11T12:00:02.000Z'))
    // Seed from localStorage to touch user-a without a network write
    new Toggly({
      appKey,
      environment,
      identity: 'user-a',
      maxCacheKeys: 2,
      enableLiveUpdates: false,
    })

    jest.setSystemTime(new Date('2026-07-11T12:00:03.000Z'))
    await writeFlagsForIdentity(service, 'user-c', { C: true })

    expect(JSON.parse(localStorage.getItem(flagsCacheKeyForContext(appKey, environment, 'user-a'))!)).toEqual({
      A: true,
    })
    expect(localStorage.getItem(flagsCacheKeyForContext(appKey, environment, 'user-b'))).toBeNull()
    expect(JSON.parse(localStorage.getItem(flagsCacheKeyForContext(appKey, environment, 'user-c'))!)).toEqual({
      C: true,
    })
  })

  it('keeps same-identity flags and variants when maxCacheKeys is 1', async () => {
    mockFetch.mockResolvedValue(
      okResponse({
        defs: { A: { enabled: true, variant: 'control' } },
      }),
    )
    const service = new Toggly({
      appKey,
      environment,
      maxCacheKeys: 1,
      enableVariants: true,
      enableLiveUpdates: false,
    })
    await service.setContext({ identity: 'user-a' })

    expect(localStorage.getItem(flagsCacheKeyForContext(appKey, environment, 'user-a'))).not.toBeNull()
    expect(localStorage.getItem(variantsCacheKeyForContext(appKey, environment, 'user-a'))).not.toBeNull()
  })

  it('does not evict when maxCacheKeys is omitted (unlimited)', async () => {
    const service = createService(undefined)

    await writeFlagsForIdentity(service, 'user-a', { A: true })
    jest.setSystemTime(new Date('2026-07-11T12:00:01.000Z'))
    await writeFlagsForIdentity(service, 'user-b', { B: true })
    jest.setSystemTime(new Date('2026-07-11T12:00:02.000Z'))
    await writeFlagsForIdentity(service, 'user-c', { C: true })

    expect(localStorage.getItem(flagsCacheKeyForContext(appKey, environment, 'user-a'))).not.toBeNull()
    expect(localStorage.getItem(flagsCacheKeyForContext(appKey, environment, 'user-b'))).not.toBeNull()
    expect(localStorage.getItem(flagsCacheKeyForContext(appKey, environment, 'user-c'))).not.toBeNull()
    expect(localStorage.getItem('toggly:cache-lru')).toBeNull()
  })

  it('does not remove revision keys during LRU eviction', async () => {
    const service = createService(2)
    const revisionKey = `toggly:revision:${appKey}:${environment}`
    localStorage.setItem(revisionKey, 'etag-1')

    await writeFlagsForIdentity(service, 'user-a', { A: true })
    jest.setSystemTime(new Date('2026-07-11T12:00:01.000Z'))
    await writeFlagsForIdentity(service, 'user-b', { B: true })
    jest.setSystemTime(new Date('2026-07-11T12:00:02.000Z'))
    await writeFlagsForIdentity(service, 'user-c', { C: true })

    expect(localStorage.getItem(revisionKey)).toBe('etag-1')
  })

  it('removes cleared flags and variants keys from the LRU index', async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({
        defs: { A: { enabled: true, variant: 'control' } },
      }),
    )
    const variantsService = new Toggly({
      appKey,
      environment,
      maxCacheKeys: 2,
      enableLiveUpdates: false,
      enableVariants: true,
    })
    await variantsService.setContext({ identity: 'user-a' })

    const flagsKey = flagsCacheKeyForContext(appKey, environment, 'user-a')
    const variantsKey = variantsCacheKeyForContext(appKey, environment, 'user-a')

    variantsService.clearFeatureFlagsCache()

    const indexRaw = localStorage.getItem('toggly:cache-lru')
    expect(indexRaw).not.toBeNull()
    const index = JSON.parse(indexRaw!)
    expect(index.entries[flagsKey]).toBeUndefined()
    expect(index.entries[variantsKey]).toBeUndefined()
  })

  it('clearFeatureFlagsCache clears in-memory state when persistCache is false', () => {
    const service = new Toggly({
      appKey,
      environment,
      persistCache: false,
      maxCacheKeys: 2,
      enableLiveUpdates: false,
      featureDefaults: { A: true },
    })
    ;(service as any)._features = { A: true }
    ;(service as any)._variants = { A: { enabled: true } }
    service.clearFeatureFlagsCache()
    expect((service as any)._features).toBeNull()
    expect((service as any)._variants).toBeNull()
  })

  it('clearFeatureFlagsCache works without appKey', () => {
    const service = new Toggly({
      featureDefaults: { A: true },
      maxCacheKeys: 2,
      enableLiveUpdates: false,
    })
    service.clearFeatureFlagsCache()
    expect((service as any)._features).toBeNull()
  })

  it('tolerates localStorage errors while reading the LRU index', async () => {
    const service = createService(2)
    await writeFlagsForIdentity(service, 'user-a', { A: true })

    const originalGetItem = Storage.prototype.getItem
    Storage.prototype.getItem = function (key: string) {
      if (key === 'toggly:cache-lru') {
        throw new Error('quota')
      }
      return originalGetItem.call(this, key)
    }
    try {
      jest.setSystemTime(new Date('2026-07-11T12:00:01.000Z'))
      await writeFlagsForIdentity(service, 'user-b', { B: true })
      expect(localStorage.getItem(flagsCacheKeyForContext(appKey, environment, 'user-b'))).not.toBeNull()
    } finally {
      Storage.prototype.getItem = originalGetItem
    }
  })
})
