import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { evaluationContextCacheKey } from '@ops-ai/toggly-hooks-types'
import { Toggly } from '../plugins/toggly.service'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

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
    const service = new Toggly()
    service.init({
      appKey,
      environment,
      maxCacheKeys,
      enableLiveUpdates: false,
    })
    return service
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
    const reader = new Toggly()
    reader.init({
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

  it('removes cleared flags and variants keys from the LRU index', async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({
        defs: { A: { enabled: true, variant: 'control' } },
      }),
    )
    const variantsService = new Toggly()
    variantsService.init({
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
    const service = new Toggly()
    service.init({
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
})
