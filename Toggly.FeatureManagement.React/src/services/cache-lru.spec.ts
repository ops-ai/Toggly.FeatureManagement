import { evaluationContextCacheKey } from '@ops-ai/toggly-hooks-types'
import Toggly from './toggly.service'

const mockFetch = jest.fn()
;(global as any).fetch = mockFetch

function flagsCacheKeyForContext(appKey: string, environment: string, identity: string, variants = false): string {
  return `toggly:flags:${appKey}:${environment}:v3:${variants ? 'variants' : 'evaluated'}:${evaluationContextCacheKey({ identity })}`
}

function variantsCacheKeyForContext(appKey: string, environment: string, identity: string): string {
  return `toggly:variants:${appKey}:${environment}:v3:variants:${evaluationContextCacheKey({ identity })}`
}

function okResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: { get: (_key: string): string | null => null },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
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
      enableTelemetry: false,
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

  it('preserves UTF-16 group cache bytes across permutations without mutating input', async () => {
    const groups = ['😀', 'é', 'A', 'a', '\uE000', 'Z']
    const original = [...groups]
    const context = `v2:${encodeURIComponent(JSON.stringify(['group-user', ['A', 'Z', 'a', 'é', '😀', '\uE000'], []]))}`
    const key = `toggly:flags:${appKey}:${environment}:v3:evaluated:${context}`
    const first = createService(null)
    const second = createService(null)
    try {
      mockFetch.mockResolvedValue(okResponse({ F: true }))
      await first.setContext({ identity: 'group-user', groups })
      expect(JSON.parse(localStorage.getItem(key)!)).toEqual({ F: true })
      expect(groups).toEqual(original)
      await second.setContext({ identity: 'group-user', groups: [...groups].reverse() })
      expect(JSON.parse(localStorage.getItem(key)!)).toEqual({ F: true })
      const bodyKeys = Object.keys(localStorage).filter(candidate => candidate.startsWith('toggly:flags:'))
      expect(bodyKeys).toEqual([key])
      expect(await second.isFeatureOn('F')).toBe(true)
      expect(groups).toEqual(original)
    } finally { first.dispose(); second.dispose() }
  })

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
      enableTelemetry: false,
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
      enableTelemetry: false,
      appKey,
      environment,
      maxCacheKeys: 1,
      enableVariants: true,
      enableLiveUpdates: false,
    })
    await service.setContext({ identity: 'user-a' })

    expect(localStorage.getItem(flagsCacheKeyForContext(appKey, environment, 'user-a', true))).not.toBeNull()
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

  it.each([[false, 1], [true, 1], [true, 3]])('evicts paired revisions without charging them to the body limit (variants=%s, limit=%s)', async (variants, limit) => {
    const enableVariants = variants as boolean
    const maxCacheKeys = limit as number
    const service = new Toggly({ appKey, environment, enableVariants, maxCacheKeys, enableLiveUpdates: false, enableTelemetry: false })
    const revisionKey = (identity: string) => `toggly:revision:${appKey}:${environment}:v2:${enableVariants ? 'variants' : 'evaluated'}:${evaluationContextCacheKey({ identity })}`
    try {
      for (const identity of ['user-a', 'user-b', 'user-c']) {
        const response = okResponse(enableVariants ? { A: { enabled: true, variant: 'blue' } } : { A: true })
        response.headers.get = (key: string) => key.toLowerCase() === 'etag' ? 'revision-' + identity : null
        mockFetch.mockResolvedValueOnce(response)
        await service.setContext({ identity })
        jest.setSystemTime(Date.now() + 1000)
      }
      expect(localStorage.getItem(revisionKey('user-a'))).toBeNull()
      expect(localStorage.getItem(revisionKey('user-b'))).toBeNull()
      expect(localStorage.getItem(revisionKey('user-c'))).toBe('revision-user-c')
      expect(localStorage.getItem(flagsCacheKeyForContext(appKey, environment, 'user-c', enableVariants))).not.toBeNull()
      if (enableVariants) expect(service.getVariant('A')?.name).toBe('blue')
      expect(Object.keys(JSON.parse(localStorage.getItem('toggly:cache-lru')!).entries)).toHaveLength(enableVariants ? Math.max(2, maxCacheKeys) : 1)
      expect(Object.keys(localStorage).filter(key => key.startsWith('toggly:revision:'))).toHaveLength(1)
      mockFetch.mockResolvedValueOnce(okResponse(enableVariants ? { A: { enabled: false } } : { A: false }))
      await service.setContext({ identity: 'user-a' })
      expect(new Headers(mockFetch.mock.calls[mockFetch.mock.calls.length - 1][1]?.headers).has('If-None-Match')).toBe(false)
      expect(await service.isFeatureOn('A')).toBe(false)
    } finally { service.dispose() }
  })

  it.each([false, true])('keeps live 304 state without recreating an evicted revision (variants=%s)', async enableVariants => {
    const options = { appKey, environment, enableVariants, maxCacheKeys: enableVariants ? 2 : 1, enableLiveUpdates: false, enableTelemetry: false }
    const owners = ['a', 'b'].map(instanceId => new Toggly({ ...options, instanceId }))
    mockFetch.mockImplementation(async (url: string, init: RequestInit) => {
      const revision = `rev-${new URL(url).searchParams.get('i')}`
      const notModified = new Headers(init.headers).get('If-None-Match') === revision
      return { ...okResponse(enableVariants ? { A: { enabled: true, variant: 'blue', configurationValue: 7 } } : { A: true }),
        status: notModified ? 304 : 200, ok: !notModified, headers: { get: (key: string) => key.toLowerCase() === 'etag' ? revision : null } }
    })
    try {
      await owners[0]._loadFeatures()
      jest.setSystemTime(Date.now() + 1000)
      await owners[1]._loadFeatures()
      const keysForA = () => Object.keys(localStorage).filter(key => key.endsWith(':i:a'))
      expect(keysForA()).toEqual([])
      for (let refresh = 0; refresh < 2; refresh++) {
        expect(await owners[0]._loadFeatures(true)).toEqual({ A: true })
        expect(await owners[0].isFeatureOn('A')).toBe(true)
        expect(owners[0].getVariant('A')).toEqual(enableVariants ? { name: 'blue', configurationValue: 7 } : null)
        expect(new Headers(mockFetch.mock.calls[mockFetch.mock.calls.length - 1][1].headers).get('If-None-Match')).toBe('rev-a')
        expect(keysForA()).toEqual([])
      }
      expect(Object.keys(localStorage).filter(key => key.startsWith('toggly:revision:'))).toHaveLength(1)
    } finally { owners.forEach(owner => owner.dispose()) }
  })

  it('removes cleared flags and variants keys from the LRU index', async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({
        defs: { A: { enabled: true, variant: 'control' } },
      }),
    )
    const variantsService = new Toggly({
      enableTelemetry: false,
      appKey,
      environment,
      maxCacheKeys: 2,
      enableLiveUpdates: false,
      enableVariants: true,
    })
    await variantsService.setContext({ identity: 'user-a' })

    const flagsKey = flagsCacheKeyForContext(appKey, environment, 'user-a', true)
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
      enableTelemetry: false,
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
