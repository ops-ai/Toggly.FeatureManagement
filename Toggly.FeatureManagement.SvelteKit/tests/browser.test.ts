import {it,expect,vi,afterEach} from 'vitest';
import {get} from 'svelte/store';
import {connectBrowser} from '../src/client.js';
import {createToggly} from '../src/index.js';
import {envelope,jwk} from './signing.js';
const initial={definitions:{on:false},context:{identity:'alice',groups:['team'],claims:{role:'admin'}},expose:['on']};
async function settled(){for(let i=0;i<30;i++)await Promise.resolve();}
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
function socket(){
 class Socket {static all:Socket[]=[];onmessage:any;onclose:any;onopen:any;close=vi.fn();constructor(public url:string){Socket.all.push(this);}}
 vi.stubGlobal('window',{});vi.stubGlobal('WebSocket',Socket);return Socket;
}
it('verifies updates, sends immutable context, retains verified offline memory, refreshes on sockets and disposes',async()=>{
 vi.useFakeTimers();const Socket=socket();let online=true;let enabled=true;const errors=vi.fn();
 const fetcher=vi.fn(async(input:any)=>{if(!online)throw Error('offline');return new Response(String(input).endsWith('/.well-known/jwks')?JSON.stringify({keys:[jwk]}):envelope({on:enabled,secret:true}));});
 vi.stubGlobal('fetch',fetcher);
 const t=createToggly(initial,{appKey:'frontend',refreshInterval:50,onError:errors});await t.start();await vi.advanceTimersByTimeAsync(1);
 await vi.waitFor(()=>expect(t.isEnabled('on')).toBe(true));expect(get(t).definitions).toEqual({on:true});
 const url=new URL(fetcher.mock.calls[0][0]);expect(url.searchParams.get('u')).toBe('alice');expect(url.searchParams.get('g')).toBe('team');
 enabled=false;Socket.all[0].onmessage({data:'{"type":"flags-updated"}'});await vi.waitFor(()=>expect(t.isEnabled('on')).toBe(false));
 online=false;await vi.waitFor(()=>expect(errors).toHaveBeenCalled());expect(t.isEnabled('on')).toBe(false);
 Socket.all[0].onclose();t.dispose();const count=fetcher.mock.calls.length;await vi.advanceTimersByTimeAsync(6000);expect(fetcher).toHaveBeenCalledTimes(count);
});
it('switches contexts before old requests finish and never publishes after disposal',async()=>{
 socket();let release!:(r:Response)=>void;
 vi.stubGlobal('fetch',vi.fn(async(input:any)=>{
  if(String(input).endsWith('/.well-known/jwks'))return new Response(JSON.stringify({keys:[jwk]}));
  if(new URL(input).searchParams.get('u')==='alice')return new Promise<Response>(r=>release=r);
  return new Response(envelope({on:false}));
 }));
 const t=createToggly(initial,{appKey:'frontend',refreshInterval:0});await t.start();await settled();
 t.update({...initial,context:{identity:'bob'},definitions:{on:false}});await settled();
 release(new Response(envelope({on:true})));await settled();expect(t.isEnabled('on')).toBe(false);
 t.dispose();await t.start();
});
it('handles keyless defaults, cancellation during import and no live socket mode',async()=>{
 socket();const noKey=connectBrowser(initial,{},()=>{});noKey();
 const t=createToggly(initial);const pending=t.start();t.dispose();await pending;
 const errors=vi.fn();vi.stubGlobal('fetch',vi.fn(async()=>new Response('',{status:503})));
 const stop=connectBrowser(initial,{appKey:'frontend',enableLiveUpdates:false,refreshInterval:0,onError:errors},()=>{});await settled();expect(errors).toHaveBeenCalled();stop();
});
it.each(['unsigned','invalid','wrongkid','expired'])('rejects %s transport data without replacing the SSR branch',async(mode)=>{
 socket();const errors=vi.fn();
 vi.stubGlobal('fetch',vi.fn(async(input:any)=>new Response(String(input).endsWith('/.well-known/jwks')?JSON.stringify({keys:[jwk]}):mode==='unsigned'?'{"on":true}':mode==='invalid'?envelope([]):envelope({on:true},mode==='expired'?1:undefined))));
 const t=createToggly(initial,{appKey:'frontend',refreshInterval:0,enableLiveUpdates:false,onError:errors,allowedKeyIds:mode==='wrongkid'?['wrong']:undefined,maxSignatureAgeSeconds:60});await t.start();await vi.waitFor(()=>expect(errors).toHaveBeenCalled());expect(t.isEnabled('on')).toBe(false);t.dispose();
});
it('uses default polling settings and tolerates errors without a callback',async()=>{
 vi.useFakeTimers();socket();vi.stubGlobal('fetch',vi.fn(async()=>new Response(null,{status:500})));
 const publish=vi.fn();const fetcher=vi.mocked(fetch);
 const stop=connectBrowser(initial,{appKey:'frontend'},publish);
 await vi.advanceTimersByTimeAsync(1);expect(fetcher).toHaveBeenCalledOnce();
 await vi.advanceTimersByTimeAsync(180000);expect(fetcher).toHaveBeenCalledTimes(2);
 expect(publish).not.toHaveBeenCalled();stop();expect(vi.getTimerCount()).toBe(0);
});
it.each(['update','flags-updated','{"type":"update"}','{"type":"flags-updated"}'])('refreshes unconditionally for an invalidation without an etag: %s',async(message)=>{
 vi.useFakeTimers();const Socket=socket();let enabled=true;
 const fetcher=vi.fn(async(input:any)=>new Response(String(input).endsWith('/.well-known/jwks')?JSON.stringify({keys:[jwk]}):envelope({on:enabled}),{headers:{ETag:'revision-one'}}));
 vi.stubGlobal('fetch',fetcher);
 const t=createToggly(initial,{appKey:'frontend',refreshInterval:0});await t.start();await vi.advanceTimersByTimeAsync(1);await vi.waitFor(()=>expect(t.isEnabled('on')).toBe(true));
 enabled=false;Socket.all[0].onmessage({data:message});await vi.waitFor(()=>expect(t.isEnabled('on')).toBe(false));
 const requests=fetcher.mock.calls.filter(call=>!String(call[0]).endsWith('/.well-known/jwks'));
 expect(requests).toHaveLength(2);expect((requests[1] as any)[1]?.cache).toBe('no-store');expect(new Headers((requests[1] as any)[1]?.headers).has('if-none-match')).toBe(false);
 t.dispose();
});
it('uses verified conditional polling, ignores unchanged sync, pins only new revisions and reloads JWKS on key update',async()=>{
 vi.useFakeTimers();const Socket=socket();let revision='r1';
 const fetcher=vi.fn(async(input:any,init:any)=>{
  if(String(input).endsWith('/.well-known/jwks'))return new Response(JSON.stringify({keys:[jwk]}));
  return new Headers(init?.headers).get('if-none-match')===revision?new Response(null,{status:304}):new Response(envelope({on:true}),{headers:{ETag:revision}});
 });vi.stubGlobal('fetch',fetcher);
 const t=createToggly(initial,{appKey:'frontend',baseURI:'https://definitions.test',environment:'Test',refreshInterval:100});await t.start();await vi.waitFor(()=>expect(t.isEnabled('on')).toBe(true));
 Socket.all[0].onopen();Socket.all[0].onerror();await vi.advanceTimersByTimeAsync(250);
 expect(fetcher.mock.calls.some(call=>new Headers(call[1]?.headers).get('if-none-match')==='r1')).toBe(true);
 for(const data of [new Uint8Array(),'broken','null','{"type":"ping"}','{"type":"sync","unchanged":true}','{"type":"sync","etag":"r1"}','{"type":"flags-updated","etag":"r1"}'])Socket.all[0].onmessage({data});
 revision='r2';Socket.all[0].onmessage({data:'{"type":"flags-updated","etag":"r2"}'});await vi.advanceTimersByTimeAsync(350);await vi.waitFor(()=>expect(fetcher.mock.calls.some(call=>new URL(call[0]).searchParams.get('rev')==='r2')).toBe(true));
 const pinned=fetcher.mock.calls.find(call=>new URL(call[0]).searchParams.get('rev')==='r2')!;expect(new Headers(pinned[1]?.headers).get('if-none-match')).toBeNull();
 const jwksCalls=()=>fetcher.mock.calls.filter(call=>String(call[0]).endsWith('/.well-known/jwks')).length;const before=jwksCalls();
 Socket.all[0].onmessage({data:'{"type":"signing-key-updated"}'});await vi.advanceTimersByTimeAsync(350);await vi.waitFor(()=>expect(jwksCalls()).toBeGreaterThan(before));
 Socket.all[0].onclose();await vi.advanceTimersByTimeAsync(5000);expect(Socket.all).toHaveLength(2);expect(new URL(Socket.all[1].url).searchParams.get('rev')).toBe('r2');
 t.dispose();
});
it('rejects an initial 304 and reports timeout cancellation without changing defaults',async()=>{
 vi.useFakeTimers();socket();const errors=vi.fn();
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(null,{status:304})));
 let stop=connectBrowser(initial,{appKey:'frontend',timeout:10,refreshInterval:0,onError:errors},()=>{});await vi.waitFor(()=>expect(errors).toHaveBeenCalled());stop();
 errors.mockClear();let signal:AbortSignal|undefined;
 vi.stubGlobal('fetch',vi.fn((_url,init)=>new Promise((_resolve,reject)=>{signal=init.signal;signal!.addEventListener('abort',()=>reject(Error('timeout')));})));stop=connectBrowser(initial,{appKey:'frontend',timeout:10,refreshInterval:0,onError:errors},()=>{});
 await vi.advanceTimersByTimeAsync(11);expect(signal?.aborted).toBe(true);expect(errors).toHaveBeenCalled();stop();
});
it('backs off failed sockets, recovers without browser socket support, and cancels all timers during pending requests',async()=>{
 vi.useFakeTimers();vi.stubGlobal('window',{});let calls=0;
 vi.stubGlobal('WebSocket',class {constructor(){calls++;throw Error('offline socket');}});
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(null,{status:500})));
 const stop=connectBrowser(initial,{appKey:'frontend',refreshInterval:0},()=>{});expect(calls).toBe(1);await vi.advanceTimersByTimeAsync(5000);expect(calls).toBe(2);await vi.advanceTimersByTimeAsync(9999);expect(calls).toBe(2);await vi.advanceTimersByTimeAsync(1);expect(calls).toBe(3);stop();
 vi.stubGlobal('WebSocket',undefined);const withoutSocket=connectBrowser(initial,{appKey:'frontend',refreshInterval:0},()=>{});withoutSocket();
 vi.stubGlobal('fetch',vi.fn(()=>new Promise(()=>{})));const pending=connectBrowser(initial,{appKey:'frontend',refreshInterval:0},()=>{});pending();expect(vi.getTimerCount()).toBe(0);
});
it.each(['throw', 'reject'])('retains verified browser state and cleans up when an error observer fails: %s', async (mode) => {
 vi.useFakeTimers();
 const Socket = socket();
 let online = true;
 const observer = vi.fn(() => {
  if (mode === 'throw') throw Error('observer failed');
  return Promise.reject(Error('observer rejected'));
 });
 const fetcher = vi.fn(async (input: any) => {
  if (!online) throw Error('offline');
  return new Response(String(input).endsWith('/.well-known/jwks') ? JSON.stringify({ keys: [jwk] }) : envelope({ on: true }));
 });
 vi.stubGlobal('fetch', fetcher);
 const t = createToggly(initial, { appKey: 'frontend', refreshInterval: 100, onError: observer });
 await t.start();
 await vi.waitFor(() => expect(t.isEnabled('on')).toBe(true));
 online = false;
 await vi.waitFor(() => expect(observer).toHaveBeenCalled());
 expect(t.isEnabled('on')).toBe(true);
 Socket.all[0].onclose();
 await vi.advanceTimersByTimeAsync(5000);
 expect(Socket.all).toHaveLength(2);
 t.dispose();
 const requests = fetcher.mock.calls.length;
 await vi.advanceTimersByTimeAsync(10000);
 expect(fetcher).toHaveBeenCalledTimes(requests);
 expect(vi.getTimerCount()).toBe(0);
});
it.each(['throw', 'reject'])('retries failed WebSocket construction despite an error observer failure: %s', async (mode) => {
 vi.useFakeTimers();
 vi.stubGlobal('window', {});
 let attempts = 0;
 vi.stubGlobal('WebSocket', class { constructor() { attempts++; throw Error('socket unavailable'); } });
 vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 503 })));
 const t = createToggly(initial, { appKey: 'frontend', refreshInterval: 0, onError: () => {
  if (mode === 'throw') throw Error('observer failed');
  return Promise.reject(Error('observer rejected'));
 } });
 await expect(t.start()).resolves.toBeUndefined();
 await vi.advanceTimersByTimeAsync(5000);
 expect(attempts).toBe(2);
 t.dispose();
 await vi.advanceTimersByTimeAsync(10000);
 expect(attempts).toBe(2);
 expect(vi.getTimerCount()).toBe(0);
});
