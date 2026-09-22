import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {defineComponent,h} from 'vue'
import {mount,flushPromises} from '@vue/test-utils'
import {gunzipSync} from 'node:zlib'
import {createToggly,resetToggly} from '../src/composables/useToggly'
import {useFeatureFlag} from '../src/composables/useFeatureFlag'
import {useFeatureGate} from '../src/composables/useFeatureGate'
import {Feature} from '../src/components/Feature'
import {TOGGLY_INJECTION_KEY} from '../src/types'
let defs:Record<string,any>,packets:any[]
const options={appKey:'oracle',identity:'alice',refreshInterval:0,enableLiveUpdates:false,persistIdentity:false}
async function transport(_url:any,init:any){const bytes=typeof init.body==='string'?Buffer.from(init.body):Buffer.from(await new Response(init.body).arrayBuffer());packets.push(JSON.parse((new Headers(init.headers).get('content-encoding')==='gzip'?gunzipSync(bytes):bytes).toString()));return {status:202}}
beforeEach(()=>{defs={On:true};packets=[];localStorage.clear();process.env.TOGGLY_DISABLE_TELEMETRY='0';vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({defs}))))})
afterEach(()=>{resetToggly();vi.unstubAllGlobals();vi.restoreAllMocks();process.env.TOGGLY_DISABLE_TELEMETRY='1'})
function owner(extra:any={}){return createToggly({...options,telemetryFetch:transport,...extra})}
for(const kind of ['flag','gate','component'])it(`counts effective ${kind} recomputation after local veto refresh`,async()=>{
 const t=owner({localGates:[{id:'deny',flagKeys:['On'],isEnabled:()=>false}]});await t.init()
 const component=kind==='component'?Feature:defineComponent({setup(){const value=kind==='flag'?useFeatureFlag('On'):useFeatureGate(['On']);return()=>h('span',String(value.isEnabled.value))}})
 const wrapper=mount(component,{props:kind==='component'?{featureKey:'On'}:{},slots:kind==='component'?{default:'allowed',fallback:'denied'}:{},global:{provide:{[TOGGLY_INJECTION_KEY as symbol]:t}}})
 try {await flushPromises();const before=wrapper.html();await t.telemetry.flushTelemetry();expect(packets[0].f.On.disabled).toEqual([1]);packets=[];defs={On:true,Other:true};await t.refresh();await flushPromises();expect(wrapper.html()).toBe(before);await t.telemetry.flushTelemetry();expect(packets).toEqual([{k:'oracle',e:'Production',u:'alice',f:{On:{disabled:[1]}}}])}finally{wrapper.unmount()}
})
it('keeps entity-vetoed Feature output and check after refresh',async()=>{
 defs={On:{requirement:'all',rules:[{property:'role',op:'eq',value:'admin'}]}}
 const t=owner();await t.init();const wrapper=mount(Feature,{props:{featureKey:'On',context:{kind:'Account',key:'one',attributes:{role:'reader'}}},slots:{default:'allowed',fallback:'denied'},global:{provide:{[TOGGLY_INJECTION_KEY as symbol]:t}}})
 try{await flushPromises();await t.telemetry.flushTelemetry();packets=[];await t.refresh();await flushPromises();expect(wrapper.text()).not.toContain('allowed');await t.telemetry.flushTelemetry();expect(packets[0].f.On.disabled).toEqual([1])}finally{wrapper.unmount()}
})
it.each(['refresh','init','context','dispose'])('retires later hook publication after %s supersedes an old refresh',async next=>{
 let hold=false,release!:()=>void,entered!:()=>void;const started=new Promise<void>(r=>{entered=r});const seen:boolean[]=[]
 const t=owner({hooks:[{getMetadata:()=>({name:'hold'}),afterRefresh:()=>hold?new Promise<void>(r=>{release=r;entered()}):undefined},{getMetadata:()=>({name:'publish'}),afterRefresh:(flags:any)=>{seen.push(flags.On)}}]});await t.init();seen.length=0;hold=true;const old=t.refresh();await started;hold=false;defs={On:false}
 if(next==='dispose')t.client.destroy();else if(next==='context')await t.setContext({instanceId:'new'});else await t[next]()
 release();await old;expect(seen).toEqual(next==='dispose'?[]:[false]);if(next!=='dispose'){expect(t.features.value.On).toBe(false);expect(t.client.state.features.On).toBe(false)}
})
it('captures selected local callbacks and exact effective leaf checks',async()=>{
 defs={First:true,Later:true};const later={id:'later',flagKeys:['Later'],isEnabled:()=>true};const first={id:'first',flagKeys:['First'],isEnabled:()=>{later.isEnabled=()=>false;later.flagKeys=[];return true}}
 const t=owner({localGates:[first,later]});await t.init();expect(await t.evaluateFeatureGate(['First','Later'])).toBe(true);await t.telemetry.flushTelemetry();expect(packets[0].f).toEqual({First:{enabled:[1]},Later:{enabled:[1]}})
})
it.each([false,true])('discards retired queue and cancels in-flight transport when replacement opt-out=%s',async optOut=>{
 let signal:AbortSignal|undefined,entered!:()=>void;const started=new Promise<void>(r=>{entered=r})
 const t=owner({telemetryFetch:async(_url:any,init:any)=>{signal=init.signal;entered();return new Promise((_resolve,reject)=>{init.signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true})})}});await t.init();t.telemetry.incrementCounter('inflight');const pending=t.telemetry.flushTelemetry();await started;t.telemetry.incrementCounter('queued')
 const next=owner({appKey:'new',enableTelemetry:!optOut});await next.init();expect(signal?.aborted).toBe(true);await pending;next.telemetry.incrementCounter('current');await next.telemetry.flushTelemetry();expect(packets).toEqual(optOut?[]:[{k:'new',e:'Production',u:'alice',m:{current:1}}])
})
it.each(['refresh','context'])('a newer %s owns readiness when initial afterRefresh is pending',async next=>{
 let hold=true,release!:()=>void,enter!:()=>void;const started=new Promise<void>(r=>{enter=r});const seen:boolean[]=[]
 const t=owner({hooks:[{getMetadata:()=>({name:'hold'}),afterRefresh:()=>hold?new Promise<void>(r=>{release=r;enter()}):undefined},{getMetadata:()=>({name:'publish'}),afterRefresh:(flags:any)=>{seen.push(flags.On)}}]})
 const initial=t.init();await started;hold=false;defs={On:false};if(next==='refresh')await t.refresh();else await t.setContext({instanceId:'new'});release();await initial
 expect(t.isReady.value).toBe(true);expect(t.isLoading.value).toBe(false);expect(t.features.value.On).toBe(false);expect(seen).toEqual([false])
})
it.each(['beforeEvaluation','afterEvaluation'])('Feature recomputation fences old results across a pending %s and unmount',async hook=>{
 const t=owner();await t.init();let held=false,release!:()=>void
 t.client.addHook({getMetadata:()=>({name:'hold'}),[hook]:()=>{if(!held){held=true;return new Promise<void>(r=>{release=r})}}})
 const wrapper=mount(Feature,{props:{featureKey:'On'},slots:{default:'allowed'},global:{provide:{[TOGGLY_INJECTION_KEY as symbol]:t}}})
 try{await flushPromises();defs={On:false};await t.refresh();await flushPromises();expect(wrapper.text()).not.toContain('allowed');release();await flushPromises();expect(wrapper.text()).not.toContain('allowed');await t.telemetry.flushTelemetry();expect(packets[0].f.On).toEqual({enabled:[1],disabled:[1]});wrapper.unmount();packets=[];await t.refresh();await flushPromises();await t.telemetry.flushTelemetry();expect(packets).toEqual([])}finally{release?.();wrapper.unmount()}
})
it('starts checks when a keyless hydrated facade is initialized with its app key',async()=>{
 const t=owner({appKey:'',featureDefaults:{On:true}});t.client.hydrateEvaluatedFeatures({On:true});t.isReady.value=true
 const wrapper=mount(Feature,{props:{featureKey:'On'},slots:{default:'allowed'},global:{provide:{[TOGGLY_INJECTION_KEY as symbol]:t}}})
 try{await flushPromises();expect(packets).toEqual([]);await t.init({appKey:'fixture'});await flushPromises();expect(wrapper.text()).toBe('allowed');await t.telemetry.flushTelemetry();expect(packets).toEqual([{k:'fixture',e:'Production',u:'alice',f:{On:{enabled:[1]}}}])}finally{wrapper.unmount()}
})

