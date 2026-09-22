import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {createTogglyClient} from '../src/browser'
import {createBrowserSnapshots} from '../src/browser-snapshots'
import type {TogglyConfig} from '../src/types'
const options={appKey:'context',identity:'alice',instanceId:'a',persistFeatures:true,refreshInterval:0,enableLiveUpdates:false}
const gate={requirement:'all',rules:[{property:'Plan',op:'eq',value:'pro',type:'string'}]}
let storage:Map<string,string>
const owners:ReturnType<typeof createTogglyClient>[]=[]
function owner(config: TogglyConfig = {}) {const value=createTogglyClient({...options,...config});owners.push(value);return value}
beforeEach(()=>{
 storage=new Map();vi.stubGlobal('localStorage',{getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value)})
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({defs:{Flag:true,Gate:gate}}),{headers:{etag:'a'}})))
})
afterEach(()=>{owners.splice(0).forEach(value=>value.destroy());vi.unstubAllGlobals();vi.restoreAllMocks()})
it('restores full mixed gates after replacement, offline and token ABA 304',async()=>{
 const first=owner();await first.init();first.destroy()
 const second=owner();vi.mocked(fetch).mockRejectedValueOnce(Error('offline'));await second.init()
 const entity={kind:'Tenant',key:'tenant',attributes:{Plan:'pro'}}
 expect(await second.isFeatureOn('Flag')).toBe(true);expect(await second.isFeatureOn('Gate',entity)).toBe(true)
 vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({Flag:false}),{headers:{etag:'b'}}));await second.setContext({instanceId:'b'})
 vi.mocked(fetch).mockResolvedValueOnce(new Response(null,{status:304,headers:{etag:'a'}}));await second.setContext({instanceId:'a'})
 expect(second.state.features).toEqual({Flag:true,Gate:gate});expect(await second.isFeatureOn('Gate',entity)).toBe(true)
 expect(new Headers(vi.mocked(fetch).mock.calls.at(-1)![1]?.headers).get('If-None-Match')).toBe('a')
})
it('keeps local raw definitions separate from remote evaluated bodies and validators',async()=>{
 const client=owner();await client.init()
 vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify([{featureKey:'Raw',filters:[{name:'AlwaysOn',parameters:{}}]}]),{headers:{etag:'raw'}}))
 await client.init({evaluationMode:'local'});expect(await client.isFeatureOn('Raw')).toBe(true)
 expect(new Headers(vi.mocked(fetch).mock.calls.at(-1)![1]?.headers).get('If-None-Match')).toBeNull()
 vi.mocked(fetch).mockResolvedValueOnce(new Response(null,{status:304,headers:{etag:'a'}}));await client.init({evaluationMode:'remote'})
 expect(await client.isFeatureOn('Flag')).toBe(true);expect(await client.isFeatureOn('Raw')).toBe(false)
 vi.mocked(fetch).mockResolvedValueOnce(new Response(null,{status:304,headers:{etag:'raw'}}));await client.init({evaluationMode:'local'})
 expect(await client.isFeatureOn('Raw')).toBe(true);expect(new Headers(vi.mocked(fetch).mock.calls.at(-1)![1]?.headers).get('If-None-Match')).toBe('raw')
})
it('bounds memory and persisted contexts with body/revision pairs across live-owner eviction',async()=>{
 const first=owner();await first.init()
 const rotating=owner({instanceId:'b'});await rotating.init()
 for(let i=0;i<12;i++) await rotating.setContext({instanceId:`token-${i}`})
 let entries=JSON.parse([...storage.values()][0]);expect(entries).toHaveLength(8);expect(entries.every((entry:any)=>entry[1].features.Flag===true&&entry[1].revision==='a')).toBe(true)
 vi.mocked(fetch).mockResolvedValueOnce(new Response(null,{status:304,headers:{etag:'a'}}));await first.refresh()
 expect(await first.isFeatureOn('Flag')).toBe(true);entries=JSON.parse([...storage.values()][0]);expect(entries).toHaveLength(8)
 const restored=owner();vi.mocked(fetch).mockResolvedValueOnce(new Response(null,{status:304}));await restored.init();expect(await restored.isFeatureOn('Flag')).toBe(true)
 vi.mocked(fetch).mockRejectedValueOnce(Error('offline'));await expect(rotating.setContext({instanceId:'b'})).rejects.toThrow('offline');expect(rotating.state.features).toEqual({})
})
it('never admits an orphan or malformed stored gate and never sends its revision',async()=>{
 const first=owner();await first.init();first.destroy()
 const key=[...storage.keys()][0];const entries=JSON.parse(storage.get(key)!)
 entries[0][1].features.Gate.rules=[{property:'x',op:'eq',value:4}];storage.set(key,JSON.stringify(entries))
 const next=owner();vi.mocked(fetch).mockResolvedValueOnce(new Response(null,{status:304,headers:{etag:'orphan'}}));await next.init()
 expect(next.state.features).toEqual({});expect(new Headers(vi.mocked(fetch).mock.calls.at(-1)![1]?.headers).get('If-None-Match')).toBeNull();expect(next.state.error?.message).toContain('304 without')
})
it('keeps canonical Unicode groups stable without mutating caller inputs',()=>{
 const groups=['é','Z','😀','a','10','2','Z'];const config:TogglyConfig={...options,instanceId:'',groups,claims:{z:'a',A:'b'}}
 const cache=createBrowserSnapshots(config);const scope=cache.scope();config.groups=[...groups].reverse();expect(cache.scope()).toBe(scope);expect(groups).toEqual(['é','Z','😀','a','10','2','Z'])
})
it.each([null,'broken','{}','[null,[1,{}],["x",{"features":[],"definitions":[],"revision":null}]]'])('ignores corrupt storage %s',value=>{
 const config:TogglyConfig={...options};const cache=createBrowserSnapshots(config);cache.save({features:{Flag:true},definitions:[],revision:'a'});storage.set([...storage.keys()][0],value as any)
 expect(createBrowserSnapshots(config).restore()).toBeUndefined()
})
it('keeps memory usable when persistence is disabled or writes throw',()=>{
 const config:TogglyConfig={...options,persistFeatures:false};const cache=createBrowserSnapshots(config)
 cache.save({features:{Flag:true},definitions:[],revision:null});expect(cache.restore()?.features.Flag).toBe(true);expect(storage.size).toBe(0)
 config.persistFeatures=true;vi.stubGlobal('localStorage',{getItem:()=>{throw Error('denied')},setItem:()=>{throw Error('full')}})
 cache.save({features:{Flag:false},definitions:[],revision:'b'});expect(cache.restore()?.features.Flag).toBe(false)
})
it('captures the complete evaluated gate before callbacks mutate the public body',async()=>{
 const client=owner();await client.init()
 client.addHook({getMetadata:()=>({name:'mutate'}),beforeEvaluation:()=>{
  const value=client.state.features.Gate as typeof gate;value.rules[0].value='free'
 }})
 expect(await client.isFeatureOn('Gate',{kind:'Tenant',key:'t',attributes:{Plan:'pro'}})).toBe(true)
})
it('captures selected local definitions before a hook mutates their filter',async()=>{
 const client=owner({evaluationMode:'local'})
 vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify([{featureKey:'Raw',filters:[{name:'AlwaysOn',parameters:{}}]}])))
 await client.init();client.addHook({getMetadata:()=>({name:'mutate'}),beforeEvaluation:()=>{client.getDefinitions().get('Raw')!.filters[0].name='AlwaysOff'}})
 expect(await client.isFeatureOn('Raw')).toBe(true)
})

