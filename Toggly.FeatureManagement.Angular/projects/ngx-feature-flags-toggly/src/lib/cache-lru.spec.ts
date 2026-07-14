import { TestBed } from '@angular/core/testing'
import { evaluationContextCacheKey } from '@ops-ai/toggly-hooks-types'
import { TogglyService } from './toggly.service'
import { NgxFeatureFlagsTogglyModule } from './ngx-feature-flags-toggly.module'

function flagsCacheKeyForContext(appKey: string, environment: string, identity: string): string {
  return `toggly:flags:${appKey}:${environment}:${evaluationContextCacheKey({ identity })}`
}

function variantsCacheKeyForContext(appKey: string, environment: string, identity: string): string {
  return `toggly:variants:${appKey}:${environment}:${evaluationContextCacheKey({ identity })}`
}

describe('maxCacheKeys LRU', () => {
  const appKey = 'lru-app'
  const environment = 'Production'
  const OrigWebSocket = (globalThis as any).WebSocket
  let fetchSpy: jasmine.Spy

  beforeEach(() => {
    localStorage.clear()
    jasmine.clock().install()
    jasmine.clock().mockDate(new Date('2026-07-11T12:00:00.000Z'))
    spyOn(console, 'warn')
    spyOn(console, 'error')
    ;(globalThis as any).WebSocket = function () {
      return {
        onopen: null,
        onmessage: null,
        onclose: null,
        onerror: null,
        close() {},
      }
    }
    fetchSpy = spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    jasmine.clock().uninstall()
    ;(globalThis as any).WebSocket = OrigWebSocket
    TestBed.resetTestingModule()
  })

  function createService(maxCacheKeys?: number | null): TogglyService {
    TestBed.resetTestingModule()
    // re-install spies after reset
    if (!(globalThis.fetch as any).and) {
      fetchSpy = spyOn(globalThis, 'fetch')
    }
    TestBed.configureTestingModule({
      imports: [
        NgxFeatureFlagsTogglyModule.forRoot({
          appKey,
          environment,
          ...(maxCacheKeys !== undefined ? { maxCacheKeys } : {}),
        }),
      ],
    })
    return TestBed.inject(TogglyService)
  }

  async function writeFlagsForIdentity(
    service: TogglyService,
    identity: string,
    flags: { [key: string]: boolean },
  ) {
    fetchSpy.and.resolveTo({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => null },
      json: () => Promise.resolve(flags),
      text: () => Promise.resolve(JSON.stringify(flags)),
    } as any)
    await service.setContext({ identity })
  }

  it('evicts oldest flags key by lastAccessed when maxCacheKeys is exceeded', async () => {
    const service = createService(2)

    await writeFlagsForIdentity(service, 'user-a', { A: true })
    jasmine.clock().mockDate(new Date('2026-07-11T12:00:01.000Z'))
    await writeFlagsForIdentity(service, 'user-b', { B: true })
    jasmine.clock().mockDate(new Date('2026-07-11T12:00:02.000Z'))
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
    jasmine.clock().mockDate(new Date('2026-07-11T12:00:01.000Z'))
    await writeFlagsForIdentity(service, 'user-b', { B: true })

    jasmine.clock().mockDate(new Date('2026-07-11T12:00:02.000Z'))
    TestBed.resetTestingModule()
    if (!(globalThis.fetch as any).and) {
      fetchSpy = spyOn(globalThis, 'fetch')
    }
    TestBed.configureTestingModule({
      imports: [
        NgxFeatureFlagsTogglyModule.forRoot({
          appKey,
          environment,
          identity: 'user-a',
          maxCacheKeys: 2,
        }),
      ],
    })
    TestBed.inject(TogglyService)

    jasmine.clock().mockDate(new Date('2026-07-11T12:00:03.000Z'))
    TestBed.resetTestingModule()
    if (!(globalThis.fetch as any).and) {
      fetchSpy = spyOn(globalThis, 'fetch')
    }
    TestBed.configureTestingModule({
      imports: [
        NgxFeatureFlagsTogglyModule.forRoot({
          appKey,
          environment,
          maxCacheKeys: 2,
        }),
      ],
    })
    const writer = TestBed.inject(TogglyService)
    await writeFlagsForIdentity(writer, 'user-c', { C: true })

    expect(JSON.parse(localStorage.getItem(flagsCacheKeyForContext(appKey, environment, 'user-a'))!)).toEqual({
      A: true,
    })
    expect(localStorage.getItem(flagsCacheKeyForContext(appKey, environment, 'user-b'))).toBeNull()
    expect(JSON.parse(localStorage.getItem(flagsCacheKeyForContext(appKey, environment, 'user-c'))!)).toEqual({
      C: true,
    })
  })

  it('does not evict when maxCacheKeys is omitted (unlimited)', async () => {
    const service = createService()

    await writeFlagsForIdentity(service, 'user-a', { A: true })
    jasmine.clock().mockDate(new Date('2026-07-11T12:00:01.000Z'))
    await writeFlagsForIdentity(service, 'user-b', { B: true })
    jasmine.clock().mockDate(new Date('2026-07-11T12:00:02.000Z'))
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
    jasmine.clock().mockDate(new Date('2026-07-11T12:00:01.000Z'))
    await writeFlagsForIdentity(service, 'user-b', { B: true })
    jasmine.clock().mockDate(new Date('2026-07-11T12:00:02.000Z'))
    await writeFlagsForIdentity(service, 'user-c', { C: true })

    expect(localStorage.getItem(revisionKey)).toBe('etag-1')
  })

  it('removes cleared flags and variants keys from the LRU index', async () => {
    TestBed.resetTestingModule()
    if (!(globalThis.fetch as any).and) {
      fetchSpy = spyOn(globalThis, 'fetch')
    }
    fetchSpy.and.resolveTo({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => null },
      json: () =>
        Promise.resolve({
          defs: { A: { enabled: true, variant: 'control' } },
        }),
      text: () => Promise.resolve(JSON.stringify({
          defs: { A: { enabled: true, variant: 'control' } },
        })),
    } as any)

    TestBed.configureTestingModule({
      imports: [
        NgxFeatureFlagsTogglyModule.forRoot({
          appKey,
          environment,
          maxCacheKeys: 2,
          enableVariants: true,
        }),
      ],
    })
    const service = TestBed.inject(TogglyService)
    await service.setContext({ identity: 'user-a' })

    const flagsKey = flagsCacheKeyForContext(appKey, environment, 'user-a')
    const variantsKey = variantsCacheKeyForContext(appKey, environment, 'user-a')

    service.clearFeatureFlagsCache()

    const indexRaw = localStorage.getItem('toggly:cache-lru')
    expect(indexRaw).not.toBeNull()
    const index = JSON.parse(indexRaw!)
    expect(index.entries[flagsKey]).toBeUndefined()
    expect(index.entries[variantsKey]).toBeUndefined()
  })
})
