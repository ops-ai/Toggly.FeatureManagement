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