it.each(['local','remote'] as const)('constructs minted %s path and scrubs all repeated targeting query values',async evaluationMode=>{
 vi.mocked(fetch).mockImplementation(async()=>new Response(JSON.stringify(evaluationMode==='local'?[]:{Flag:true})))
 const client=owner({evaluationMode,baseUri:'https://defs.invalid/base/?u=old&u=older&userId=secret&g=one&g=two&claim.plan=paid&claim.role=staff&keep=a&keep=b&i=stale',instanceId:' minted '})
 await client.init();const [input,request]=vi.mocked(fetch).mock.calls[0];const url=new URL(String(input))
 expect(url.pathname).toBe(`/base/${evaluationMode==='local'?'definitions-signed':'evaluated-signed'}/context/Production`)
 expect([...url.searchParams]).toEqual([['keep','a'],['keep','b'],['i','minted']])
 expect(new Headers(request?.headers).has('x-toggly-identity')).toBe(false)
})
it('preserves non-minted targeting and unrelated base query values',async()=>{
 const client=owner({baseUri:'https://defs.invalid/base?keep=yes',instanceId:undefined,groups:['staff'],claims:{role:'admin'}});await client.init()
 const url=new URL(String(vi.mocked(fetch).mock.calls[0][0]));expect(url.pathname).toBe('/base/evaluated-signed/context/Production');expect(url.searchParams.get('u')).toBe('alice');expect(url.searchParams.get('g')).toBe('staff');expect(url.searchParams.get('claim.role')).toBe('admin');expect(url.searchParams.get('keep')).toBe('yes')
})
it.each(['local','remote'] as const)('never revives inherited i during %s initial blank, rotation and clear',async evaluationMode=>{
 vi.mocked(fetch).mockImplementation(async()=>new Response(JSON.stringify(evaluationMode==='local'?[{featureKey:'Flag',filters:[{name:'AlwaysOn',parameters:{}}]}]:{Flag:true})))
 const client=owner({evaluationMode,baseUri:'https://defs.invalid/base?i=retired&%69=older&keep=a&keep=b',instanceId:' '})
 const check=async(token:string|null,identity:string)=>{
  const [input,request]=vi.mocked(fetch).mock.calls.at(-1)!;const url=new URL(String(input))
  expect(url.searchParams.getAll('i')).toEqual(token?[token]:[]);expect(url.searchParams.getAll('keep')).toEqual(['a','b']);expect(url.pathname).toBe(`/base/${evaluationMode==='local'?'definitions-signed':'evaluated-signed'}/context/Production`)
  expect(new Headers(request?.headers).get('x-toggly-identity')).toBe(token?null:identity);expect(await client.isFeatureOn('Flag')).toBe(true)
 }
 await client.init();await check(null,'alice');await client.setContext({instanceId:' current '});await check('current','alice');await client.setContext({identity:'bob'});await check(null,'bob')
 await client.init({instanceId:undefined});await check(null,'bob');await client.setContext({instanceId:'next'});await check('next','bob');await client.setContext({instanceId:' '});await check(null,'bob')
})
