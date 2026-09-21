import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
import { render, waitFor } from '@testing-library/svelte'
import { clearRegisteredContexts, type EntityGate } from '@ops-ai/toggly-hooks-types'
import { Toggly } from '../services/toggly.service'
import { createToggly } from '../utils/createToggly'
import Feature from '../components/Feature.svelte'
import {
  createFeatureStore,
  createVariantStore,
  createVariantValueStore,
  flushTelemetry,
  incrementCounter,
  recordUsage,
  recordView,
  setGauge,
  togglyFlagsStore,
  togglyServiceStore,
  togglyVariantsStore,
} from '../stores/toggly.store'

const metricsBaseUrl = 'http://metrics.example.test/base'
const requests: Array<{ url: string; init: RequestInit }> = []

function definitions(service: Toggly, flags: Record<string, unknown>, variants?: Record<string, unknown>): void {
  Object.assign(service, { _features: flags, _variants: variants ?? null })
}

function envelope(index = 0): Record<string, unknown> {
  const body = requests[index]?.init.body
  if (typeof body !== 'string') throw new Error('Expected uncompressed test payload')
  return JSON.parse(body) as Record<string, unknown>
}

function service(options: ConstructorParameters<typeof Toggly>[0] = {}): Toggly {
  return new Toggly({
    appKey: 'test-app', environment: 'Test', metricsBaseUrl,
    persistCache: false, enableLiveUpdates: false, ...options,
  })
}

