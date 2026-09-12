import { describe, it, expect, vi } from 'vitest';
import { createClient } from '../src/client';

describe('client ownership and evaluation', () => {
  it('uses defaults, missing false, all/any/negate and empty gate', async () => {
    const client = createClient({ flagDefaults: { enabled: true, disabled: false } });
    await client.refresh();
    expect(client.evaluate(['enabled'])).toBe(true);
    expect(client.evaluate(['missing'])).toBe(false);
    expect(client.evaluate(['enabled','disabled'], 'all')).toBe(false);
    expect(client.evaluate(['enabled','disabled'], 'any')).toBe(true);
    expect(client.evaluate(['disabled'], 'all', true)).toBe(true);
    expect(client.evaluate([])).toBe(true);
    client.dispose();
  });
  it('sends targeting and rejects stale identity responses', async () => {
    let resolveOld!: (response: Response) => void;
    const fetcher = vi.fn().mockImplementationOnce(() => new Promise(r => resolveOld = r))
      .mockResolvedValue(new Response(JSON.stringify({ Fresh: true })));
    const client = createClient({ appKey: 'test', verifySignatures: false, fetch: fetcher, identity: 'old', enableLiveUpdates: false });
    const old = client.refresh();
    await client.setContext({ identity: 'new', groups:['staff'], claims:{tier:'pro'} });
    resolveOld(new Response(JSON.stringify({ Old: true })));
    await old;
    expect(client.flags()).toEqual({ Fresh:true });
    const url = new URL(fetcher.mock.calls[1][0]);
    expect(url.searchParams.get('u')).toBe('new');
    expect(url.searchParams.get('g')).toBe('staff');
    expect(url.searchParams.get('claim.tier')).toBe('pro');
    client.dispose();
  });
});

