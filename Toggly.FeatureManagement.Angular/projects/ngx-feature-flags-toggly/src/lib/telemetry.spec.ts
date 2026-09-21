import { ChangeDetectorRef, NgZone, TemplateRef, ViewContainerRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router } from '@angular/router';
import { evaluationContextCacheKey } from '@ops-ai/toggly-hooks-types';
import { TogglyService } from './toggly.service';
import { TogglyOptions, provideToggly } from './toggly-options';
import { FeatureComponent } from './feature.component';
import { FeatureFlagDirective } from './feature.directive';
import { FeatureGateBuilderDirective } from './feature-gate-builder.directive';
import { FeatureVariantDirective } from './feature-variant.directive';
import { NgxFeatureFlagsTogglyModule } from './ngx-feature-flags-toggly.module';
import { FeatureFlagGuard, featureFlagGuard } from './feature.guard';

type Service = TogglyService;
type Options = TogglyOptions;
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

describe('Angular frontend telemetry', () => {
  let services: Service[];
  let definitions: Record<string, unknown>;
  let sent: { url: string; init: RequestInit; body: any; inZone: boolean }[];
  let definitionRequests: string[];
  let compression: typeof CompressionStream;
  let zone: NgZone;
  function create(options: Options = {}, platform = 'browser'): Service {
    const service = zone.run(() => new TogglyService({ appKey:'telemetry-test', environment:'Production', persistCache:false, ...options }, zone, platform as unknown as object)) as Service;
    services.push(service); return service;
  }
  beforeEach(() => {
    services = []; sent = []; definitionRequests = [];
    definitions = { On:true, Off:false };
    localStorage.clear();
    zone = new NgZone({ enableLongStackTrace:false });
    compression = globalThis.CompressionStream;
    Object.defineProperty(globalThis, 'CompressionStream', { configurable:true, writable:true, value:undefined });
    spyOn(globalThis, 'WebSocket').and.callFake(function () { return { close() {} } as WebSocket; });
    spyOn(globalThis, 'fetch').and.callFake(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/frontend/telemetry')) {
        sent.push({ url, init:init!, body:JSON.parse(init!.body as string), inZone:NgZone.isInAngularZone() });
        return { status:202 } as Response;
      }
      definitionRequests.push(url);
      return { ok:true, status:200, json:async () => definitions, text:async () => JSON.stringify(definitions) } as Response;
    });
  });
  afterEach(async () => {
    for (const service of services) service.ngOnDestroy();
    await settle();
    Object.defineProperty(globalThis, 'CompressionStream', { configurable:true, writable:true, value:compression });
  });
  it('canonicalizes group cache keys with stable UTF-16 ordering across input permutations', () => {
    const groups = ['ä', '2', 'A', '😀', 'a', '10', 'Z', 'a'];
    const original = [...groups];
    const first = create({ identity:'alice', groups, enableTelemetry:false });
    const reversed = create({ identity:'alice', groups:[...groups].reverse(), enableTelemetry:false });
    const expected = `v2:${encodeURIComponent(JSON.stringify(['alice', ['10', '2', 'A', 'Z', 'a', 'a', 'ä', '😀'], []]))}`;
    expect((first as any)._contextCacheKey).toBe(expected);
    expect((reversed as any)._contextCacheKey).toBe(expected);
    expect(groups).toEqual(original);
  });
  it('records direct checks once, before negation, with client attribution but no definitions headers', async () => {
    const service = create({ identity:'private-user', groups:['private-group'], claims:{role:'private-role'} });
    expect(await service.isFeatureOn('On')).toBeTrue();
    expect(await service.isFeatureOff('Off')).toBeTrue();
    await service.flushTelemetry();
    expect(sent.map(x => x.body)).toEqual([{k:'telemetry-test',e:'Production',u:'private-user',f:{On:{enabled:[1]},Off:{disabled:[1]}}}]);
    expect(sent[0].url).toBe('https://metrics.toggly.io/api/frontend/telemetry');
    expect(sent[0].init.credentials).toBe('omit');
    expect(sent[0].init.headers).toEqual({'Content-Type':'application/json'});
    expect(JSON.stringify(sent)).not.toContain('private-group'); expect(JSON.stringify(sent)).not.toContain('private-role');
  });
  it('preserves all/any short circuiting and counts every evaluated leaf', async () => {
    const service = create();
    expect(await service.evaluateFeatureGate(['Off','On'],'all',true)).toBeTrue();
    expect(await service.evaluateFeatureGate(['On','Off'],'any')).toBeTrue();
    expect(await service.evaluateFeatureGate(['On','Off'],'all')).toBeFalse();
    await service.flushTelemetry();
    expect(sent[0].body.f).toEqual({Off:{disabled:[2]},On:{enabled:[2]}});
  });
  it('counts entity and local gate outcomes without recomputing skipped gates', async () => {
    definitions = { On:true, Entity:{ requirement:'all',rules:[{property:'role',op:'eq',value:'admin',type:'string'}]} };
    const local = jasmine.createSpy('local').and.returnValue(false);
    const service = create({ localGates:[{id:'local',flagKeys:['On'],isEnabled:local}] });
    expect(await service.isFeatureOn('On')).toBeFalse();
    expect(await service.isFeatureOn('Entity',{kind:'User',key:'secret',attributes:{role:'admin'}})).toBeTrue();
    expect(await service.isFeatureOn('Entity')).toBeFalse();
    await service.flushTelemetry();
    expect(sent[0].body.f).toEqual({On:{disabled:[1]},Entity:{enabled:[1],disabled:[1]}});
    expect(local).toHaveBeenCalledTimes(1);
  });
  it('counts assigned variants on booleans and delegated value APIs exactly once', async () => {
    definitions = {On:{enabled:true,variant:'experiment-a',configurationValue:42},Off:{enabled:false,variant:'experiment-b'},NoVariant:{enabled:true}};
    const service = create({ enableVariants:true });
    expect(await service.isFeatureOn('On')).toBeTrue();
    expect(await service.getVariant('On')).toEqual({name:'experiment-a',configurationValue:42});
    expect(await service.getVariantValue('On')).toBe(42);
    expect(await service.getVariant('Off')).toBeNull();
    expect(await service.getVariant('NoVariant')).toBeNull();
    await service.flushTelemetry();
    expect(sent[0].body.f).toEqual({On:{'experiment-a':[3]},Off:{disabled:[1]},NoVariant:{enabled:[1]}});
  });
  it('records variant local denial as disabled without remapping an assigned experiment', async () => {
    definitions = {On:{enabled:true,variant:'experiment-a'}};
    const service = create({ enableVariants:true,localGates:[{id:'deny',flagKeys:['On'],isEnabled:() => false}] });
    expect(await service.getVariantValue('On')).toBeNull(); await service.flushTelemetry();
    expect(sent[0].body.f).toEqual({On:{disabled:[1]}});
  });
  it('exposes explicit usage/view/counter/gauge methods without evaluating flags', async () => {
    const service = create(); const evaluation = spyOn(service,'isFeatureOn').and.callThrough();
    service.recordUsage('On'); service.recordView('On','experiment-a'); service.incrementCounter('orders'); service.incrementCounter('orders',2); service.setGauge('cart',9); service.setGauge('cart',3);
    await service.flushTelemetry();
    expect(sent[0].body).toEqual({k:'telemetry-test',e:'Production',f:{On:{enabled:[0,1],'experiment-a':[0,0,1]}},m:{orders:3,cart:3}});
    expect(evaluation).not.toHaveBeenCalled(); expect(definitionRequests).toEqual([]);
  });
  it('keeps hydration, refresh and context replacement silent until evaluation', async () => {
    localStorage.setItem(`toggly:flags:telemetry-test:Production:${evaluationContextCacheKey({identity:'cached-user'})}`, JSON.stringify({Cached:true}));
    const service = create({persistCache:true,identity:'cached-user'}); await service.flushTelemetry(); expect(sent).toEqual([]);
    await service.setContext({identity:'new-user'}); await service.flushTelemetry(); expect(sent).toEqual([]);
    service.notifyLocalGatesChanged(); await service.flushTelemetry(); expect(sent).toEqual([]);
    await service.isFeatureOn('On'); await service.flushTelemetry(); expect(sent[0].body.f.On.enabled).toEqual([1]);
  });
  it('records a cached decision after a failed fetch without recording hydration', async () => {
    localStorage.setItem(`toggly:flags:telemetry-test:Production:${evaluationContextCacheKey({identity:'cached-user'})}`, JSON.stringify({Cached:true}));
    (globalThis.fetch as jasmine.Spy).and.callFake(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!String(input).includes('/api/frontend/telemetry')) throw new Error('offline definitions');
      sent.push({url:String(input),init:init!,body:JSON.parse(init!.body as string),inZone:NgZone.isInAngularZone()});
      return {status:202} as Response;
    });
    spyOn(console, 'warn'); spyOn(console, 'error');
    const service = create({persistCache:true,identity:'cached-user'});
    await service.flushTelemetry(); expect(sent).toEqual([]);
    expect(await service.isFeatureOn('Cached')).toBeTrue(); await service.flushTelemetry();
    expect(sent[0].body.f).toEqual({Cached:{enabled:[1]}});
  });
  for (const [name,options,platform] of [['opt-out',{enableTelemetry:false},'browser'],['no-key',{appKey:undefined,featureDefaults:{On:true}},'browser'],['server',{},'server']] as const) {
    it(`${name} creates no telemetry timer/listener/request`, async () => {
      const timeout = spyOn(globalThis,'setTimeout').and.callThrough();
      const windowListener = spyOn(window,'addEventListener').and.callThrough();
      const documentListener = spyOn(document,'addEventListener').and.callThrough();
      const service = create(options,platform); service.recordUsage('On'); service.setGauge('cart',2); await service.isFeatureOn('On'); await service.flushTelemetry(); service.ngOnDestroy(); await settle();
      expect(sent).toEqual([]);
      expect(timeout.calls.allArgs().filter(args => Number(args[1]) >= 30000)).toEqual([]);
      expect(windowListener.calls.allArgs().filter(args => args[0] === 'pagehide')).toEqual([]);
      expect(documentListener.calls.allArgs().filter(args => args[0] === 'visibilitychange')).toEqual([]);
    });
  }
  it('runs reporter timers, manual flush, lifecycle flush and disposal outside Angular', async () => {
    const timerZones: boolean[] = []; const original = globalThis.setTimeout;
    spyOn(globalThis,'setTimeout').and.callFake(((callback: TimerHandler, delay?: number, ...args: unknown[]) => {
      if (delay === 5000 || Number(delay) >= 30000) timerZones.push(NgZone.isInAngularZone());
      return original(callback,delay,...args);
    }) as typeof setTimeout);
    const service = create(); zone.run(() => service.recordUsage('On')); await zone.run(() => service.flushTelemetry());
    zone.run(() => { service.recordUsage('On'); window.dispatchEvent(new Event('pagehide')); }); await settle();
    zone.run(() => {service.recordUsage('On'); service.ngOnDestroy();}); await settle();
    expect(sent.length).toBe(3); expect(sent.every(x => !x.inZone)).toBeTrue();
    expect(timerZones.length).toBeGreaterThan(0); expect(timerZones.every(value => !value)).toBeTrue();
    const count = sent.length; window.dispatchEvent(new Event('pagehide')); service.recordUsage('On'); await service.flushTelemetry(); expect(sent.length).toBe(count);
  });
  it('owns distinct application contexts and replacement never relabels pending events', async () => {
    const first = create({appKey:'old',environment:'Staging'}); const second = create({appKey:'new',metricsBaseUrl:'https://collector.test/base/'});
    first.recordUsage('On'); second.recordUsage('On'); first.ngOnDestroy(); await settle(); await second.flushTelemetry();
    expect(sent.map(x => [x.body.k,x.body.e,x.url])).toEqual([['old','Staging','https://metrics.toggly.io/api/frontend/telemetry'],['new','Production','https://collector.test/base/api/frontend/telemetry']]);
  });
  it('forwards standalone configuration to the owner without a second reporter', async () => {
    TestBed.configureTestingModule({ providers:[provideToggly({appKey:'standalone',environment:'Preview',persistCache:false,metricsBaseUrl:'https://collector.test'} as Options)] });
    const service = TestBed.inject(TogglyService) as Service; services.push(service); service.recordUsage('On'); await service.flushTelemetry();
    expect(sent.length).toBe(1); expect(sent[0].body.k).toBe('standalone'); expect(sent[0].url).toBe('https://collector.test/api/frontend/telemetry');
  });
  it('forwards NgModule options and a configured interval outside Angular', async () => {
    const timeout = spyOn(globalThis, 'setTimeout').and.callThrough();
    TestBed.configureTestingModule({ imports: [NgxFeatureFlagsTogglyModule.forRoot({
      appKey: 'module', metricsBaseUrl: 'https://collector.test/base', telemetryFlushIntervalMs: 60000,
    })] });
    const service = TestBed.inject(TogglyService); services.push(service);
    service.recordView('On'); await service.flushTelemetry();
    expect(sent[0].body.k).toBe('module');
    expect(sent[0].url).toBe('https://collector.test/base/api/frontend/telemetry');
    expect(timeout.calls.allArgs().some(args => Number(args[1]) >= 48000 && Number(args[1]) <= 72000)).toBeTrue();
  });
  it('invalid telemetry configuration and throwing diagnostics cannot prevent evaluation', async () => {
    const onError = jasmine.createSpy('diagnostic').and.throwError('host callback failed');
    const service = create({ metricsBaseUrl: 'https://collector.test?', telemetryFlushIntervalMs: 0, onError });
    expect(await service.isFeatureOn('On')).toBeTrue();
    service.recordUsage('On'); await service.flushTelemetry();
    expect(sent).toEqual([]); expect(onError).toHaveBeenCalled();
  });
  it('routes both guards through a single authoritative leaf evaluation', async () => {
    const service = create(); const router = {navigate:() => Promise.resolve(true),createUrlTree:() => ({})} as unknown as Router;
    const route = {data:{featureFlag:['On','Off'],featureFlagRequirement:'any'}} as unknown as ActivatedRouteSnapshot;
    expect(await new FeatureFlagGuard(service,router).canActivate(route)).toBeTrue();
    TestBed.configureTestingModule({providers:[{provide:TogglyService,useValue:service},{provide:Router,useValue:router}]});
    expect(await TestBed.runInInjectionContext(() => featureFlagGuard(route,{} as never))).toBeTrue();
    await service.flushTelemetry(); expect(sent[0].body.f).toEqual({On:{enabled:[2]}});
  });
  for (const renderer of ['component','flag','builder','variant']) {
    it(`${renderer} recomputation counts once per leaf and teardown unsubscribes`, async () => {
      definitions = {On:{enabled:true,variant:'control'}};
      const service = create({enableVariants:true}); await service.getVariant('On'); await service.flushTelemetry(); sent.length = 0;
      const detector = {markForCheck() {}} as ChangeDetectorRef;
      const template = {} as TemplateRef<unknown>;
      const container = {createEmbeddedView:() => ({context:{$implicit:true,enabled:true},markForCheck() {}}),clear() {}} as unknown as ViewContainerRef;
      const component = new FeatureComponent(service,detector); component.featureKey = 'On';
      const flag = new FeatureFlagDirective(template,container,service,detector);
      const builder = new FeatureGateBuilderDirective(template as never,container,service,detector);
      const variant = new FeatureVariantDirective(template as never,container,service,detector); variant.featureVariant = 'On'; variant.variant = 'control';
      const instance = {component,flag,builder,variant}[renderer]!;
      if (renderer === 'flag') flag.featureFlag = 'On';
      if (renderer === 'builder') builder.featureGateBuilder = 'On';
      instance.ngOnInit(); if (renderer === 'component') component.ngOnChanges({});
      await settle(); await service.flushTelemetry(); sent.length = 0;
      service.notifyLocalGatesChanged(); await settle(); await service.flushTelemetry();
      expect(sent.length).toBe(1); expect(sent[0].body.f).toEqual({On:{control:[1]}});
      instance.ngOnDestroy(); sent.length = 0; service.notifyLocalGatesChanged(); await settle(); await service.flushTelemetry(); expect(sent).toEqual([]);
    });
  }
  it('seals old attribution and gauges through token rotation and logout', async () => {
    const service = create({identity:'alice',instanceId:'mint-a'} as Options);
    service.setGauge('cart',1);
    await service.setContext({instanceId:'mint-b'} as any); service.setGauge('cart',2);
    await service.setContext({identity:'bob'}); service.setGauge('cart',3);
    await service.setContext({identity:''}); service.setGauge('cart',4);
    await service.flushTelemetry();
    expect(sent.map(x => [x.body.i,x.body.u,x.body.m.cart])).toEqual([
      ['mint-a',undefined,1],['mint-b',undefined,2],[undefined,'bob',3],[undefined,undefined,4],
    ]);
  });
  it('uses only minted targeting in inherited URLs and separates token caches and revisions', async () => {
    const service = create({persistCache:true,identity:'alice',instanceId:'mint-a',groups:['staff'],claims:{role:'admin'},customDefinitionsUrl:'https://definitions.test/flags?u=old&userId=old&g=old&claim.role=old&extra=keep&i=old'} as Options);
    await service.isFeatureOn('On');
    const first = new URL(definitionRequests[0]);
    expect(first.searchParams.get('i')).toBe('mint-a'); expect(first.searchParams.get('extra')).toBe('keep');
    for (const key of ['u','userId','g','claim.role']) expect(first.searchParams.has(key)).toBeFalse();
    const oldKey = (service as any)._flagsCacheKey;
    (service as any)._cacheDefinitionsRevision('old-revision');
    await service.setContext({instanceId:'mint-b'} as any);
    expect((service as any)._flagsCacheKey).not.toBe(oldKey);
    expect((service as any)._definitionsRevision).not.toBe('old-revision');
    await service.setContext({instanceId:''} as any);
    const last = new URL(definitionRequests[definitionRequests.length-1]);
    expect(last.searchParams.has('i')).toBeFalse(); expect(last.searchParams.get('u')).toBe('alice');
  });
  it('captures attribution and assigned variant before reentrant local gates', async () => {
    definitions = {On:{enabled:true,variant:'old-variant'}};
    const service = create({identity:'alice',enableVariants:true});
    await service.getVariant('On'); await service.flushTelemetry(); sent.length=0;
    let transition: Promise<void> | undefined;
    service.setLocalGates([{id:'reenter',flagKeys:['On'],isEnabled:() => {
      definitions={On:{enabled:true,variant:'new-variant'}};
      transition=service.setContext({identity:'bob'}); service.recordUsage('New'); return true;
    }}]);
    expect(await service.getVariant('On')).toEqual({name:'old-variant',configurationValue:undefined});
    await transition; await service.flushTelemetry();
    expect(sent.find(x=>x.body.u==='alice')?.body.f.On).toEqual({'old-variant':[1]});
    expect(sent.find(x=>x.body.u==='bob')?.body.f.New).toEqual({enabled:[0,1]});
  });
  it('ignores late responses across ABA transitions and destruction', async () => {
    const pending: Array<(value:Response)=>void> = [];
    (globalThis.fetch as jasmine.Spy).and.callFake(() => new Promise<Response>(resolve=>pending.push(resolve)));
    const service=create({identity:'alice'});
    const first=service.setContext({identity:'alice'}); await settle();
    const second=service.setContext({identity:'bob'}); await settle();
    const third=service.setContext({identity:'alice'}); await settle();
    expect(pending.length).toBe(3);
    const response=(defs:any)=>({ok:true,status:200,text:async()=>JSON.stringify(defs)}) as Response;
    pending[2]?.(response({Current:true})); await third;
    pending[0]?.(response({Stale:true})); pending[1]?.(response({Stale:true})); await Promise.all([first,second]);
    expect((service as any)._features).toEqual({Current:true});
    const last=service.setContext({identity:'after'}); await settle(); service.ngOnDestroy();
    pending[3]?.(response({Resurrected:true})); await last;
    expect((service as any)._features).not.toEqual({Resurrected:true});
  });
  it('keeps in-flight retry bytes and immediate new-user events separate', async () => {
    const originalTimeout=globalThis.setTimeout;
    spyOn(globalThis,'setTimeout').and.callFake(((callback: TimerHandler, delay?: number, ...args: unknown[]) =>
      originalTimeout(callback,delay===30000 ? 0 : delay,...args)) as typeof setTimeout);
    let firstResponse: (value:Response)=>void = () => {};
    (globalThis.fetch as jasmine.Spy).and.callFake(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!String(input).includes('/api/frontend/telemetry')) return {ok:true,status:200,text:async()=>JSON.stringify(definitions)} as Response;
      sent.push({url:String(input),init:init!,body:JSON.parse(init!.body as string),inZone:NgZone.isInAngularZone()});
      if(sent.length===1) return new Promise<Response>(resolve=>firstResponse=resolve);
      return {status:202} as Response;
    });
    const service=create({identity:'alice'}); service.setGauge('cart',1);
    const flush=service.flushTelemetry(); await settle();
    await service.setContext({identity:'bob'}); service.setGauge('cart',2);
    firstResponse({status:429} as Response); await flush; await service.flushTelemetry();
    expect(sent.map(x=>[x.body.u,x.body.m.cart])).toEqual([['alice',1],['alice',1],['bob',2]]);
    expect(sent[0].init.body).toBe(sent[1].init.body);
  });
  it('retains one reporter and one global bound through rapid rotations', async () => {
    const diagnostic=jasmine.createSpy('diagnostic');
    const service=create({identity:'start',onError:diagnostic}); const reporter=(service as any)._telemetry;
    for(let index=0;index<2200;index++) {
      await service.setContext({identity:`fixture-${index}`}); service.incrementCounter('orders');
    }
    expect((service as any)._telemetry).toBe(reporter);
    expect(diagnostic.calls.allArgs().some(args=>String(args[0]).includes('buffer-full'))).toBeTrue();
    await service.flushTelemetry();
    expect(sent.length).toBeGreaterThan(0); expect(sent.length).toBeLessThanOrEqual(2000);
    expect(sent.reduce((total,x)=>total+new TextEncoder().encode(JSON.stringify(x.body)).length,0)).toBeLessThanOrEqual(262144);
    expect(sent.every(x=>x.body.m.orders===1)).toBeTrue();
  });
  it('captures before identity-changing hooks and rejects another service snapshot', async () => {
    const service=create({identity:'alice'}); const other=create({identity:'other'});
    await service.isFeatureOn('On'); await service.flushTelemetry(); sent.length=0;
    service.addHook({getMetadata:()=>({name:'reentrant'}),beforeEvaluation:async()=>{
      await service.setContext({identity:'bob'}); return undefined;
    }} as any);
    expect(await service.isFeatureOn('On')).toBeTrue();
    expect((other as any)._getEffectiveFlagValue('On',undefined,(service as any)._captureEvaluation())).toBeFalse();
    await service.flushTelemetry(); await other.flushTelemetry();
    expect(sent.map(x=>x.body.u)).toEqual(['alice']);
  });
  it('failed identity refresh cannot restore the previous token or definitions', async () => {
    const service=create({identity:'alice',instanceId:'mint-a'} as Options); await service.isFeatureOn('On');
    (globalThis.fetch as jasmine.Spy).and.rejectWith(new Error('offline'));
    await expectAsync(service.setContext({identity:'bob'})).toBeRejected();
    expect((service as any)._config.identity).toBe('bob'); expect((service as any)._config.instanceId).toBeUndefined();
    expect((service as any)._features).toEqual({});
  });

  it('captures before reentrant entity mapping changes identity and flags', async () => {
    const service=create({identity:'alice'});
    await service.isFeatureOn('On'); await service.flushTelemetry(); sent.length=0;
    let transition: Promise<void> | undefined;
    service.registerContext('TelemetryReentrantMapper', () => {
      definitions={On:false}; transition=service.setContext({identity:'bob'});
      return {kind:'User',key:'fixture',attributes:{}};
    });
    expect(await service.isFeatureOn('On',{},'TelemetryReentrantMapper')).toBeTrue();
    await transition; await service.flushTelemetry();
    expect(sent.map(x=>[x.body.u,x.body.f.On])).toEqual([['alice',{enabled:[1]}]]);
  });

  it('hydrates the matching persisted token snapshot before accepting a 304 on return', async () => {
    const service=create({persistCache:true,instanceId:'mint-a'});
    await service.isFeatureOn('On'); (service as any)._cacheDefinitionsRevision('revision-a');
    definitions={On:false}; await service.setContext({instanceId:'mint-b'});
    let revision: string | null = null;
    (globalThis.fetch as jasmine.Spy).and.callFake(async (_input: RequestInfo | URL, init?: RequestInit) => {
      revision=new Headers(init?.headers).get('If-None-Match');
      return {ok:false,status:304} as Response;
    });
    await service.setContext({instanceId:'mint-a'});
    expect(revision).toBeTruthy(); expect((service as any)._features.On).toBeTrue();
  });

  it('isolates response modes and rejects orphan persisted revisions', async () => {
    const basic=create({persistCache:true,instanceId:'mint-a'});
    const variants=create({persistCache:true,instanceId:'mint-a',enableVariants:true});
    expect((basic as any)._revisionCacheKey).not.toBe((variants as any)._revisionCacheKey);
    localStorage.setItem((basic as any)._revisionCacheKey,'orphan');
    expect((basic as any)._definitionsRevision).toBeNull();
    localStorage.setItem((variants as any)._revisionCacheKey,'variant-orphan');
    localStorage.setItem((variants as any)._flagsCacheKey,JSON.stringify({On:true}));
    expect((variants as any)._definitionsRevision).toBeNull();
  });
  for (const context of [{instanceId:'mint-a'}, {identity:'legacy-user'}]) {
    it(`keeps both response-mode bodies paired with their revisions across reload and 304 (${Object.keys(context)[0]})`, async () => {
      const requests: Array<{mode:string,revision:string|null}> = [];
      (globalThis.fetch as jasmine.Spy).and.callFake(async (input: RequestInfo | URL, init?: RequestInit) => {
        const mode=String(input).includes('variants') ? 'variants' : 'evaluated';
        const revision=new Headers(init?.headers).get('If-None-Match');
        requests.push({mode,revision});
        if (revision) return new Response(null,{status:304,headers:{ETag:revision}});
        return new Response(JSON.stringify(mode==='variants' ? {On:{enabled:true,variant:'control'}} : {On:false}),
          {status:200,headers:{ETag:`${mode}-revision`}});
      });
      const options={persistCache:true,enableTelemetry:false,...context};
      const basic=create(options); await basic.setContext(context);
      expect(await basic.isFeatureOn('On')).toBeFalse();
      const variants=create({...options,enableVariants:true}); await variants.setContext(context);
      expect(await variants.getVariant('On')).toEqual({name:'control',configurationValue:undefined});
      basic.ngOnDestroy(); variants.ngOnDestroy();
      const reloadedBasic=create(options); await reloadedBasic.setContext(context);
      expect(await reloadedBasic.isFeatureOn('On')).toBeFalse();
      const reloadedVariants=create({...options,enableVariants:true}); await reloadedVariants.setContext(context);
      expect(await reloadedVariants.isFeatureOn('On')).toBeTrue();
      expect(await reloadedVariants.getVariant('On')).toEqual({name:'control',configurationValue:undefined});
      expect(requests).toEqual([{mode:'evaluated',revision:null},{mode:'variants',revision:null},
        {mode:'evaluated',revision:'evaluated-revision'},{mode:'variants',revision:'variants-revision'}]);
      reloadedVariants.clearFeatureFlagsCache();
      expect((reloadedVariants as any)._definitionsRevision).toBeNull();
      expect((reloadedBasic as any)._readCachedFlags()).toEqual({On:false});
      expect((reloadedBasic as any)._definitionsRevision).toBe('evaluated-revision');
    });
  }

  it('does not combine a legacy shared body with an older mode revision', async () => {
    const contextKey=evaluationContextCacheKey({identity:'legacy-user'});
    localStorage.setItem(`toggly:flags:telemetry-test:Production:${contextKey}`,JSON.stringify({Cached:true}));
    localStorage.setItem(`toggly:revision:telemetry-test:Production:v2:evaluated:${contextKey}`,'old-shared-body-revision');
    const service=create({persistCache:true,identity:'legacy-user',enableTelemetry:false});
    expect(await service.isFeatureOn('Cached')).toBeTrue();
    expect((service as any)._definitionsRevision).toBeNull();
    let revision:string|null=null;
    (globalThis.fetch as jasmine.Spy).and.callFake(async (_input:RequestInfo|URL,init?:RequestInit)=>{
      revision=new Headers(init?.headers).get('If-None-Match');
      return new Response(JSON.stringify({Fresh:true}),{status:200,headers:{ETag:'fresh-revision'}});
    });
    await service.setContext({identity:'legacy-user'});
    expect(revision).toBeNull(); expect(await service.isFeatureOn('Fresh')).toBeTrue();
  });

  it('tracks, evicts and clears variant-mode flag bodies without touching evaluated bodies', async () => {
    definitions={On:false};
    const basic=create({persistCache:true,enableTelemetry:false,instanceId:'shared'});
    await basic.setContext({instanceId:'shared'});
    definitions={On:{enabled:true,variant:'control'}};
    const variants=create({persistCache:true,enableTelemetry:false,enableVariants:true,maxCacheKeys:2,instanceId:'mint-a'});
    await variants.setContext({instanceId:'mint-a'});
    const firstFlags=(variants as any)._flagsCacheKey;
    const firstVariants=(variants as any)._variantsCacheKey;
    expect(JSON.parse(localStorage.getItem('toggly:cache-lru')!).entries[firstFlags]).toBeDefined();
    await variants.setContext({instanceId:'mint-b'});
    expect(localStorage.getItem(firstFlags)).toBeNull(); expect(localStorage.getItem(firstVariants)).toBeNull();
    const currentFlags=(variants as any)._flagsCacheKey;
    const currentVariants=(variants as any)._variantsCacheKey;
    variants.clearFeatureFlagsCache();
    expect(localStorage.getItem(currentFlags)).toBeNull(); expect(localStorage.getItem(currentVariants)).toBeNull();
    expect(JSON.parse(localStorage.getItem('toggly:cache-lru')!).entries).toEqual({});
    expect((basic as any)._readCachedFlags()).toEqual({On:false});
  });

  it('separates structured targeting from delimiter-containing identity values', () => {
    const first=create({identity:'alice|g:staff'});
    const second=create({identity:'alice',groups:['staff']});
    expect((first as any)._contextCacheKey).not.toBe((second as any)._contextCacheKey);
  });

  for (const enableVariants of [false, true]) it(`bounds scoped revisions with evicted ${enableVariants ? 'variant' : 'evaluated'} bodies`, async () => {
    const service=create({persistCache:true,enableTelemetry:false,enableVariants,maxCacheKeys:enableVariants?1:2});
    (globalThis.fetch as jasmine.Spy).and.callFake(async () => new Response(JSON.stringify(enableVariants?{On:{enabled:true,variant:'blue'}}:{On:true}),{headers:{etag:'revision'}}));
    for(let index=0;index<12;index++) await service.setContext({instanceId:`mint-${index}`});
    const revisions=Object.keys(localStorage).filter(key=>key.startsWith('toggly:revision:') && key.includes(':v3:'));
    expect(revisions.length).toBe(enableVariants?1:2);
    const current=(service as any)._revisionCacheKey;
    expect(localStorage.getItem(current)).toBe('revision');
    (globalThis.fetch as jasmine.Spy).and.callFake(async (_url:RequestInfo|URL,init?:RequestInit) => {
      expect(new Headers(init?.headers).get('If-None-Match')).toBe('revision');
      return new Response(null,{status:304});
    });
    await service.setContext({instanceId:'mint-11'}); expect(await service.isFeatureOn('On')).toBeTrue();
    if(enableVariants) expect((await service.getVariant('On'))?.name).toBe('blue');
    (globalThis.fetch as jasmine.Spy).and.callFake(async (_url:RequestInfo|URL,init?:RequestInit) => {
      expect(new Headers(init?.headers).get('If-None-Match')).toBeNull();
      return new Response(JSON.stringify(enableVariants?{On:{enabled:false}}:{On:false}),{headers:{etag:'replacement'}});
    });
    await service.setContext({instanceId:'mint-0'}); expect(await service.isFeatureOn('On')).toBeFalse();
  });

  for (const enableVariants of [false, true]) it(`does not recreate evicted ${enableVariants ? 'variant' : 'evaluated'} validators after a live 304`, async () => {
    let time = 0;
    spyOn(Date, 'now').and.callFake(() => ++time);
    (globalThis.fetch as jasmine.Spy).and.callFake(async (url:RequestInfo|URL, init?:RequestInit) => {
      const token = new URL(String(url)).searchParams.get('i');
      const revision = `revision-${token}`;
      if (new Headers(init?.headers).get('If-None-Match') === revision) {
        return new Response(null, {status:304, headers:{etag:revision}});
      }
      return new Response(JSON.stringify(enableVariants ? {On:{enabled:true,variant:'blue',configurationValue:7}} : {On:true}), {headers:{etag:revision}});
    });
    const options = {persistCache:true,enableTelemetry:false,enableVariants,maxCacheKeys:enableVariants ? 2 : 1};
    const first = create({...options,instanceId:'mint-a'});
    await first.isFeatureOn('On');
    const oldRevision = (first as any)._revisionCacheKey;
    const oldFlags = (first as any)._flagsCacheKey;
    const second = create({...options,instanceId:'mint-b'});
    await second.isFeatureOn('On');
    expect(localStorage.getItem(oldFlags)).toBeNull();
    expect(localStorage.getItem(oldRevision)).toBeNull();
    expect(await (first as any)._loadFeatures(true)).toEqual({On:true});
    expect(await first.isFeatureOn('On')).toBeTrue();
    if (enableVariants) expect(await first.getVariant('On')).toEqual({name:'blue',configurationValue:7});
    expect(localStorage.getItem(oldFlags)).toBeNull();
    expect(localStorage.getItem(oldRevision)).toBeNull();
    expect(localStorage.getItem((second as any)._revisionCacheKey)).toBe('revision-mint-b');
  });

  it('removes paired revisions across application eviction without deleting legacy or protected revisions', async () => {
    (globalThis.fetch as jasmine.Spy).and.callFake(async () => new Response(JSON.stringify({On:true}),{headers:{etag:'revision'}}));
    localStorage.setItem('toggly:revision:legacy:Production','legacy');
    const first=create({appKey:'first',persistCache:true,enableTelemetry:false,maxCacheKeys:1});
    await first.setContext({instanceId:'mint-a'}); const oldRevision=(first as any)._revisionCacheKey;
    const second=create({appKey:'second',persistCache:true,enableTelemetry:false,maxCacheKeys:1});
    await second.setContext({instanceId:'mint-b'});
    expect(localStorage.getItem(oldRevision)).toBeNull();
    expect(localStorage.getItem((second as any)._revisionCacheKey)).toBe('revision');
    expect(localStorage.getItem('toggly:revision:legacy:Production')).toBe('legacy');
  });

  it('clears only current-mode bodies and their paired revision', async () => {
    (globalThis.fetch as jasmine.Spy).and.callFake(async () => new Response(JSON.stringify(definitions),{headers:{etag:'revision'}}));
    const basic=create({persistCache:true,enableTelemetry:false,instanceId:'shared'});
    await basic.setContext({instanceId:'shared'});
    definitions={On:{enabled:true,variant:'blue'}};
    const variants=create({persistCache:true,enableTelemetry:false,instanceId:'shared',enableVariants:true});
    await variants.setContext({instanceId:'shared'});
    basic.clearFeatureFlagsCache();
    expect(localStorage.getItem((basic as any)._revisionCacheKey)).toBeNull();
    expect(localStorage.getItem((variants as any)._revisionCacheKey)).toBe('revision');
    expect((variants as any)._readCachedVariants()).toEqual(definitions);
    (globalThis.fetch as jasmine.Spy).and.callFake(async () => new Response(null,{status:304}));
    await variants.setContext({instanceId:'shared'}); expect((await variants.getVariant('On'))?.name).toBe('blue');
  });

});
