import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { ElectronTogglyClient } from '../src/main/client.js'

const owned: Array<{ client: ElectronTogglyClient; path: string }> = []
afterEach(async () => {
  for (const { client, path } of owned.splice(0)) {
    client.close()
    await rm(path, { recursive: true, force: true })
  }
})
async function create(extra: Record<string, unknown> = {}) {
  const path = await mkdtemp(join(tmpdir(), 'electron-identity-'))
  const packets: any[] = [], requests: URL[] = []
  const client = new ElectronTogglyClient({
    userDataPath: path, appKey: 'app', environment: 'Test', identity: 'alice',
    enableLiveUpdates: false,
    fetch: async (url) => {
      requests.push(new URL(String(url)))
      return new Response('{"defs":{"On":true,"Off":false}}', { headers: { ETag: 'v1' } })
    },
    telemetryFetch: async (_url, init) => {
      packets.push(JSON.parse(typeof init.body === 'string' ? init.body : gunzipSync(Buffer.from(init.body as ArrayBuffer)).toString()))
      return { status: 202 }
    },
    ...extra,
  })
  owned.push({ client, path })
  await client.init()
  return { client, packets, requests, path }
}
it('uses current token or identity through initial, rotation, partial updates and clearing', async () => {
  const { client, packets, requests } = await create({
    baseURI: 'https://example.test/prefix/?i=retired&u=old&userId=old&g=old&g=older&claim.role=old&extra=one&extra=two',
    instanceId: ' token-a ', groups: ['team'], claims: { role: 'member' },
  })
  client.isFeatureOn('On')
  await client.setContext({ instanceId: 'token-b' } as any)
  client.recordUsage('On')
  await client.setContext({ groups: ['next'] })
  client.recordView('On')
  await client.setContext({ instanceId: ' ' } as any)
  client.isFeatureOff('Off')
  await client.setContext({ identity: 'bob' })
  client.isFeatureOn('On')
  await client.flushTelemetry()
  expect(packets.map(({ i, u, f }) => ({ i, u, f }))).toEqual([
    { i: 'token-a', u: undefined, f: { On: { enabled: [1] } } },
    { i: 'token-b', u: undefined, f: { On: { enabled: [0, 1, 1] } } },
    { i: undefined, u: 'alice', f: { Off: { disabled: [1] } } },
    { i: undefined, u: 'bob', f: { On: { enabled: [1] } } },
  ])
  for (const url of requests) {
    expect(url.pathname).toBe('/prefix/evaluated-signed/app/Test')
    expect(url.searchParams.getAll('extra')).toEqual(['one', 'two'])
  }
  for (const url of requests.slice(0, 3)) {
    expect(Array.from(url.searchParams.keys()).filter(k => ['u', 'userId', 'g'].includes(k) || k.startsWith('claim.'))).toEqual([])
  }
  expect(requests.map(url => url.searchParams.get('i'))).toEqual(['token-a', 'token-b', 'token-b', null, null])
})
it('captures nested flags, local gates and owner before reentrant evaluation callbacks', async () => {
  const { client, packets } = await create()
  const entity = { requirement: 'all', rules: [{ property: 'color', op: 'eq', value: 'red' }] }
  ;(client as any).features.Entity = entity
  let transition: Promise<unknown> | undefined
  client.setLocalGates([{ id: 'reenter', flagKeys: ['On'], isEnabled: () => {
    entity.rules[0].value = 'blue'
    transition = client.setContext({ identity: 'bob' })
    client.setLocalGates([{ id: 'deny', flagKeys: ['Entity'], isEnabled: () => false }])
    return true
  } }])
  expect(client.evaluateFeatureGate(['On', 'Entity'], 'all', false, { kind: 'Order', key: '1', attributes: { color: 'red' } })).toBe(true)
  await transition
  await client.flushTelemetry()
  expect(packets.flatMap(({ k, e, i, u, f }) => Object.entries(f).map(([key, value]) => ({ k, e, i, u, key, value })))).toEqual([
    { k: 'app', e: 'Test', i: undefined, u: 'alice', key: 'On', value: { enabled: [1] } },
    { k: 'app', e: 'Test', i: undefined, u: 'alice', key: 'Entity', value: { enabled: [1] } },
  ])
})
it('drops stale remaining refresh hooks and publishes the newest same-context snapshot', async () => {
  const { client } = await create()
  let release!: () => void
  let entered!: () => void
  const waiting = new Promise<void>(resolve => { entered = resolve })
  const seen: boolean[] = []
  let block = true
  client.addHook({ afterRefresh: async () => { if (block) { block = false; entered(); await new Promise<void>(resolve => { release = resolve }) } } })
  client.addHook({ afterRefresh: flags => { seen.push(flags.On) } })
  let on = false
  ;(client as any).fetchImpl = async () => new Response(JSON.stringify({ defs: { On: on } }))
  const old = client.refresh()
  await waiting
  on = true
  await client.refresh()
  release()
  await old
  expect(seen).toEqual([true])
  expect(client.getFlags()).toEqual({ On: true })
})
it('retires old context flags immediately and never restores them on a failed next-context request', async () => {
  const { client, packets } = await create({ flagDefaults: { On: false } })
  let release!: () => void
  client.addHook({ beforeIdentify: () => new Promise<void>(resolve => { release = resolve }) })
  ;(client as any).fetchImpl = async () => { throw new Error('offline') }
  const next = client.setContext({ identity: 'bob' })
  expect(client.isFeatureOn('On')).toBe(false)
  release()
  await next
  expect(client.getFlags()).toEqual({ On: false })
  await client.flushTelemetry()
  expect(packets).toEqual([{ k: 'app', e: 'Test', u: 'bob', f: { On: { disabled: [1] } } }])
})

