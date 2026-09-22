import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {Toggly} from '../plugins/toggly.service'

const variantBody = {On: {enabled: true, variant: 'blue', configurationValue: 7}}
const reply = (body: unknown, revision: string) => new Response(JSON.stringify({defs: body}), {headers: {etag: revision}})
let clients: Toggly[]
let sent: any[]
let definitions: ReturnType<typeof vi.fn>
function client(enableVariants: boolean, options = {}) {
  const value = new Toggly().init({appKey: 'modes', environment: 'Test', instanceId: 'token-a', enableVariants, enableLiveUpdates: false, persistCache: true, ...options})
  clients.push(value)
  return value
}
beforeEach(() => {
  clients = []; sent = []; localStorage.clear()
  definitions = vi.fn()
  vi.stubGlobal('CompressionStream', undefined)
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes('/api/frontend/telemetry')) {sent.push(JSON.parse(init!.body as string)); return {status: 202}}
    return definitions(url, init)
  }))
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {clients.forEach(value => value.dispose()); vi.restoreAllMocks(); vi.unstubAllGlobals()})

describe('response-mode bodies and validators', () => {
  it.each([false, true])('does not recreate evicted %s variant validators when a live owner receives 304', async variants => {
    let time = 0; vi.spyOn(Date, 'now').mockImplementation(() => ++time)
    definitions.mockResolvedValueOnce(reply(variants ? variantBody : {On: true}, 'retired-cache'))
    const live = client(variants, {maxCacheKeys: 2, enableTelemetry: false})
    await live._loadFeatures()
    definitions.mockResolvedValueOnce(reply(variantBody, 'protected-cache'))
    await client(true, {instanceId: 'other-token', maxCacheKeys: 2, enableTelemetry: false})._loadFeatures()
    expect(Object.values(localStorage)).not.toContain('retired-cache')
    definitions.mockResolvedValueOnce(new Response(null, {status: 304, headers: {etag: 'retired-cache'}}))
    expect(await live._loadFeatures(true, {strict: true})).toEqual({On: true})
    expect(Object.values(localStorage)).not.toContain('retired-cache')
    expect(Object.values(localStorage)).toContain('protected-cache')
  })

  it.each([true, false])('restores the %s variant mode body after the opposite mode and 304', async variants => {
    definitions.mockResolvedValueOnce(reply(variants ? variantBody : {On: false}, 'first'))
    const first = client(variants); await first._loadFeatures(); first.dispose()
    definitions.mockResolvedValueOnce(reply(variants ? {On: false} : variantBody, 'other'))
    const other = client(!variants); await other._loadFeatures(true); other.dispose()
    definitions.mockImplementationOnce(async (_url, init) => {
      expect(init.headers['If-None-Match']).toBe('first')
      return new Response(null, {status: 304})
    })
    const restored = client(variants)
    expect(await restored._loadFeatures(true, {strict: true})).toEqual({On: variants})
    expect(restored.getEffectiveFlagValue('On')).toBe(variants)
    if (variants) expect(restored.getVariant('On')).toEqual({name: 'blue', configurationValue: 7})
    await restored.flushTelemetry()
    expect(sent).toEqual([{k: 'modes', e: 'Test', i: 'token-a', f: {On: variants ? {blue: [2]} : {disabled: [1]}}}])
  })

  it.each(['disabled', 'unavailable'])('retains active variants and matching 304 without %s persistence', async persistence => {
    if (persistence === 'unavailable') {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {throw Error('storage denied')})
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {throw Error('storage denied')})
    }
    definitions.mockResolvedValueOnce(reply(variantBody, 'active'))
    const service = client(true, {persistCache: persistence !== 'disabled'})
    await service._loadFeatures()
    definitions.mockImplementationOnce(async (_url, init) => {
      expect(init.headers['If-None-Match']).toBe('active')
      return new Response(null, {status: 304})
    })
    await service._loadFeatures(true, {strict: true})
    expect(service.getVariant('On')).toEqual({name: 'blue', configurationValue: 7})
    definitions.mockRejectedValueOnce(Error('offline'))
    await service._loadFeatures(true)
    expect(service.getEffectiveFlagValue('On')).toBe(true)
    expect(service.getVariant('On')).toEqual({name: 'blue', configurationValue: 7})
    await service.flushTelemetry()
    expect(sent[0].f).toEqual({On: {blue: [3]}})
  })

  it('never trusts an old shared body with an ambiguous v2 validator', async () => {
    localStorage.setItem('toggly:flags:modes:Test:i:token-a', JSON.stringify({On: true}))
    localStorage.setItem('toggly:revision:modes:Test:v2:evaluated:i:token-a', 'old-evaluated')
    definitions.mockImplementationOnce(async (_url, init) => {
      expect(init.headers).not.toHaveProperty('If-None-Match')
      return reply({On: false}, 'fresh')
    })
    const service = client(false)
    expect(await service._loadFeatures(true, {strict: true})).toEqual({On: false})
    expect(service.getEffectiveFlagValue('On')).toBe(false)
  })

  it.each([false, true])('evicts paired revisions with %s variant bodies under the existing slot limit', async variants => {
    let time = 0; vi.spyOn(Date, 'now').mockImplementation(() => ++time)
    definitions.mockImplementation(async url => reply(variants ? variantBody : {On: false}, new URL(url).searchParams.get('i')!))
    const service = client(variants, {maxCacheKeys: 2, enableTelemetry: false})
    for (let i = 0; i < 20; i++) await service.setContext({instanceId: `rotation-${i}`})
    const revisions = Object.keys(localStorage).filter(key => key.startsWith('toggly:revision:'))
    expect(revisions).toHaveLength(variants ? 1 : 2)
    expect(revisions.every(key => !key.includes('rotation-0'))).toBe(true)
    definitions.mockImplementationOnce(async (_url, init) => {
      expect(init.headers['If-None-Match']).toBe('rotation-19')
      return new Response(null, {status: 304})
    })
    const retained = client(variants, {instanceId: 'rotation-19', maxCacheKeys: 2, enableTelemetry: false})
    expect(await retained._loadFeatures(true, {strict: true})).toEqual({On: variants})
    definitions.mockImplementationOnce(async (_url, init) => {
      expect(init.headers).not.toHaveProperty('If-None-Match')
      return reply(variants ? variantBody : {On: false}, 'recovered')
    })
    await service.setContext({instanceId: 'rotation-0'})
    service.clearFeatureFlagsCache()
    expect(Object.keys(localStorage).filter(key => key.startsWith('toggly:revision:')).length).toBeLessThanOrEqual(variants ? 0 : 1)
  })

  it('preserves protected variant validators across another app eviction and clears both mode siblings', async () => {
    let time = 0; vi.spyOn(Date, 'now').mockImplementation(() => ++time)
    const legacy = 'toggly:revision:legacy:Test'
    localStorage.setItem(legacy, 'untouched')
    definitions.mockResolvedValueOnce(reply({On: false}, 'old-app'))
    await client(false, {maxCacheKeys: 2, enableTelemetry: false})._loadFeatures()
    const route = {appKey: 'other:app', environment: 'Test:v3:evaluated:zone', instanceId: 'same', maxCacheKeys: 2, enableTelemetry: false}
    definitions.mockResolvedValueOnce(reply(variantBody, 'protected'))
    const variants = client(true, route); await variants._loadFeatures()
    const revisions = () => Object.keys(localStorage).filter(key => key.startsWith('toggly:revision:')).map(key => localStorage.getItem(key)).sort()
    expect(revisions()).toEqual(['protected', 'untouched'])
    definitions.mockImplementationOnce(async (_url, init) => {
      expect(init.headers['If-None-Match']).toBe('protected')
      return new Response(null, {status: 304})
    })
    expect(await client(true, route)._loadFeatures(true, {strict: true})).toEqual({On: true})
    definitions.mockResolvedValueOnce(reply({On: false}, 'evaluated-sibling'))
    const evaluated = client(false, {...route, maxCacheKeys: 3}); await evaluated._loadFeatures(true)
    expect(revisions()).toEqual(['evaluated-sibling', 'protected', 'untouched'])
    evaluated.clearFeatureFlagsCache()
    expect(revisions()).toEqual(['untouched'])
    definitions.mockImplementationOnce(async (_url, init) => {
      expect(init.headers).not.toHaveProperty('If-None-Match')
      return reply(variantBody, 'fresh')
    })
    expect(await client(true, route)._loadFeatures(true, {strict: true})).toEqual({On: true})
  })
})