describe('transport and lifecycle', () => {
  it('reports network and invalid body failures with defaults', async () => {
    for (const response of [new Error('offline'), new Response('[]'), new Response('broken'), new Response('{}',{status:500})]) {
      const fetcher = response instanceof Error ? vi.fn().mockRejectedValue(response) : vi.fn().mockResolvedValue(response);
      const c=createClient({appKey:'test',verifySignatures:false,fetch:fetcher,flagDefaults:{safe:false}});
      await c.refresh(); expect(c.state().error).toBeInstanceOf(Error); expect(c.flags()).toEqual({safe:false}); c.dispose();
    }
  });
  it('rejects unsigned definitions by default', async () => {
    const c=createClient({appKey:'test',fetch:vi.fn().mockResolvedValue(new Response('{"unsafe":true}'))});
    await c.refresh(); expect(c.evaluate(['unsafe'])).toBe(false); expect(c.state().error).toBeDefined(); c.dispose();
  });
  it('sends conditional revisions and retains a verified in-memory snapshot on 304/failure', async () => {
    const f=vi.fn().mockResolvedValueOnce(new Response('{"on":true}',{headers:{ETag:'rev1'}})).mockResolvedValueOnce(new Response(null,{status:304})).mockRejectedValue(new Error('offline'));
    const c=createClient({appKey:'test',verifySignatures:false,fetch:f});
    await c.refresh(); await c.refresh();
    expect(f.mock.calls[1][1].headers['If-None-Match']).toBe('rev1');
    await c.refresh(); expect(c.evaluate(['on'])).toBe(true); c.dispose();
  });
  it('applies entity and local gates, notifies subscribers and isolates options', async () => {
    let allowed=false;
    const f=vi.fn().mockResolvedValue(new Response(JSON.stringify({ExpressCheckout:{requirement:'all',rules:[{property:'Vip',op:'eq',value:'true',type:'boolean'}]},on:true})));
    const c=createClient({appKey:'test',verifySignatures:false,fetch:f});
    const listener=vi.fn(); const unsubscribe=c.subscribe(listener);
    await c.refresh();
    expect(c.evaluate(['ExpressCheckout'])).toBe(false);
    expect(c.evaluate(['ExpressCheckout'],'all',false,{kind:'Order',key:'1',attributes:{Vip:true}})).toBe(true);
    c.setLocalGates([{id:'device',flagKeys:['on'],isEnabled:()=>allowed}]);
    expect(c.evaluate(['on'])).toBe(false); allowed=true; c.notifyLocalGatesChanged(); expect(c.evaluate(['on'])).toBe(true);
    expect(()=>c.setLocalGates([{id:'1',flagKeys:['on'],isEnabled:()=>true},{id:'2',flagKeys:['on'],isEnabled:()=>true}])).toThrow();
    unsubscribe(); listener.mockClear(); c.notifyLocalGatesChanged(); expect(listener).not.toHaveBeenCalled(); c.dispose();
  });
  it('copies targeting, clears it explicitly and does no work after dispose', async () => {
    const groups=['team']; const claims={role:'admin'};
    const c=createClient({groups,claims,flagDefaults:{on:true}});
    groups.push('changed'); claims.role='user';
    expect(c.context()).toEqual({identity:undefined,groups:['team'],claims:{role:'admin'}});
    await c.setContext({identity:'',groups:[],claims:{}}); expect(c.context().groups).toEqual([]);
    c.dispose(); await c.setContext({identity:'ignored'}); expect(c.context().identity).toBe(''); c.start();
  });
  it('cancels pending requests and never emits after disposal', async () => {
    let resolve!: (value:Response)=>void;
    const f=vi.fn(() => new Promise<Response>(r=>resolve=r));
    const c=createClient({appKey:'test',fetch:f,verifySignatures:false}); const listener=vi.fn(); c.subscribe(listener);
    const pending=c.refresh(); c.dispose(); listener.mockClear(); resolve(new Response('{"late":true}')); await pending;
    expect(f.mock.calls[0][1].signal.aborted).toBe(true); expect(listener).not.toHaveBeenCalled(); expect(c.flags()).toEqual({});
  });
  it('enforces request timeout', async () => {
    vi.useFakeTimers();
    const f=vi.fn((_url,init)=>new Promise<Response>((_,reject)=>init.signal.addEventListener('abort',()=>reject(new Error('aborted')))));
    const c=createClient({appKey:'test',fetch:f,connectTimeout:20}); const pending=c.refresh();
    await vi.advanceTimersByTimeAsync(25); await pending; expect(c.state().error?.message).toBe('aborted'); c.dispose(); vi.useRealTimers();
  });
  it('handles live invalidation, revision pins, reconnects and cleanup', async () => {
    vi.useFakeTimers();
    class Socket { static all: Socket[]=[]; onmessage:any; onclose:any; close=vi.fn(); constructor(public url:any){ Socket.all.push(this); } }
    vi.stubGlobal('WebSocket', Socket);
    const f=vi.fn(()=>Promise.resolve(new Response('{"on":true}',{headers:{ETag:'old'}})));
    const c=createClient({appKey:'test',verifySignatures:false,fetch:f,refreshInterval:10000});
    await c.refresh(); c.start(); c.start(); expect(Socket.all).toHaveLength(1);
    const s=Socket.all[0]; expect(String(s.url)).toContain('rev=old');
    for(const data of ['bad','{"type":"ping"}','{"type":"sync","unchanged":true}','{"type":"update","etag":"old"}']) s.onmessage({data});
    await vi.advanceTimersByTimeAsync(300); expect(f).toHaveBeenCalledTimes(1);
    s.onmessage({data:'{"type":"flags-updated","etag":"new"}'}); await vi.advanceTimersByTimeAsync(300);
    expect(String(f.mock.calls[1][0])).toContain('rev=new'); expect(f.mock.calls[1][1].headers['If-None-Match']).toBeUndefined();
    s.onmessage({data:'{"type":"signing-key-updated"}'}); await vi.advanceTimersByTimeAsync(300);
    s.onmessage({data:'{"type":"sync","etag":"another"}'}); await vi.advanceTimersByTimeAsync(300);
    s.onclose(); await vi.advanceTimersByTimeAsync(5000); expect(Socket.all).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(10000); expect(f.mock.calls.length).toBeGreaterThan(4);
    c.dispose(); expect(Socket.all[1].close).toHaveBeenCalled(); expect(Socket.all[1].onclose).toBeNull();
    vi.unstubAllGlobals(); vi.useRealTimers();
  });
  it.each(['update', 'flags-updated', '{"type":"update"}', '{"type":"flags-updated"}'])('fetches unconditionally after legacy invalidation %s', async data => {
    vi.useFakeTimers();
    class Socket { static current: Socket; onmessage: any; onclose: any; close() {} constructor() { Socket.current=this; } }
    vi.stubGlobal('WebSocket', Socket);
    // A stale conditional request would return 304 and leave the previous flag off.
    const f=vi.fn((_url, init) => Promise.resolve(init.headers['If-None-Match']
      ? new Response(null, {status:304})
      : new Response(JSON.stringify({on:f.mock.calls.length > 1}), {headers:{ETag:'old'}})));
    const c=createClient({appKey:'test', verifySignatures:false, fetch:f, refreshInterval:0});
    try {
      await c.refresh(); c.start();
      expect(c.evaluate(['on'])).toBe(false);
      Socket.current.onmessage({data});
      await vi.advanceTimersByTimeAsync(300);
      expect(f).toHaveBeenCalledTimes(2);
      expect(f.mock.calls[1][1].headers['If-None-Match']).toBeUndefined();
      expect(f.mock.calls[1][1].cache).toBe('no-store');
      expect(c.evaluate(['on'])).toBe(true);
    } finally { c.dispose(); vi.unstubAllGlobals(); vi.useRealTimers(); }
  });
  it('retries unavailable sockets and permits HTTP-only runtimes', async () => {
    vi.useFakeTimers(); const attempts=vi.fn(); vi.stubGlobal('WebSocket',class {constructor(){attempts();throw new Error('blocked')}});
    const c=createClient({appKey:'test',refreshInterval:0}); c.start(); expect(attempts).toHaveBeenCalledTimes(1); await vi.advanceTimersByTimeAsync(5000); expect(attempts).toHaveBeenCalledTimes(2); c.dispose(); await vi.advanceTimersByTimeAsync(5000); expect(attempts).toHaveBeenCalledTimes(2);
    vi.stubGlobal('WebSocket',undefined); const d=createClient({appKey:'test',refreshInterval:0}); d.start(); expect(d.state().error).toBeUndefined(); d.dispose();
    vi.unstubAllGlobals(); vi.useRealTimers();
  });
});