it('records effective missing leaves even when the stored map is empty', async () => {
  const { client, packets } = await create({ fetch: async () => new Response('{}') })
  expect(client.evaluateFeatureGate(['First', 'Skipped'], 'all')).toBe(false)
  expect(client.evaluateFeatureGate(['First', 'Second'], 'any')).toBe(false)
  await client.flushTelemetry()
  expect(packets).toEqual([{ k: 'app', e: 'Test', u: 'alice', f: { First: { disabled: [2] }, Second: { disabled: [1] } } }])
})
it('retired direct reads do not invoke user gates or evaluation hooks', async () => {
  const { client } = await create()
  const gate = vi.fn(() => true), hook = vi.fn()
  client.setLocalGates([{ id: 'gate', flagKeys: ['On'], isEnabled: gate }])
  client.addHook({ beforeEvaluation: hook })
  client.close()
  client.isFeatureOn('On'); client.evaluateFeatureGate(['On'])
  await Promise.resolve()
  expect(gate).not.toHaveBeenCalled(); expect(hook).not.toHaveBeenCalled()
})
it('attempts every owner cleanup when one close observer throws', async () => {
  const { client } = await create()
  const later = vi.fn()
  client.onClose(() => { throw new Error('observer failure') })
  client.onClose(later)
  expect(() => client.close()).not.toThrow()
  expect(later).toHaveBeenCalledOnce()
  expect((client as any).refreshTimer).toBeNull()
})
it('does not restart an obsolete init after its disk read is superseded', async () => {
  const path = await mkdtemp(join(tmpdir(), 'electron-init-race-'))
  let release!: () => void; const calls: string[] = []
  const client = new ElectronTogglyClient({userDataPath: path, appKey: 'app', identity: 'alice', enableLiveUpdates: false, fetch: async url => { calls.push(String(url)); return new Response('{"On":true}') }})
  owned.push({client,path})
  let initial = true
  ;(client as any).cache.read = async () => { if (initial) { initial = false; await new Promise<void>(resolve => { release=resolve }) } return null }
  const pending = client.init()
  await client.setContext({identity:'bob'})
  expect(calls).toHaveLength(1)
  release(); await pending
  expect(calls).toHaveLength(1)
  expect(new URL(calls[0]).searchParams.get('u')).toBe('bob')
})

it('clears the old validator when a new200 response has no revision', async () => {
  const {client,path}=await create()
  ;(client as any).fetchImpl=async()=>new Response('{"On":false}')
  await client.refresh()
  expect((client as any).cachedDefinitionsRevision).toBeNull()
  const cold=new ElectronTogglyClient({userDataPath:path,appKey:'app',environment:'Test',identity:'alice',enableLiveUpdates:false,enableTelemetry:false,fetch:async(_url,init)=>{
    expect(new Headers(init?.headers).has('If-None-Match')).toBe(false)
    return new Response('{"On":false}')
  }})
  try {expect(await cold.init()).toEqual({On:false})} finally {cold.close()}
})

it('keeps live304 in memory without recreating an evicted disk body', async () => {
 const {client,path}=await create()
 await rm(join(path,'toggly'),{recursive:true,force:true})
 ;(client as any).fetchImpl=async()=>new Response(null,{status:304,headers:{ETag:'v1'}})
 expect(await client.refresh()).toEqual({On:true,Off:false})
 expect(await readdir(join(path,'toggly')).catch(()=>[])).toEqual([])
 expect(client.isFeatureOn('On')).toBe(true)
})

it('retains a valid body and revision when a malformed200 response arrives', async()=>{
 const {client}=await create()
 ;(client as any).fetchImpl=async()=>new Response('{"On":1}',{headers:{ETag:'invalid'}})
 expect(await client.refresh()).toEqual({On:true,Off:false})
 expect((client as any).cachedDefinitionsRevision).toBe('v1')
})

