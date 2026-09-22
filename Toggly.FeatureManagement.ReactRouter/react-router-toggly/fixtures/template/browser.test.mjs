import { bounded, cleanupOwned, closeServer } from './owned-resources.mjs';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {gunzipSync} from 'node:zlib';
import puppeteer from 'puppeteer-core';
import {createRequestHandler} from 'react-router';
import * as build from './build/server/index.js';

test('real packed browser sends compact CORS/gzip and lifecycle telemetry',async()=>{
  const bodies=[];const headers=[];let preflight=0;
  const collector=createServer((req,res)=>{
    res.setHeader('Access-Control-Allow-Origin',req.headers.origin??'*');
    res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers','Content-Type, Content-Encoding');
    if(req.method==='OPTIONS'){preflight++;res.writeHead(204);res.end();return;}
    if(req.method!=='POST'||req.url!=='/api/frontend/telemetry'){res.writeHead(404);res.end();return;}
    const chunks=[];req.on('data',chunk=>chunks.push(chunk));req.on('end',()=>{
      const bytes=Buffer.concat(chunks);headers.push(req.headers);
      bodies.push(JSON.parse((req.headers['content-encoding']==='gzip'?gunzipSync(bytes):bytes).toString()));
      res.writeHead(202);res.end();
    });
  });
  const handler=createRequestHandler(build,'production');
  const app=createServer(async(req,res)=>{
    try{
      const url=new URL(req.url,'http://127.0.0.1');
      if(url.pathname.startsWith('/assets/')){
        const file=resolve('build/client','.'+url.pathname);
        res.setHeader('Content-Type',extname(file)==='.js'?'application/javascript':'text/css');res.end(await readFile(file));return;
      }
      const result=await handler(new Request(`http://127.0.0.1:${app.address().port}${req.url}`));
      res.writeHead(result.status,Object.fromEntries(result.headers));res.end(Buffer.from(await bounded(() => result.arrayBuffer(), 'SSR response body', 10000)));
    }catch(error){res.writeHead(500);res.end(String(error));}
  });
  let browser, page, failure;
  try{
    await new Promise(resolve=>collector.listen(0,'127.0.0.1',resolve));
    await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
    assert.ok(process.env.TOGGLY_BROWSER_ENDPOINT, 'The supervisor must own the browser');
    browser=await puppeteer.connect({browserWSEndpoint:process.env.TOGGLY_BROWSER_ENDPOINT});
    page=await browser.newPage();
    const evaluate = (...args) => bounded(() => page.evaluate(...args), 'Browser evaluation', 10000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await bounded(() => page.evaluateOnNewDocument(()=>{window.WebSocket=undefined;}), 'Browser preload', 10000);
    let remote=true;const identities=[];
    await page.setRequestInterception(true);page.on('request',request=>{
      const url=new URL(request.url());
      if(url.pathname.startsWith('/definitions-fixture/')){
        identities.push(url.searchParams);
        void request.respond({status:200,contentType:'application/json',body:JSON.stringify({Visible:url.pathname.includes('replacement')?false:remote,Hidden:false})});
      }else void request.continue();
    });
    await page.goto(`http://127.0.0.1:${app.address().port}/?metrics=${encodeURIComponent(`http://127.0.0.1:${collector.address().port}`)}`);
    const state=async value=>page.waitForFunction(value=>document.querySelector('#visible')?.textContent===value&&window.current?.isReady,{timeout:10000},value);
    await state('on');await page.click('#local-off');await state('off');await page.click('#local-on');await state('on');
    await evaluate(()=>window.current.recordUsage('Queued'));
    remote=false;await page.click('#identify');await state('off');assert.ok(identities.some(query=>query.get('u')==='second-user'));
    remote=true;await page.click('#refresh');await state('on');
    await evaluate(()=>window.current.flushTelemetry());
    assert.ok(bodies.some(body=>body.f.Visible?.enabled?.[0]>1));assert.ok(bodies.some(body=>body.f.Visible?.disabled?.[0]>0));
    assert.ok(bodies.some(body=>body.u==='host-user-1'&&body.f.Queued?.enabled?.[1]===1),'pre-identify queue keeps hydrated attribution');
    assert.ok(bodies.some(body=>body.u==='second-user'&&body.f.Visible?.disabled?.[0]>0),'new checks use the new client identity');
    assert.ok(bodies.every(body=>!body.f.Skipped&&Object.entries(body.f).filter(([key])=>key!=='Queued').every(([,variants])=>Object.values(variants).every(counts=>counts.length===1))));
    bodies.length=0;
    const record=async()=>evaluate(()=>{window.current.recordUsage('Visible');window.current.recordView('Visible','control');window.current.incrementCounter('orders',2);window.current.setGauge('cart',3);});
    const expected={k:'host-test-key',e:'Development',u:'second-user',f:{Visible:{enabled:[0,1],control:[0,0,1]}},m:{orders:2,cart:3}};
    await record();await evaluate(()=>window.current.flushTelemetry());assert.deepEqual(bodies,[expected]);
    assert.ok(preflight>0);assert.ok(headers.some(h=>h['content-encoding']==='gzip'));assert.ok(headers.every(h=>!h.cookie&&!h.authorization));
    await evaluate(()=>window.current.identify('private-client',{instanceId:'minted-token',groups:['staff'],claims:{plan:'pro'}}));
    await state('on');
    const minted=identities.at(-1);assert.equal(minted.get('i'),'minted-token');
    for(const key of ['u','userId','g','claim.plan'])assert.equal(minted.has(key),false);
    await evaluate(()=>window.current.flushTelemetry());bodies.length=0;
    delete expected.u;expected.i='minted-token';
    await record();await evaluate(()=>window.current.flushTelemetry());assert.deepEqual(bodies,[expected]);
    const count=async n=>{const end=Date.now()+5000;while(bodies.length<n&&Date.now()<end)await new Promise(r=>setTimeout(r,20));assert.equal(bodies.length,n);};
    await record();await evaluate(()=>window.dispatchEvent(new Event('pagehide')));await count(2);assert.deepEqual(bodies[1],expected);assert.equal(headers[headers.length-1]['content-encoding'],undefined);
    await record();await evaluate(()=>window.host.unmount());await count(3);assert.deepEqual(bodies[2],expected);
    await evaluate(()=>window.current.recordUsage('Disposed'));await evaluate(()=>window.current.flushTelemetry());assert.equal(bodies.length,3);
    await evaluate(()=>window.host.remount());await state('on');await evaluate(()=>window.current.flushTelemetry());
    assert.ok(bodies[3].f.Visible.enabled[0]>0);bodies.length=0;
    await evaluate(()=>window.host.replace());await state('off');await evaluate(()=>window.current.flushTelemetry());
    assert.ok(bodies.every(body=>body.k==='replacement'&&body.e==='New'&&!body.f.Visible.enabled));
    await evaluate(()=>window.host.unmount());assert.deepEqual(errors,[]);
    console.log(`PACKED_ROUTER_BROWSER_PASS Chromium ${await browser.version()}; minted/client/lifecycle attribution verified`);
  }catch(error){failure=error;}
  await cleanupOwned([()=>page&&page.close(),()=>browser?.disconnect(),()=>closeServer(app),()=>closeServer(collector)],failure);
});
