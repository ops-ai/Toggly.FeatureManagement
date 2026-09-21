import { afterEach, expect, it, vi } from 'vitest'
import { Toggly } from '../services/toggly.service'

let owner: Toggly | undefined
afterEach(() => { owner?.dispose(); owner = undefined; vi.unstubAllGlobals() })

it.each([false, true])('builds the minted endpoint and scrubs all configured targeting fields (variants %s)', async enableVariants => {
  const urls: URL[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    urls.push(new URL(String(input)))
    return new Response(JSON.stringify({ defs: enableVariants ? { A: { enabled: true, variant: 'blue', configurationValue: 42 } } : { A: true } }))
  }))
  owner = new Toggly({ appKey: 'url-app', environment: 'Test', baseURI: 'https://definitions.invalid/base/?u=old&u=older&userId=private&g=a&g=b&claim.plan=paid&claim.team=secret&keep=one&keep=two', instanceId: ' token ', identity: 'alice', groups: ['staff'], claims: { role: 'admin' }, enableVariants, enableTelemetry: false, enableLiveUpdates: false, persistCache: false })
  await owner.refreshFlags()
  expect(urls.length).toBeGreaterThan(0)
  for (const url of urls) {
    expect(url.pathname).toBe(`/base/${enableVariants ? 'evaluated-variants-signed' : 'evaluated-signed'}/url-app/Test`)
    expect([...url.searchParams]).toEqual([['keep', 'one'], ['keep', 'two'], ['i', 'token']])
  }
  expect(await owner.evaluateFeatureGate(['A'])).toBe(true)
  if (enableVariants) expect(owner.getVariant('A')).toEqual({ name: 'blue', configurationValue: 42 })
})

it.each([false, true])('preserves unrelated query values and ordinary targeting without a token (variants %s)', async enableVariants => {
  const urls: URL[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: string) => { urls.push(new URL(String(input))); return new Response(JSON.stringify({ defs: { A: true } })) }))
  owner = new Toggly({ appKey: 'url-app', environment: 'Test', baseURI: 'https://definitions.invalid/base/?keep=one&keep=two', instanceId: ' ', identity: 'alice', groups: ['staff'], claims: { role: 'admin' }, enableVariants, enableTelemetry: false, enableLiveUpdates: false, persistCache: false })
  await owner.refreshFlags()
  expect(urls.length).toBeGreaterThan(0)
  for (const url of urls) {
    expect(url.pathname).toBe(`/base/${enableVariants ? 'evaluated-variants-signed' : 'evaluated-signed'}/url-app/Test`)
    expect(url.searchParams.getAll('keep')).toEqual(['one', 'two'])
    expect(url.searchParams.get(enableVariants ? 'userId' : 'u')).toBe('alice')
    expect(url.searchParams.getAll('g')).toEqual(['staff'])
    expect(url.searchParams.get('claim.role')).toBe('admin')
    expect(url.searchParams.has('i')).toBe(false)
  }
})

it.each([false, true].flatMap(enableVariants => [undefined, ' '].map(instanceId => ({ enableVariants, instanceId }))))('ignores inherited i on initialization (variants $enableVariants token $instanceId)', async ({ enableVariants, instanceId }) => {
  const urls: URL[] = []
  vi.stubGlobal('fetch', vi.fn(async input => { urls.push(new URL(String(input))); return new Response(JSON.stringify({ defs: { A: true } })) }))
  owner = new Toggly({ appKey: 'url-app', baseURI: 'https://definitions.invalid/base?i=retired&i=old&keep=one&keep=two', instanceId, identity: 'alice', groups: ['staff'], enableVariants, enableTelemetry: false, enableLiveUpdates: false, persistCache: false })
  await owner.refreshFlags()
  expect(urls.length).toBeGreaterThan(0)
  expect(urls.every(url => !url.searchParams.has('i') && url.searchParams.get(enableVariants ? 'userId' : 'u') === 'alice' && url.searchParams.getAll('keep').join() === 'one,two')).toBe(true)
})

it.each([false, true])('keeps current token authority across partial context changes, rotation and explicit clearing (variants %s)', async enableVariants => {
  const urls: URL[] = []
  const packets: any[] = []
  vi.stubGlobal('CompressionStream', undefined)
  vi.stubGlobal('fetch', vi.fn(async (input, init) => {
    const url = new URL(String(input))
    if (url.pathname.includes('/api/frontend/telemetry')) { packets.push(JSON.parse(String(init?.body))); return new Response(null, { status: 202 }) }
    urls.push(url)
    return new Response(JSON.stringify({ defs: enableVariants ? { A: { enabled: true, variant: 'blue', configurationValue: 42 } } : { A: true } }))
  }))
  owner = new Toggly({ appKey: 'url-app', baseURI: 'https://definitions.invalid/base?i=retired&u=legacy&userId=legacy&claim.old=kept&keep=one&keep=two', instanceId: 'current', identity: 'alice', enableVariants, enableLiveUpdates: false, persistCache: false })
  await owner.refreshFlags(); owner.recordUsage('Current')
  await owner.setContext({ identity: 'bob', groups: ['team'] })
  expect(urls.at(-1)!.searchParams.get('i')).toBe('current')
  await owner.setContext({ instanceId: 'next' }); owner.recordUsage('Next')
  await owner.setContext({ instanceId: '' }); owner.recordUsage('Cleared')
  const query = urls.at(-1)!.searchParams
  expect(query.has('i')).toBe(false)
  expect(query.get(enableVariants ? 'userId' : 'u')).toBe('bob')
  expect(query.getAll('keep')).toEqual(['one', 'two'])
  expect(query.get('claim.old')).toBe('kept')
  expect(await owner.evaluateFeatureGate(['A'])).toBe(true)
  if (enableVariants) expect(owner.getVariant('A')).toEqual({ name: 'blue', configurationValue: 42 })
  await owner.flushTelemetry()
  expect(packets.filter(packet => packet.f.Current || packet.f.Next || packet.f.Cleared).map(packet => [packet.i, packet.u])).toEqual([['current', undefined], ['next', undefined], [undefined, 'bob']])
})