it('captures context input before publishing reset state to callbacks',async()=>{
 const {client}=await create({flagDefaults:{On:false}});const input={identity:'bob',groups:['first'],claims:{role:'member'}};const seen:string[]=[]
 client.onFlagsUpdated(()=>{input.identity='carol';input.groups[0]='changed';input.claims.role='changed'})
 client.addHook({beforeIdentify:identity=>{seen.push(identity)}})
 await client.setContext(input)
 expect(seen).toEqual(['bob'])
 expect((client as any).identity).toBe('bob');expect((client as any).groups).toEqual(['first']);expect((client as any).claims).toEqual({role:'member'})
})
it('validates copied local gates before replacing accepted gates',async()=>{
 const {client}=await create();client.setLocalGates([{id:'valid',flagKeys:['On'],isEnabled:()=>false}])
 const duplicate=[{id:'one',flagKeys:['On'],isEnabled:()=>true},{id:'two',flagKeys:['On'],isEnabled:()=>true}]
 expect(()=>client.setLocalGates(duplicate)).toThrow()
 expect(client.isFeatureOn('On')).toBe(false)
})

it('preserves empty-map gates as closed even when defaults and local gates permit a key',async()=>{
 const gate=vi.fn(()=>true)
 const {client,packets}=await create({fetch:async()=>new Response('{}'),flagDefaults:{On:true}})
 client.setLocalGates([{id:'permit',flagKeys:['On'],isEnabled:gate}])
 expect(client.evaluateFeatureGate(['On'])).toBe(false)
 expect(client.evaluateFeatureGate(['On'],'all',true)).toBe(true)
 expect(gate).not.toHaveBeenCalled()
 await client.flushTelemetry()
 expect(packets).toEqual([{k:'app',e:'Test',u:'alice',f:{On:{disabled:[2]}}}])
})

it('preserves legacy locale ordering and input bytes for no-token disk scopes',async()=>{
 const groups=['é','Z','😀','a','é'],claims={'é':'accent',Z:'capital',a:'lower'}
 const original=[...groups]
 const {client}=await create({groups,claims})
 const legacy='v2:'+encodeURIComponent(JSON.stringify(['alice',[...groups].sort((a,b)=>a.localeCompare(b)),Object.entries(claims).sort(([a],[b])=>a.localeCompare(b))]))
 expect((client as any).contextCacheKey).toBe(legacy)
 await client.setContext({groups:[...groups].reverse(),claims:{a:'lower',Z:'capital','é':'accent'}})
 expect((client as any).contextCacheKey).toBe(legacy)
 expect(groups).toEqual(original)
})

it('hydrates token ABA304 from its matching persisted body and validator',async()=>{
 const requests:Array<{token:string|null;revision:string|null}>=[]
 const {client,packets}=await create({instanceId:'a/b',fetch:async(url:string,init:RequestInit)=>{
  const token=new URL(url).searchParams.get('i'),revision=new Headers(init.headers).get('If-None-Match')
  requests.push({token,revision})
  if(revision)return new Response(null,{status:304,headers:{ETag:revision}})
  return new Response(JSON.stringify({On:token==='a/b'}),{headers:{ETag:token==='a/b'?'a-revision':'b-revision'}})
 }})
 expect(client.isFeatureOn('On')).toBe(true)
 expect(await client.setContext({instanceId:'a?b'})).toEqual({On:false})
 expect(client.isFeatureOn('On')).toBe(false)
 expect(await client.setContext({instanceId:'a/b'})).toEqual({On:true})
 expect(client.isFeatureOn('On')).toBe(true)
 await client.flushTelemetry()
 expect(requests).toEqual([{token:'a/b',revision:null},{token:'a?b',revision:null},{token:'a/b',revision:'a-revision'}])
 expect(packets.flatMap(p=>Object.entries(p.f).map(([key,flags])=>({i:p.i,u:p.u,key,flags})))).toEqual([{i:'a/b',u:undefined,key:'On',flags:{enabled:[1]}},{i:'a?b',u:undefined,key:'On',flags:{disabled:[1]}},{i:'a/b',u:undefined,key:'On',flags:{enabled:[1]}}])
})

it.each([undefined,' '])('removes inherited tokens at initialization with instanceId %j',async(instanceId)=>{
 const {client,requests,packets}=await create({instanceId,baseURI:'https://example.test/prefix/?i=retired&i=older&extra=one&extra=two'})
 expect(requests[0].pathname).toBe('/prefix/evaluated-signed/app/Test')
 expect(requests[0].searchParams.getAll('i')).toEqual([])
 expect(requests[0].searchParams.get('u')).toBe('alice')
 expect(requests[0].searchParams.getAll('extra')).toEqual(['one','two'])
 expect(client.isFeatureOn('On')).toBe(true)
 await client.flushTelemetry()
 expect(packets).toEqual([{k:'app',e:'Test',u:'alice',f:{On:{enabled:[1]}}}])
})