describe('verified envelope caching', () => {
  it('verifies signed startup, rejects tampering and isolates cache by context', async () => {
    const { webcrypto } = await import('node:crypto');
    const { computeKid } = await import('@ops-ai/toggly-signed-defs');
    vi.stubGlobal('crypto',webcrypto);
    vi.stubGlobal('process', {...process, versions:{...process.versions,node:undefined}});
    const pair = await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
    const publicKey = await webcrypto.subtle.exportKey('jwk',pair.publicKey);
    const kid = await computeKid(publicKey.x!, publicKey.y!);
    const raw='{"signed":true}'; const timestamp=Math.floor(Date.now()/1000);
    const signature = Buffer.from(await webcrypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},pair.privateKey,await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(`${raw}|${timestamp}`)))).toString('base64');
    const envelope=JSON.stringify({defs:JSON.parse(raw),timestamp,kid,signature});
    const map=new Map<string,string>(); const storage={getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>{map.set(k,v)}};
    let offline=false;
    const f=vi.fn((url:any)=> offline ? Promise.reject(new Error('offline')) : String(url).includes('.well-known') ? Promise.resolve(new Response(JSON.stringify({keys:[{...publicKey,kid,alg:'ES256'}]}))) : Promise.resolve(new Response(envelope)));
    const c=createClient({appKey:'test',identity:'alice',fetch:f,storage}); await c.refresh();
    expect(c.state().error).toBeUndefined(); expect(c.evaluate(['signed'])).toBe(true); expect(map.size).toBe(2); c.dispose();
    offline=true;
    const cached=createClient({appKey:'test',identity:'alice',fetch:f,storage}); await cached.refresh(); expect(cached.evaluate(['signed'])).toBe(true); cached.dispose();
    const bob=createClient({appKey:'test',identity:'bob',fetch:f,storage}); await bob.refresh(); expect(bob.evaluate(['signed'])).toBe(false); bob.dispose();
    for(const [key,value] of map) map.set(key,value.replace('true','false'));
    const tampered=createClient({appKey:'test',identity:'alice',fetch:f,storage}); await tampered.refresh(); expect(tampered.flags()).toEqual({}); tampered.dispose();
    vi.unstubAllGlobals();
  });
  it('ignores inaccessible storage and never trusts unsigned persisted data', async () => {
    const storage={getItem:()=>{throw new Error('denied')},setItem:()=>{throw new Error('quota')}};
    const c=createClient({appKey:'test',storage,fetch:vi.fn().mockRejectedValue(new Error('offline'))}); await c.refresh(); expect(c.flags()).toEqual({}); c.dispose();
  });
});

it.each(['visible','unexposed'])('retains verified browser state and revision after a signed malformed %s gate',async keyName=>{
 const {webcrypto}=await import('node:crypto');const {computeKid}=await import('@ops-ai/toggly-signed-defs');
 const pair=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
 const key=await webcrypto.subtle.exportKey('jwk',pair.publicKey);const kid=await computeKid(key.x!,key.y!);
 async function sign(defs:unknown){const raw=JSON.stringify(defs);const timestamp=Math.floor(Date.now()/1000);return JSON.stringify({defs,timestamp,kid,signature:Buffer.from(await webcrypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},pair.privateKey,await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(`${raw}|${timestamp}`)))).toString('base64')});}
 let malformed=false;const calls:any[]=[];
 const f=vi.fn(async(url,init)=>{if(String(url).includes('.well-known'))return new Response(JSON.stringify({keys:[{...key,kid,alg:'ES256'}]}));calls.push(init);return new Response(await sign(malformed?{visible:true,[keyName]:{requirement:'all',rules:[{property:'Vip'}]}}:{visible:true}),{headers:{ETag:malformed?'bad-rev':'good-rev'}});});
 const c=createClient({appKey:'front',fetch:f,expose:['visible']});
 try{await c.refresh();expect(c.flags()).toEqual({visible:true});malformed=true;await c.refresh();expect(c.flags()).toEqual({visible:true});expect(c.state().error).toBeInstanceOf(Error);expect(c.evaluate(['visible'],'all',false,{kind:'Order',key:'1',attributes:{Vip:true}})).toBe(true);await c.refresh();expect(calls.at(-1).headers['If-None-Match']).toBe('good-rev');}finally{c.dispose();}
});
