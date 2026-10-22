import { Toggly } from './toggly.service'

let owner: Toggly | undefined
let urls: URL[]
let packets: any[]
beforeEach(() => {
  urls = []; packets = []; localStorage.clear()
  globalThis.fetch = jest.fn(async (input, init) => {
    const url = new URL(String(input))
    if (url.pathname.includes('/api/frontend/telemetry')) { packets.push(JSON.parse(String(init?.body))); return { status: 202 } as Response }
    urls.push(url)
    const defs = url.toString().includes('evaluated-variants') ? { On: { enabled: true, variant: 'blue', configurationValue: 42 } } : { On: true }
    return { ok: true, status: 200, text: async () => JSON.stringify(defs) } as Response
  })
})
afterEach(() => { owner?.dispose(); owner = undefined; jest.restoreAllMocks() })
const baseURI = 'https://defs.invalid/base/?i=retired&i=old&u=legacy&userId=legacy&g=old&g=older&claim.old=kept&keep=one&keep=two'
it.each([false, true].flatMap(enableVariants => [undefined, ' ', ' current '].map(instanceId => ({ enableVariants, instanceId }))))('builds the current-context endpoint for variants $enableVariants and token $instanceId', async ({ enableVariants, instanceId }) => {
  owner = new Toggly({ appKey: 'url-app', environment: 'Test', baseURI, instanceId, identity: 'alice', groups: ['staff'], claims: { role: 'admin' }, enableVariants, enableLiveUpdates: false, persistCache: false })
  expect(await owner.isFeatureOn('On')).toBe(true)
  const url = urls[0]
  expect(url.pathname).toBe(`/base/${enableVariants ? 'evaluated-variants-signed' : 'evaluated-signed'}/url-app/Test`)
  expect(url.searchParams.getAll('keep')).toEqual(['one', 'two'])
  if (instanceId?.trim()) expect(Array.from(url.searchParams.entries())).toEqual([['keep', 'one'], ['keep', 'two'], ['i', 'current']])
  else {
    expect(url.searchParams.has('i')).toBe(false)
    expect(url.searchParams.get(enableVariants ? 'userId' : 'u')).toBe('alice')
    expect(url.searchParams.getAll('g')).toEqual(['old', 'older', 'staff'])
    expect(url.searchParams.get('claim.old')).toBe('kept')
    expect(url.searchParams.get('claim.role')).toBe('admin')
  }
  if (enableVariants) expect(owner.getVariant('On')).toEqual({ name: 'blue', configurationValue: 42 })
  await owner.flushTelemetry()
  expect(packets[0].i).toBe(instanceId?.trim() || undefined)
  expect(packets[0].u).toBe(instanceId?.trim() ? undefined : 'alice')
})
it.each([false, true])('preserves partial setters but never revives retired i after rotation and clearing (variants %s)', async enableVariants => {
  owner = new Toggly({ appKey: 'url-app', environment: 'Test', baseURI, instanceId: 'current', identity: 'alice', enableVariants, enableLiveUpdates: false, persistCache: false })
  await owner.isFeatureOn('On'); owner.recordUsage('Current')
  await owner.setContext({ groups: ['team'] })
  expect(urls[urls.length - 1].searchParams.get('i')).toBe('current')
  await owner.setContext({ identity: 'bob', instanceId: 'next' }); owner.recordUsage('Next')
  await owner.setContext({ instanceId: '' }); owner.recordUsage('Cleared')
  expect(urls.map(url => url.searchParams.get('i'))).toEqual(['current', 'current', 'next', null])
  expect(urls[urls.length - 1].searchParams.get(enableVariants ? 'userId' : 'u')).toBe('bob')
  expect(await owner.isFeatureOn('On')).toBe(true)
  await owner.flushTelemetry()
  expect(packets.filter(packet => packet.f.Current || packet.f.Next || packet.f.Cleared).map(packet => [packet.i, packet.u])).toEqual([['current', undefined], ['next', undefined], [undefined, 'bob']])
})
