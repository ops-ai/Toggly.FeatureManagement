import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { evaluationContextCacheKey } from '@ops-ai/toggly-hooks-types'
import { Toggly } from '../services/toggly.service'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function flagsCacheKeyForContext(appKey: string, environment: string, identity: string, mode = 'evaluated'): string {
  return `toggly:flags:${appKey}:${environment}:${JSON.stringify([mode, ['context', evaluationContextCacheKey({ identity })]])}`
}

function variantsCacheKeyForContext(appKey: string, environment: string, identity: string): string {
  return `toggly:variants:${appKey}:${environment}:${JSON.stringify(['variants', ['context', evaluationContextCacheKey({ identity })]])}`
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
    vi.clearAllMocks()
    localStorage.clear()
    mockFetch.mockReset()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-11T12:00:00.000Z'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
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
    vi.setSystemTime(new Date('2026-07-11T12:00:01.000Z'))
    await writeFlagsForIdentity(service, 'user-b', { B: true })
    vi.setSystemTime(new Date('2026-07-11T12:00:02.000Z'))
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
    vi.setSystemTime(new Date('2026-07-11T12:00:01.000Z'))
    await writeFlagsForIdentity(service, 'user-b', { B: true })

    vi.setSystemTime(new Date('2026-07-11T12:00:02.000Z'))
    new Toggly({
      appKey,
      environment,
      identity: 'user-a',
      maxCacheKeys: 2,
      enableLiveUpdates: false,
    })

    vi.setSystemTime(new Date('2026-07-11T12:00:03.000Z'))
    await writeFlagsForIdentity(service, 'user-c', { C: true })

    expect(JSON.parse(localStorage.getItem(flagsCacheKeyForContext(appKey, environment, 'user-a'))!)).toEqual({
      A: true,
    })
    expect(localStorage.getItem(flagsCacheKeyForContext(appKey, environment, 'user-b'))).toBeNull()
    expect(JSON.parse(localStorage.getItem(flagsCacheKeyForContext(appKey, environment, 'user-c'))!)).toEqual({
      C: true,
    })
  })

  it('does not evict when maxCacheKeys is omitted (unlimited)', async () => {
    const service = createService(undefined)

    await writeFlagsForIdentity(service, 'user-a', { A: true })
    vi.setSystemTime(new Date('2026-07-11T12:00:01.000Z'))
    await writeFlagsForIdentity(service, 'user-b', { B: true })
    vi.setSystemTime(new Date('2026-07-11T12:00:02.000Z'))
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
    vi.setSystemTime(new Date('2026-07-11T12:00:01.000Z'))
    await writeFlagsForIdentity(service, 'user-b', { B: true })
    vi.setSystemTime(new Date('2026-07-11T12:00:02.000Z'))
    await writeFlagsForIdentity(service, 'user-c', { C: true })

    expect(localStorage.getItem(revisionKey)).toBe('etag-1')
  })

  it.each([false, true])('evicts paired revisions without charging them to the body limit, variants=%s', async enableVariants => {
    const service = new Toggly({ appKey, environment, enableVariants, maxCacheKeys: 1, enableLiveUpdates: false, enableTelemetry: false })
    const scope = (identity: string) => flagsCacheKeyForContext(appKey, environment, identity, enableVariants ? 'variants' : 'evaluated')
    const revisionKey = (identity: string) => scope(identity).replace('toggly:flags:', 'toggly:revision:')
    try {
      for (const identity of ['user-a', 'user-b', 'user-c']) {
        const response = okResponse(enableVariants ? { A: { enabled: true, variant: 'blue' } } : { A: true })
        response.headers.get = (key: string) => key.toLowerCase() === 'etag' ? 'revision-' + identity : null
        mockFetch.mockResolvedValueOnce(response)
        await service.setContext({ identity })
        vi.setSystemTime(Date.now() + 1000)
      }
      expect(localStorage.getItem(revisionKey('user-a'))).toBeNull()
      expect(localStorage.getItem(revisionKey('user-b'))).toBeNull()
      expect(localStorage.getItem(revisionKey('user-c'))).toBe('revision-user-c')
      expect(localStorage.getItem(scope('user-c'))).not.toBeNull()
      if (enableVariants) expect(localStorage.getItem(variantsCacheKeyForContext(appKey, environment, 'user-c'))).not.toBeNull()
      expect(Object.keys(JSON.parse(localStorage.getItem('toggly:cache-lru')!).entries)).toHaveLength(enableVariants ? 2 : 1)
      expect(Object.keys(localStorage).filter(key => key.startsWith('toggly:revision:'))).toHaveLength(1)
      mockFetch.mockResolvedValueOnce(okResponse(enableVariants ? { A: { enabled: false } } : { A: false }))
      await service.setContext({ identity: 'user-a' })
      expect(new Headers(mockFetch.mock.calls[mockFetch.mock.calls.length - 1][1]?.headers).has('If-None-Match')).toBe(false)
      expect(await service.isFeatureOn('A')).toBe(false)
    } finally { service.dispose() }
  })

  it.each([false, true])('does not recreate an evicted body revision after a live owner304, variants=%s', async enableVariants => {
    const options = {appKey, environment, enableVariants, maxCacheKeys: 1, enableLiveUpdates: false}
    const first = new Toggly({...options, identity: 'live-a'})
    const second = new Toggly({...options, identity: 'live-b', enableTelemetry: false})
    const bodyKey = (identity: string) => flagsCacheKeyForContext(appKey, environment, identity, enableVariants ? 'variants' : 'evaluated')
    const revisionKey = (identity: string) => bodyKey(identity).replace('toggly:flags:', 'toggly:revision:')
    const compression = Object.getOwnPropertyDescriptor(globalThis, 'CompressionStream')
    Object.defineProperty(globalThis, 'CompressionStream', {configurable: true, value: undefined})
    try {
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(enableVariants ? {A: {enabled: true, variant: 'blue'}} : {A: true}), {headers: {etag: 'live-a-revision'}}))
      await first._loadFeatures(true)
      expect(localStorage.getItem(revisionKey('live-a'))).toBe('live-a-revision')
      vi.setSystemTime(Date.now() + 1000)
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(enableVariants ? {A: {enabled: false}} : {A: false}), {headers: {etag: 'live-b-revision'}}))
      await second._loadFeatures(true)
      expect(localStorage.getItem(bodyKey('live-a'))).toBeNull()
      expect(localStorage.getItem(revisionKey('live-a'))).toBeNull()
      mockFetch.mockResolvedValueOnce(new Response(null, {status: 304, headers: {etag: 'live-a-revision'}}))
      expect(await first._loadFeatures(true, {strict: true})).toEqual({A: true})
      expect(new Headers(mockFetch.mock.calls.at(-1)![1]?.headers).get('If-None-Match')).toBe('live-a-revision')
      expect(await first.isFeatureOn('A')).toBe(true)
      if (enableVariants) expect(first.getVariant('A')?.name).toBe('blue')
      mockFetch.mockResolvedValueOnce({status: 202})
      await first.flushTelemetry()
      expect(JSON.parse(mockFetch.mock.calls.at(-1)![1].body)).toEqual({k: appKey, e: environment, u: 'live-a', f: {A: {[enableVariants ? 'blue' : 'enabled']: [enableVariants ? 2 : 1]}}})
      expect(localStorage.getItem(bodyKey('live-a'))).toBeNull()
      expect(localStorage.getItem(revisionKey('live-a'))).toBeNull()
      expect(localStorage.getItem(bodyKey('live-b'))).not.toBeNull()
      expect(localStorage.getItem(revisionKey('live-b'))).toBe('live-b-revision')
      expect(Object.keys(localStorage).filter(key => key.startsWith('toggly:revision:'))).toHaveLength(1)
    } finally {
      first.dispose(); second.dispose()
      if (compression) Object.defineProperty(globalThis, 'CompressionStream', compression)
      else Reflect.deleteProperty(globalThis, 'CompressionStream')
    }
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

    const flagsKey = flagsCacheKeyForContext(appKey, environment, 'user-a', 'variants')
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

  it('tolerates localStorage errors while reading the LRU index', async () => {
    const service = createService(2)
    await writeFlagsForIdentity(service, 'user-a', { A: true })

    const originalGetItem = Storage.prototype.getItem
    Storage.prototype.getItem = function (this: Storage, key: string) {
      if (key === 'toggly:cache-lru') {
        throw new Error('quota')
      }
      return originalGetItem.call(this, key)
    }
    try {
      vi.setSystemTime(new Date('2026-07-11T12:00:01.000Z'))
      await writeFlagsForIdentity(service, 'user-b', { B: true })
      expect(localStorage.getItem(flagsCacheKeyForContext(appKey, environment, 'user-b'))).not.toBeNull()
    } finally {
      Storage.prototype.getItem = originalGetItem
    }
  })
})