describe('Svelte frontend telemetry ownership and evaluations', () => {
  beforeEach(() => {
    requests.length = 0
    localStorage.clear()
    clearRegisteredContexts()
    vi.stubGlobal('CompressionStream', undefined)
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith(metricsBaseUrl)) {
        requests.push({ url, init: init! })
        return { status: 202, headers: { get: () => null } } as Response
      }
      return {
        ok: true, status: 200,
        text: async () => JSON.stringify({ A: true }),
        json: async () => ({ A: true }),
      } as Response
    }))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    togglyServiceStore.set(null)
    togglyFlagsStore.set({})
    togglyVariantsStore.set({})
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    clearRegisteredContexts()
  })

  it('keeps immediate queued events attributed across login, token rotation and logout', async () => {
    const owner = service()
    owner.recordUsage('anonymous')
    await owner.setContext({ identity: 'alice' })
    owner.setGauge('active', 1)
    await owner.setContext({ instanceId: 'token-a' })
    owner.setGauge('active', 2)
    await owner.setContext({ instanceId: 'token-b', identity: 'bob' })
    owner.recordView('token')
    await owner.setContext({ instanceId: '', identity: '' })
    owner.recordUsage('logout')
    await owner.flushTelemetry()
    expect(requests.map((_, i) => envelope(i))).toEqual([
      { k: 'test-app', e: 'Test', f: { anonymous: { enabled: [0, 1] } } },
      { k: 'test-app', e: 'Test', u: 'alice', m: { active: 1 } },
      { k: 'test-app', e: 'Test', i: 'token-a', m: { active: 2 } },
      { k: 'test-app', e: 'Test', i: 'token-b', f: { token: { enabled: [0, 0, 1] } } },
      { k: 'test-app', e: 'Test', f: { logout: { enabled: [0, 1] } } },
    ])
    owner.dispose()
  })

  it.each([false, true])('hydrates token A→B→A conditional definitions with variants=%s', async enableVariants => {
    const seen: Array<{ url: URL; revision: string | null }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const parsed = new URL(url)
      const revision = new Headers(init?.headers).get('If-None-Match')
      seen.push({ url: parsed, revision })
      const token = parsed.searchParams.get('i')
      const defs = enableVariants ? { A: { enabled: token === 'token-a', variant: token, configurationValue: 42 } } : { A: token === 'token-a' }
      return new Response(revision ? null : JSON.stringify(defs), { status: revision ? 304 : 200, headers: { ETag: token ?? 'fallback' } })
    }))
    const owner = service({ instanceId: 'token-a', identity: 'alice', groups: ['beta'], claims: { plan: 'pro' }, persistCache: true, enableVariants, enableTelemetry: false })
    await owner.refreshFlags()
    await owner.setContext({ instanceId: 'token-b' })
    await owner.setContext({ instanceId: 'token-a' })
    expect(owner.getEffectiveFlagValue('A')).toBe(true)
    if (enableVariants) expect(owner.getVariant('A')?.name).toBe('token-a')
    expect(seen.map(item => item.revision)).toEqual([null, null, 'token-a'])
    for (const { url } of seen) {
      expect(url.searchParams.has('u')).toBe(false)
      expect(url.searchParams.has('userId')).toBe(false)
      expect(url.searchParams.has('g')).toBe(false)
      expect(url.searchParams.has('claim.plan')).toBe(false)
    }
    owner.dispose()
  })

  it('retains new context defaults and rejects on failed refresh without restoring old user flags', async () => {
    const owner = service({ instanceId: 'token-a', featureDefaults: { A: false } })
    definitions(owner, { A: true })
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (!url.startsWith(metricsBaseUrl)) throw new Error('offline')
      requests.push({ url, init: init! })
      return new Response(null, { status: 202 })
    }))
    await expect(owner.setContext({ instanceId: 'token-b' })).rejects.toThrow('offline')
    expect(owner.getEffectiveFlagValue('A')).toBe(false)
    await owner.flushTelemetry()
    expect(envelope()).toEqual({ k: 'test-app', e: 'Test', i: 'token-b', f: { A: { disabled: [1] } } })
    owner.dispose()
  })

  it('captures variant and attribution before a reentrant local gate changes context', async () => {
    const owner = service({ identity: 'alice', enableVariants: true })
    definitions(owner, { A: true }, { A: { enabled: true, variant: 'blue', configurationValue: 42 } })
    let transition: Promise<void> | undefined
    owner.setLocalGates([{ id: 'switch', flagKeys: ['A'], isEnabled: () => {
      transition = owner.setContext({ identity: 'bob' })
      return true
    } }])
    expect(owner.getVariant('A')).toEqual({ name: 'blue', configurationValue: 42 })
    await transition
    owner.recordUsage('new')
    await owner.flushTelemetry()
    expect(envelope()).toEqual({ k: 'test-app', e: 'Test', u: 'alice', f: { A: { blue: [1] } } })
    expect(envelope(1)).toEqual({ k: 'test-app', e: 'Test', u: 'bob', f: { new: { enabled: [0, 1] } } })
    owner.dispose()
  })

  it('keeps client targeting after clearing a token and preserves omitted context fields', async () => {
    const owner = service({ instanceId: 'token-a', identity: 'alice', groups: ['beta'], claims: { plan: 'pro' } })
    await owner.setContext({ instanceId: '' })
    const url = new URL(vi.mocked(fetch).mock.calls[0][0] as string)
    expect(url.searchParams.get('i')).toBeNull()
    expect(url.searchParams.get('u')).toBe('alice')
    expect(url.searchParams.getAll('g')).toEqual(['beta'])
    expect(url.searchParams.get('claim.plan')).toBe('pro')
    owner.recordUsage('fallback')
    await owner.flushTelemetry()
    expect(envelope().u).toBe('alice')
    owner.dispose()
  })

  it.each(['mapper', 'hook'])('captures the old snapshot before reentrant %s callbacks', async callback => {
    const owner = service({ identity: 'alice', enableVariants: true })
    definitions(owner, { A: true }, { A: { enabled: true, variant: 'blue' } })
    let transition: Promise<void> | undefined
    if (callback === 'mapper') owner.registerContext('Order', () => {
      transition = owner.setContext({ identity: 'bob' })
      return { kind: 'Order', key: '1', attributes: {} }
    })
    else owner.addHook({ getMetadata: () => ({ name: 'switch' }), beforeEvaluation: async () => {
      await owner.setContext({ identity: 'bob' })
    } })
    expect(await owner.isFeatureOff('A', callback === 'mapper' ? { id: 1 } : undefined, callback === 'mapper' ? 'Order' : undefined)).toBe(false)
    await transition
    await owner.flushTelemetry()
    expect(envelope()).toEqual({ k: 'test-app', e: 'Test', u: 'alice', f: { A: { blue: [1] } } })
    owner.dispose()
  })

  it('ignores stale definitions and refresh notifications after token replacement', async () => {
    let release!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn((url: string) => new URL(url).searchParams.get('i') === 'token-a'
      ? new Promise<Response>(resolve => { release = resolve })
      : Promise.resolve(new Response(JSON.stringify({ B: true }), { headers: { ETag: 'b' } }))))
    const owner = service({ instanceId: 'token-a', enableTelemetry: false })
    const listener = vi.fn()
    owner.onFlagsUpdated = listener
    const old = owner.refreshFlags()
    await owner.setContext({ instanceId: 'token-b' })
    const calls = listener.mock.calls.length
    release(new Response(JSON.stringify({ A: true }), { headers: { ETag: 'a' } }))
    await old
    expect(await owner._featuresLoaded()).toEqual({ B: true })
    expect(owner._cachedDefinitionsRevision).toBe('b')
    expect(listener).toHaveBeenCalledTimes(calls)
    owner.dispose()
  })

  it('hydrates matching new-context cached flags on rejected transition', async () => {
    const owner = service({ persistCache: true, instanceId: 'token-a', enableTelemetry: false })
    await owner.refreshFlags()
    await owner.setContext({ instanceId: 'token-b' })
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    await expect(owner.setContext({ instanceId: 'token-a' })).rejects.toThrow('offline')
    expect(await owner._featuresLoaded()).toEqual({ A: true })
    owner.dispose()
  })

  it('never sends an orphan revision or reuses boolean definitions in variant mode', async () => {
    const owner = service({ persistCache: true, instanceId: 'token-a', enableTelemetry: false })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ A: true }), { headers: { ETag: 'a' } })))
    await owner.refreshFlags()
    owner.dispose()
    for (let n = localStorage.length - 1; n >= 0; n--) {
      const key = localStorage.key(n)!
      if (key.startsWith('toggly:flags:')) localStorage.removeItem(key)
    }
    const second = service({ persistCache: true, instanceId: 'token-a', enableTelemetry: false })
    await second.refreshFlags()
    const variants = service({ persistCache: true, instanceId: 'token-a', enableVariants: true, enableTelemetry: false })
    await variants.refreshFlags()
    expect(vi.mocked(fetch).mock.calls.every(([, init]) => !new Headers(init?.headers).has('If-None-Match'))).toBe(true)
    second.dispose()
    variants.dispose()
  })

  it('retains an in-flight request attribution while immediately admitting new token events', async () => {
    let release!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (!url.startsWith(metricsBaseUrl)) return Promise.resolve(new Response('{}'))
      requests.push({ url, init: init! })
      return requests.length === 1 ? new Promise<Response>(resolve => { release = resolve }) : Promise.resolve(new Response(null, { status: 202 }))
    }))
    const owner = service({ identity: 'alice' })
    owner.recordUsage('old')
    const sending = owner.flushTelemetry()
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    await owner.setContext({ instanceId: 'token-b' })
    owner.recordUsage('new')
    release(new Response(null, { status: 202 }))
    await sending
    await owner.flushTelemetry()
    expect(envelope().u).toBe('alice')
    expect(envelope(1).i).toBe('token-b')
    expect(envelope(1).f).toEqual({ new: { enabled: [0, 1] } })
    owner.dispose()
  })

  it('clears in-memory revisions with nonpersistent definitions before the next fetch', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ A: true }), { headers: { ETag: 'a' } })))
    const owner = service({ instanceId: 'token-a', enableTelemetry: false })
    await owner.refreshFlags()
    owner.clearFeatureFlagsCache()
    await owner.refreshFlags()
    expect(new Headers(vi.mocked(fetch).mock.calls[1][1]?.headers).has('If-None-Match')).toBe(false)
    owner.dispose()
  })

  it('ignores context changes after disposal and keeps late evaluation hooks out of another owner', async () => {
    const old = service({ identity: 'alice' })
    definitions(old, { A: true })
    let release!: () => void
    let entered!: () => void
    const called = new Promise<void>(resolve => { entered = resolve })
    old.addHook({ getMetadata: () => ({ name: 'pending' }), beforeEvaluation: async () => {
      entered()
      await new Promise<void>(resolve => { release = resolve })
    } })
    togglyServiceStore.set(old)
    const evaluation = old.isFeatureOn('A')
    await called
    const replacement = service({ identity: 'bob' })
    definitions(replacement, { A: true })
    togglyServiceStore.set(replacement)
    await old.setContext({ instanceId: 'late' })
    release()
    expect(await evaluation).toBe(true)
    expect(await replacement.isFeatureOn('A')).toBe(true)
    await replacement.flushTelemetry()
    expect(requests).toHaveLength(1)
    expect(envelope().u).toBe('bob')
    expect(envelope().f).toEqual({ A: { enabled: [1] } })
  })

  it('records only evaluated leaves after local and entity gates and before negation', async () => {
    const entity: EntityGate = {
      requirement: 'all',
      rules: [{ property: 'Enabled', op: 'eq', value: 'true', type: 'string' }],
    }
    const owner = service({ localGates: [{ id: 'local', flagKeys: ['Local'], isEnabled: () => false }] })
    definitions(owner, { A: true, B: false, Local: true, Entity: entity })
    expect(await owner.evaluateFeatureGate(['B', 'A'], 'all', true)).toBe(true)
    expect(await owner.evaluateFeatureGate(['A', 'B'], 'any')).toBe(true)
    expect(await owner.isFeatureOn('Local')).toBe(false)
    expect(await owner.isFeatureOn('Entity', {
      kind: 'Order', key: '1', attributes: { Enabled: 'true' },
    })).toBe(true)
    await owner.flushTelemetry()
    expect(envelope()).toEqual({
      k: 'test-app', e: 'Test',
      f: {
        B: { disabled: [1] },
        A: { enabled: [1] },
        Local: { disabled: [1] },
        Entity: { enabled: [1] },
      },
    })
    owner.dispose()
  })

  it('records assigned variants once through getVariant and delegated getVariantValue', async () => {
    const owner = service({ enableVariants: true })
    definitions(owner, { V: true, Off: false }, {
      V: { enabled: true, variant: 'blue', configurationValue: 42 },
      Off: { enabled: false, variant: 'red' },
    })
    expect(owner.getVariant('V')).toEqual({ name: 'blue', configurationValue: 42 })
    expect(owner.getVariantValue('V')).toBe(42)
    expect(owner.getVariant('Off')).toBeNull()
    expect(await owner.isFeatureOn('V')).toBe(true)
    await owner.flushTelemetry()
    expect(envelope()).toEqual({
      k: 'test-app', e: 'Test',
      f: { V: { blue: [3] }, Off: { disabled: [1] } },
    })
    owner.dispose()
  })

  it('keeps explicit events separate from evaluation and disables SSR/keyless/opted-out owners', async () => {
    const owner = service()
    togglyServiceStore.set(owner)
    recordUsage('A')
    recordView('A', 'blue')
    incrementCounter('orders', 2)
    setGauge('active', 5)
    await flushTelemetry()
    expect(envelope()).toEqual({
      k: 'test-app', e: 'Test',
      f: { A: { enabled: [0, 1], blue: [0, 0, 1] } },
      m: { orders: 2, active: 5 },
    })
    owner.dispose()
    for (const options of [{ enableTelemetry: false }, { appKey: '' }]) {
      const silent = service(options)
      definitions(silent, { A: true })
      expect(await silent.isFeatureOn('A')).toBe(true)
      silent.recordUsage('A')
      await silent.flushTelemetry()
      silent.dispose()
    }
    expect(requests).toHaveLength(1)
  })

  it('counts reactive store recomputations, including variant values, without projection counts', async () => {
    const owner = service({ enableVariants: true })
    definitions(owner, { A: true, V: true }, { V: { enabled: true, variant: 'blue', configurationValue: 4 } })
    togglyServiceStore.set(owner)
    togglyFlagsStore.set({ A: true, V: true })
    togglyVariantsStore.set({ V: { enabled: true, variant: 'blue', configurationValue: 4 } })
    const values: boolean[] = []
    const unsubscribe = createFeatureStore('A').subscribe(value => values.push(value))
    expect(get(createVariantStore('V'))).toEqual({ name: 'blue', configurationValue: 4 })
    expect(get(createVariantValueStore('V'))).toBe(4)
    togglyFlagsStore.set({ A: true, V: true })
    unsubscribe()
    await owner.flushTelemetry()
    expect(values).toEqual([true])
    expect(envelope()).toEqual({ k: 'test-app', e: 'Test', f: { A: { enabled: [2] }, V: { blue: [2] } } })
  })

  it('reinitialization disposes the prior owner and never attributes its events to the new app', async () => {
    const first = service({ appKey: 'first', environment: 'One' })
    definitions(first, { A: true })
    togglyServiceStore.set(first)
    expect(await first.isFeatureOn('A')).toBe(true)
    const second = service({ appKey: 'second', environment: 'Two' })
    definitions(second, { B: true })
    togglyServiceStore.set(second)
    expect(await second.isFeatureOn('B')).toBe(true)
    await second.flushTelemetry()
    await vi.waitFor(() => expect(requests).toHaveLength(2))
    expect(requests.map((_, index) => envelope(index))).toEqual([
      { k: 'first', e: 'One', f: { A: { enabled: [1] } } },
      { k: 'second', e: 'Two', f: { B: { enabled: [1] } } },
    ])
  })

  it('delayed old initialization cannot overwrite new stores or restart resources', async () => {
    let release!: (value: Response) => void
    const oldFetch = new Promise<Response>(resolve => { release = resolve })
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url.startsWith(metricsBaseUrl)) {
        requests.push({ url, init: init! })
        return Promise.resolve({ status: 202, headers: { get: () => null } } as Response)
      }
      if (url.includes('old-app')) return oldFetch
      return Promise.resolve({
        ok: true, status: 200, text: async () => JSON.stringify({ New: true }),
        json: async () => ({ New: true }),
      } as Response)
    })
    vi.stubGlobal('fetch', fetchMock)
    const old = createToggly({ appKey: 'old-app', environment: 'Old', metricsBaseUrl, enableLiveUpdates: false, persistCache: false })
    await createToggly({ appKey: 'new-app', environment: 'New', metricsBaseUrl, enableLiveUpdates: false, persistCache: false })
    release({ ok: true, status: 200, text: async () => JSON.stringify({ Old: true }), json: async () => ({ Old: true }) } as Response)
    await old
    expect(get(togglyFlagsStore)).toEqual({ New: true })
    expect(await get(togglyServiceStore)!.isFeatureOn('New')).toBe(true)
    await get(togglyServiceStore)!.flushTelemetry()
    expect(envelope()).toEqual({ k: 'new-app', e: 'New', f: { New: { enabled: [1] } } })
  })

  it('counts one component evaluation after cold initialization and keeps hydration silent', async () => {
    let release!: (value: Response) => void
    const coldFetch = new Promise<Response>(resolve => { release = resolve })
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (url.startsWith(metricsBaseUrl)) {
        requests.push({ url, init: init! })
        return Promise.resolve({ status: 202, headers: { get: () => null } } as Response)
      }
      return coldFetch
    }))
    const initialization = createToggly({
      appKey: 'cold-app', environment: 'Cold', metricsBaseUrl,
      enableLiveUpdates: false, persistCache: false,
    })
    render(Feature, { props: { featureKey: 'A' } })
    release({ ok: true, status: 200, text: async () => JSON.stringify({ A: true }), json: async () => ({ A: true }) } as Response)
    await initialization
    await waitFor(() => expect(get(togglyServiceStore)).not.toBeNull())
    await Promise.resolve()
    await get(togglyServiceStore)!.flushTelemetry()
    expect(envelope()).toEqual({ k: 'cold-app', e: 'Cold', f: { A: { enabled: [1] } } })
  })

  it('counts one check for each component recomputation', async () => {
    const owner = service()
    definitions(owner, { A: true })
    togglyServiceStore.set(owner)
    togglyFlagsStore.set({ A: true })
    const evaluations = vi.spyOn(owner, 'evaluateFeatureGate')
    render(Feature, { props: { featureKey: 'A' } })
    await waitFor(() => expect(evaluations).toHaveBeenCalledTimes(1))
    togglyFlagsStore.set({ A: true })
    await waitFor(() => expect(evaluations).toHaveBeenCalledTimes(2))
    await owner.flushTelemetry()
    expect(envelope()).toEqual({ k: 'test-app', e: 'Test', f: { A: { enabled: [2] } } })
  })

  it('flushes on browser pagehide and detaches lifecycle on disposal', async () => {
    const owner = service()
    owner.recordUsage('A')
    window.dispatchEvent(new Event('pagehide'))
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0].init.keepalive).toBe(true)
    owner.dispose()
    window.dispatchEvent(new Event('pagehide'))
    await Promise.resolve()
    expect(requests).toHaveLength(1)
  })

  it('does not instantiate telemetry outside a browser', async () => {
    const browserWindow = window
    const browserDocument = document
    vi.stubGlobal('window', undefined)
    vi.stubGlobal('document', undefined)
    try {
      const owner = service()
      definitions(owner, { A: true })
      expect(await owner.isFeatureOn('A')).toBe(true)
      owner.recordUsage('A')
      await owner.flushTelemetry()
      owner.dispose()
      expect(requests).toHaveLength(0)
    } finally {
      vi.stubGlobal('window', browserWindow)
      vi.stubGlobal('document', browserDocument)
    }
  })
})
