import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { gunzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const sdk = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = mkdtempSync(join(tmpdir(), 'toggly-javascript-packed-'));
const host = join(temporary, 'host');
const reporterTarball = process.env.TOGGLY_CLIENT_TELEMETRY_TARBALL;
const packets = [], definitions = [], definitionRequests = [], servers = [], delayed = [];
let preflights = 0, browser;
function run(command, args, cwd = sdk) {
  return execFileSync(command, args, { cwd, encoding: 'utf8', timeout: 180000,
    env: {...process.env, npm_config_audit:'false', npm_config_fund:'false'} });
}
async function listen(handler) {
  const server = createServer(handler); servers.push(server);
  await new Promise((resolve, reject) => {server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
  return `http://127.0.0.1:${server.address().port}`;
}
async function evaluate(page, callback, argument) {
  let timer;
  try {
    return await Promise.race([page.evaluate(callback, argument), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('JavaScript packed browser evaluation exceeded 10 seconds')), 10000);
    })]);
  } finally { clearTimeout(timer); }
}
async function waitUntil(predicate, phase) {
  const deadline = Date.now()+10000;
  while (!predicate()) {
    assert.ok(Date.now()<deadline, `JavaScript packed host timed out: ${phase}; received ${packets.length} envelopes`);
    await delay(20);
  }
}
try {
  if (reporterTarball) console.log('LOCAL_TELEMETRY_TARBALL: registry acceptance pending');
  run('npm',['run','build']);
  const packed = JSON.parse(run('npm',['pack','--json','--pack-destination',temporary]))[0];
  mkdirSync(host);writeFileSync(join(host,'package.json'),JSON.stringify({private:true,type:'module'}));
  run('npm',['install','--no-package-lock',join(temporary,packed.filename),'playwright@1.58.2','typescript@4.9.5',...(reporterTarball?[resolve(reporterTarball)]:[])],host);
  const installed = join(host,'node_modules/@ops-ai/feature-flags-toggly');
  const bundle = readFileSync(join(installed,'dist/feature-flags-toggly.bundle.js'));
  assert.doesNotMatch(bundle.toString(),/node:http|node:zlib|api\/usage|grpc-js/);
  writeFileSync(join(host,'consumer.ts'), `import type {TogglyConfig} from '@ops-ai/feature-flags-toggly';
const config:TogglyConfig={appKey:'public',instanceId:'host-minted',enableTelemetry:true,metricsBaseUrl:'https://metrics.example.test/base',telemetryFlushIntervalMs:45000};
void window.Toggly.init(config);window.Toggly.instanceId='rotated';window.Toggly.recordUsage('Action','blue');window.Toggly.recordView('Panel');window.Toggly.incrementCounter('orders',2);window.Toggly.setGauge('cart',3);void window.Toggly.flushTelemetry();`);
  run(join(host,'node_modules/.bin/tsc'),['--noEmit','--strict','--skipLibCheck','false','--target','ES2020','--module','commonjs','--moduleResolution','node','--lib','ES2020,DOM','consumer.ts'],host);
  writeFileSync(join(host,'ssr.mjs'),`import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);let work=0;globalThis.fetch=()=>{work++;throw Error('SSR request')};globalThis.setTimeout=globalThis.setInterval=()=>{work++;throw Error('SSR timer')};
require('@ops-ai/feature-flags-toggly');await import('@ops-ai/feature-flags-toggly');assert.equal(work,0);assert.equal(globalThis.window,undefined);console.log('PACKED_JAVASCRIPT_SSR_IMPORT_PASS');`);
  process.stdout.write(run(process.execPath,['ssr.mjs'],host));
  const metrics = await listen(async(request,response)=>{
    response.setHeader('Access-Control-Allow-Origin','*');response.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');response.setHeader('Access-Control-Allow-Headers','content-type, content-encoding');
    if(request.method==='OPTIONS'){preflights++;response.writeHead(204).end();return;}
    assert.equal(request.url,'/metrics-root/api/frontend/telemetry');assert.equal(request.method,'POST');
    assert.equal(request.headers.cookie,undefined);assert.equal(request.headers.authorization,undefined);
    assert.equal(request.headers['x-toggly-sdk'],undefined);assert.equal(request.headers['x-toggly-identity'],undefined);assert.equal(request.headers['x-toggly-instance-id'],undefined);
    assert.ok(!(request.url.includes('?')),'metrics attribution stays in JSON');
    const chunks=[];for await(const chunk of request)chunks.push(chunk);
    const encoding=request.headers['content-encoding']??'identity';
    const data=Buffer.concat(chunks);const body=JSON.parse(encoding==='gzip'?gunzipSync(data).toString():data.toString());
    assert.ok(Object.keys(body).every(key=>['k','e','i','u','f','m'].includes(key)));
    packets.push({body,encoding,origin:request.headers.origin});response.writeHead(202).end();
  });
  const baseURI = await listen((request,response)=>{
    response.setHeader('Access-Control-Allow-Origin','*');response.setHeader('Access-Control-Allow-Headers','*');
    if(request.method==='OPTIONS'){response.writeHead(204).end();return;}
    const path=new URL(request.url,'http://localhost').pathname;definitions.push(path);definitionRequests.push(new URL(request.url,'http://localhost'));
    response.setHeader('Content-Type','application/json');
    if(path.includes('/old-pending/')){delayed.push(response);return;}
    const defs=path.includes('/evaluated-variants-signed/')?{Sale:{enabled:true,variant:'Treatment',configurationValue:42},Off:{enabled:false}}
      :path.includes('/new-owner/')||path.includes('/late-replacement/')?{Switch:false}
      :path.includes('/old-owner/')?{Switch:true}
      :{On:true,Off:false,Skipped:true,Entity:{requirement:'all',rules:[{property:'Color',op:'eq',value:'red'}]}};
    response.end(JSON.stringify({defs}));
  });
  const site=await listen((request,response)=>{
    if(request.url==='/sdk.js'){response.setHeader('Content-Type','application/javascript');response.end(bundle);return;}
    response.setHeader('Content-Type','text/html');response.end('<!doctype html><script src="/sdk.js"></script><p>JavaScript packed host</p>');
  });
  const {chromium}=await import(pathToFileURL(join(host,'node_modules/playwright/index.mjs')).href);
  run(join(host,'node_modules/.bin/playwright'),['install',...(process.platform==='linux'?['--with-deps']:[]),'chromium'],host);
  browser=await chromium.launch({headless:true,...(process.env.CHROME_BIN?{executablePath:process.env.CHROME_BIN}:{})});
  const page=await browser.newPage();page.setDefaultTimeout(10000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(site);
  assert.equal(definitions.length,0);assert.equal(packets.length,0);
  const config={identity:'',groups:[],claims:{},baseURI,metricsBaseUrl:metrics+'/metrics-root',enableLiveUpdates:false,persistCache:false,featureFlagsRefreshInterval:0};
  await evaluate(page, async config=>{
    const T=window.Toggly;
    await T.init({...config,flagDefaults:{On:true}});if(!T.isFeatureOn('On'))throw Error('keyless result');T.recordUsage('Ignored');await T.flushTelemetry();
    await T.init({...config,appKey:'optout',enableTelemetry:false});if(!T.isFeatureOn('On'))throw Error('optout result');T.recordView('Ignored');await T.flushTelemetry();T.cancelRefreshInterval();
  },config);
  await delay(100);assert.equal(packets.length,0);
  const values=await evaluate(page, async config=>{
    const T=window.Toggly;await T.init({...config,appKey:'reference',environment:'Test',identity:'private-user',groups:['private'],claims:{plan:'private'}});
    void T.featureFlagsValue;await T.refresh();
    const values=[T.isFeatureOn('On'),T.isFeatureOn('On'),T.isFeatureOff('Off'),T.evaluateFeatureGate(['On','Skipped'],1,true),T.evaluateFeatureGate(['Off','Skipped'],0,true),T.isFeatureOn('Entity'),T.isFeatureOn('Entity',{kind:'Order',key:'private-order',attributes:{Color:'red'}})];
    T.setLocalGates([{id:'device',flagKeys:['On'],isEnabled:()=>false}]);values.push(T.isFeatureOn('On'));T.setLocalGates([]);
    T.recordUsage('Action');T.recordView('Panel','blue');T.incrementCounter('orders');T.incrementCounter('orders',2);T.setGauge('cart',2);T.setGauge('cart',4);await T.flushTelemetry();return values;
  },config);
  assert.deepEqual(values,[true,true,true,false,true,false,true,false]);
  await waitUntil(()=>packets.length===1,'effective and explicit aggregate');
  assert.deepEqual(packets[0],{encoding:'gzip',origin:site,body:{k:'reference',e:'Test',u:'private-user',f:{On:{enabled:[3],disabled:[1]},Off:{disabled:[2]},Entity:{disabled:[1],enabled:[1]},Action:{enabled:[0,1]},Panel:{blue:[0,0,1]}},m:{orders:3,cart:4}}});
  assert.ok(preflights>0,'real CORS preflight executed');
  const clientQuery=definitionRequests.find(url=>url.pathname.includes('/reference/')).searchParams;assert.equal(clientQuery.get('u'),'private-user');assert.equal(clientQuery.get('g'),'private');assert.equal(clientQuery.get('claim.plan'),'private');
  await evaluate(page, async()=>{
    window.Toggly.recordUsage('Hidden');Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));await window.Toggly.flushTelemetry();Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});
  });
  await waitUntil(()=>packets.length===2,'hidden lifecycle');assert.equal(packets[1].encoding,'identity');assert.deepEqual(packets[1].body.f,{Hidden:{enabled:[0,1]}});
  await evaluate(page, async()=>{window.Toggly.recordUsage('Pagehide');window.dispatchEvent(new Event('pagehide'));await window.Toggly.flushTelemetry()});
  await waitUntil(()=>packets.length===3,'pagehide lifecycle');assert.equal(packets[2].encoding,'identity');
  await evaluate(page, ()=>{window.Toggly.recordView('Disposed');window.Toggly.cancelRefreshInterval()});
  await waitUntil(()=>packets.length===4,'synchronous disposal');assert.equal(packets[3].encoding,'identity');assert.deepEqual(packets[3].body.f,{Disposed:{enabled:[0,0,1]}});
  await evaluate(page, async()=>{window.Toggly.recordUsage('AfterDisposal');window.dispatchEvent(new Event('pagehide'));await window.Toggly.flushTelemetry()});await delay(100);assert.equal(packets.length,4);
  const variant=await evaluate(page, async config=>{
    const T=window.Toggly;await T.init({...config,appKey:'variants',environment:'Variants',instanceId:'minted-variant-token',identity:'suppressed-user',groups:['suppressed-group'],claims:{plan:'suppressed-claim'},enableVariants:true,persistCache:true});
    const result=[T.getVariant('Sale'),T.getVariantValue('Sale'),T.getVariant('Off')];await T.flushTelemetry();return result;
  },config);
  assert.deepEqual(variant,[{name:'Treatment',configurationValue:42},42,null]);await waitUntil(()=>packets.length===5,'assigned variants');
  assert.deepEqual(packets[4].body,{k:'variants',e:'Variants',i:'minted-variant-token',f:{Sale:{Treatment:[2]},Off:{disabled:[1]}}});
  const mintedQuery=definitionRequests.find(url=>url.pathname.includes('/variants/')).searchParams;assert.equal(mintedQuery.get('i'),'minted-variant-token');assert.equal(mintedQuery.has('u'),false);assert.equal(mintedQuery.has('userId'),false);assert.equal(mintedQuery.has('g'),false);assert.equal(mintedQuery.has('claim.plan'),false);
  await evaluate(page, async config=>{
    const T=window.Toggly;await T.init({...config,appKey:'old-owner',environment:'Old'});T.isFeatureOn('Switch');T.recordUsage('Old');
    await T.init({...config,appKey:'new-owner',environment:'New'});if(T.isFeatureOn('Switch'))throw Error('old snapshot leaked');T.recordView('New');await T.flushTelemetry();
  },config);
  await waitUntil(()=>packets.length===7,'replacement isolation');
  assert.deepEqual(packets.find(packet=>packet.body.k==='old-owner').body,{k:'old-owner',e:'Old',f:{Switch:{enabled:[1]},Old:{enabled:[0,1]}}});
  assert.deepEqual(packets.find(packet=>packet.body.k==='new-owner').body,{k:'new-owner',e:'New',f:{Switch:{disabled:[1]},New:{enabled:[0,0,1]}}});
  await evaluate(page, config=>{window.pending=window.Toggly.init({...config,appKey:'old-pending'})},config);
  await waitUntil(()=>delayed.length===1,'delayed old initialization request');
  await evaluate(page, async config=>{await window.Toggly.init({...config,appKey:'late-replacement',environment:'Late'})},config);
  for(const response of delayed.splice(0))response.end(JSON.stringify({defs:{Switch:true}}));
  const latest=await evaluate(page, async()=>{await window.pending;const value=window.Toggly.isFeatureOn('Switch');await window.Toggly.flushTelemetry();return value});
  assert.equal(latest,false);await waitUntil(()=>packets.length===8,'late replacement check');
  assert.deepEqual(packets[7].body,{k:'late-replacement',e:'Late',f:{Switch:{disabled:[1]}}});
  const other=await browser.newPage();other.setDefaultTimeout(10000);await other.goto(site);
  await evaluate(other, async config=>{await window.Toggly.init({...config,appKey:'other-realm'});window.Toggly.recordUsage('Other');await window.Toggly.flushTelemetry()},config);
  await evaluate(page, async()=>{window.Toggly.recordUsage('First');await window.Toggly.flushTelemetry()});await waitUntil(()=>packets.length===10,'independent realms');
  assert.equal(packets[8].body.k,'other-realm');assert.equal(packets[9].body.k,'late-replacement');
  await evaluate(other, ()=>window.Toggly.cancelRefreshInterval());
  await evaluate(page, async()=>{window.Toggly.recordUsage('AfterOtherClosed');await window.Toggly.flushTelemetry();window.Toggly.cancelRefreshInterval()});await waitUntil(()=>packets.length===11,'remaining owner after other disposal');
  assert.equal(packets[10].body.k,'late-replacement');await other.close();
  await evaluate(page, async config=>{
    const T=window.Toggly;await T.init({...config,appKey:'transitions'});
    T.incrementCounter('orders',1);T.setGauge('cart',1);
    T.identity='alice';T.incrementCounter('orders',2);T.setGauge('cart',2);
    T.identity='bob';T.incrementCounter('orders',3);
    T.instanceId='mint-one';T.recordUsage('Use');
    T.instanceId='mint-two';T.recordView('View');
    T.instanceId='';T.incrementCounter('fallback');
    T.clearIdentity();T.recordUsage('Logout');await T.flushTelemetry();
  },config);
  await waitUntil(()=>packets.length===18,'seven synchronous attribution transitions');
  assert.deepEqual(packets.slice(11).map(packet=>packet.body),[
    {k:'transitions',e:'Production',m:{orders:1,cart:1}},
    {k:'transitions',e:'Production',u:'alice',m:{orders:2,cart:2}},
    {k:'transitions',e:'Production',u:'bob',m:{orders:3}},
    {k:'transitions',e:'Production',i:'mint-one',f:{Use:{enabled:[0,1]}}},
    {k:'transitions',e:'Production',i:'mint-two',f:{View:{enabled:[0,0,1]}}},
    {k:'transitions',e:'Production',u:'bob',m:{fallback:1}},
    {k:'transitions',e:'Production',f:{Logout:{enabled:[0,1]}}},
  ]);
  for(const path of ['local','mapper','hook']) {
    const start=packets.length;
    const value=await evaluate(page,async({config,path})=>{
      const T=window.Toggly;await T.init({...config,appKey:'reentrant',identity:'alice',enableVariants:true,persistCache:true});
      const change=()=>{T.identity='bob';T.recordUsage('NewContext')};
      if(path==='local')T.setLocalGates([{id:'switch',flagKeys:['Sale'],isEnabled:()=>{change();return true}}]);
      if(path==='mapper')T.registerContext('HostSwitch',()=>{change();return {kind:'HostSwitch',key:'entity',attributes:{}}});
      if(path==='hook')T.addHook({getMetadata:()=>({name:'host-switch'}),beforeEvaluation:()=>change()});
      try {
        const result=path==='local'?T.getVariantValue('Sale'):T.isFeatureOn('Sale',path==='mapper'?{}:undefined,path==='mapper'?'HostSwitch':undefined);
        await T.flushTelemetry();return result;
      } finally {T.setLocalGates([]);T.removeHook('host-switch')}
    },{config,path});
    assert.equal(value,path==='local'?42:true);await waitUntil(()=>packets.length===start+2,`${path} reentrancy`);
    assert.deepEqual(packets.slice(start).map(packet=>packet.body),[
      {k:'reentrant',e:'Production',u:'bob',f:{NewContext:{enabled:[0,1]}}},
      {k:'reentrant',e:'Production',u:'alice',f:{Sale:{Treatment:[1]}}},
    ]);
  }
  const bounded=await evaluate(page,async config=>{
    const T=window.Toggly;const diagnostics=[];await T.init({...config,appKey:'bounded',onError:message=>diagnostics.push(message)});
    for(let index=0;index<10;index++){T.identity=`context-${index}`;T.recordUsage('界'.repeat(13000))}
    await T.flushTelemetry();
    for(let index=0;index<1000;index++)T.identity=`empty-${index}`;
    T.recordUsage('AfterEmptyTransitions');await T.flushTelemetry();T.cancelRefreshInterval();return diagnostics;
  },config);
  await waitUntil(()=>packets.length===31,'global UTF-8 budget across contexts');
  const budgetPackets=packets.slice(24,30).map(packet=>packet.body);
  assert.deepEqual(budgetPackets.map(packet=>packet.u),['context-0','context-1','context-2','context-3','context-4','context-5']);
  assert.ok(budgetPackets.every(packet=>Buffer.byteLength(JSON.stringify(packet))<=49152));
  assert.ok(budgetPackets.reduce((bytes,packet)=>bytes+Buffer.byteLength(JSON.stringify(packet)),0)<=262144);
  assert.ok(budgetPackets.every(packet=>JSON.stringify(packet.f)===JSON.stringify({['界'.repeat(13000)]:{enabled:[0,1]}})));
  assert.deepEqual(bounded,Array(4).fill('Frontend telemetry: buffer-full'));
  assert.deepEqual(packets[30].body,{k:'bounded',e:'Production',u:'empty-999',f:{AfterEmptyTransitions:{enabled:[0,1]}}});
  assert.ok(packets.slice(11).every(packet=>packet.encoding==='gzip'));
  const beforeClose=definitions.length;await delay(100);assert.equal(definitions.length,beforeClose);assert.deepEqual(errors,[]);
  console.log('PACKED_JAVASCRIPT_BROWSER_TELEMETRY_PASS');
  console.log('PACKED_JAVASCRIPT_HOST_PASS '+JSON.stringify({node:process.version,typescript:'4.9.5',playwright:'1.58.2',chromium:browser.version(),envelopes:packets.length}));
} finally {
  for(const response of delayed)response.destroy();
  await browser?.close();
  for(const server of servers){server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
  rmSync(temporary,{recursive:true,force:true});
}