it('projects admitted initialization after a skipped refresh without extra loading-only checks',async()=>{
 let release!:(value:Response)=>void
 vi.mocked(fetch).mockImplementationOnce(()=>new Promise<Response>(r=>{release=r}))
 const t=owner();const wrapper=mount(defineComponent({setup(){const gate=useFeatureGate(['On']);return()=>h('span',String(gate.isEnabled.value))}}),{global:{provide:{[TOGGLY_INJECTION_KEY as symbol]:t}}})
 try {
  const initial=t.init();await flushPromises();expect(t.isLoading.value).toBe(true)
  await t.refresh();expect(t.isLoading.value).toBe(true);expect(t.isReady.value).toBe(false);expect(fetch).toHaveBeenCalledTimes(1)
  await t.telemetry.flushTelemetry();expect(packets).toEqual([])
  release(new Response(JSON.stringify({On:true})));await initial;await flushPromises()
  expect(t.isReady.value).toBe(true);expect(t.isLoading.value).toBe(false);expect(t.features.value.On).toBe(true);expect(wrapper.text()).toBe('true')
  await t.telemetry.flushTelemetry();expect(packets).toEqual([{k:'oracle',e:'Production',u:'alice',f:{On:{enabled:[1]}}}])
 }finally{wrapper.unmount()}
})
it.each(['destroy','replacement'])('never publishes a pending initialization after %s',async action=>{
 let release!:(value:Response)=>void
 vi.mocked(fetch).mockImplementationOnce(()=>new Promise<Response>(r=>{release=r}))
 const t=owner();const initial=t.init();await flushPromises();expect(t.isLoading.value).toBe(true)
 if(action==='destroy')t.client.destroy();else {const next=owner({identity:'bob'});await next.init();expect(next.isReady.value).toBe(true);expect(next.features.value.On).toBe(true)}
 expect(t.isLoading.value).toBe(false);release(new Response(JSON.stringify({On:true})));await initial
 expect(t.isReady.value).toBe(false);expect(t.isLoading.value).toBe(false);expect(t.features.value.On).toBeUndefined();expect(t.client.state.initialized).toBe(false)
 await t.telemetry.flushTelemetry();expect(packets).toEqual([])
})
it('keeps the latest admitted hook chain loading and ignores the retired chain settlement',async()=>{
 const releases:Array<()=>void>=[];let hold=false
 const t=owner({hooks:[{getMetadata:()=>({name:'hold'}),afterRefresh:()=>hold?new Promise<void>(r=>releases.push(r)):undefined}]});await t.init();hold=true
 const old=t.refresh();await flushPromises();expect(t.isLoading.value).toBe(true)
 defs={On:false};const next=t.refresh();await flushPromises();expect(t.isLoading.value).toBe(true)
 releases[0]();await old;expect(t.isLoading.value).toBe(true)
 releases[1]();await next;expect(t.isLoading.value).toBe(false);expect(t.features.value.On).toBe(false)
})
it('projects accepted defaults and current failure without reviving a superseded error',async()=>{
 vi.mocked(fetch).mockRejectedValueOnce(Error('initial offline'))
 const t=owner({featureDefaults:{On:true}});await t.init();expect(t.isReady.value).toBe(true);expect(t.features.value.On).toBe(true);expect(t.error.value?.message).toBe('initial offline')
 let reject!:(error:Error)=>void;vi.mocked(fetch).mockImplementationOnce(()=>new Promise<Response>((_r,j)=>{reject=j}))
 const stale=t.refresh();await flushPromises();await t.init();expect(t.error.value).toBeNull();reject(Error('old offline'));await stale;expect(t.error.value).toBeNull();expect(t.isLoading.value).toBe(false)
 vi.mocked(fetch).mockRejectedValueOnce(Error('current offline'));await expect(t.refresh()).rejects.toThrow('current offline');expect(t.error.value?.message).toBe('current offline');expect(t.isReady.value).toBe(true);expect(t.isLoading.value).toBe(false)
})
it('settles admitted context-only work after it retires pending initialization',async()=>{
 let release!:(value:Response)=>void
 vi.mocked(fetch).mockImplementationOnce(()=>new Promise<Response>(r=>{release=r}))
 const t=owner();const pending=t.init();await flushPromises();await t.setContext({instanceId:'new'})
 expect(t.isLoading.value).toBe(false);expect(t.isReady.value).toBe(false)
 release(new Response(JSON.stringify({On:true})));await pending;expect(t.isLoading.value).toBe(false);expect(t.isReady.value).toBe(false);expect(t.features.value).toEqual({})
 await t.init();expect(t.isReady.value).toBe(true);expect(t.features.value.On).toBe(true)
})
it('keeps newer network work loading when an older identify hook completes',async()=>{
 const t=owner();await t.init();let releaseHook!:()=>void
 t.client.addHook({getMetadata:()=>({name:'identify'}),afterIdentify:()=>new Promise<void>(resolve=>{releaseHook=resolve})})
 const old=t.setContext({identity:'bob'});await flushPromises();expect(t.isLoading.value).toBe(true)
 let releaseFetch!:(value:Response)=>void;vi.mocked(fetch).mockImplementationOnce(()=>new Promise<Response>(resolve=>{releaseFetch=resolve}))
 const current=t.refresh();await flushPromises();releaseHook();await old;expect(t.isLoading.value).toBe(true)
 releaseFetch(new Response(JSON.stringify({On:false})));await current;expect(t.isLoading.value).toBe(false);expect(t.features.value.On).toBe(false);expect(t.identity.value).toBe('bob')
})
