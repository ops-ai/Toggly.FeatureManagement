import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile,readdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { startService } from '../fixtures/service.mjs';
const service=await startService();
const env={...process.env,TOGGLY_BACKEND_APP_KEY:'backend-private-key-sentinel',TOGGLY_BASE_URL:service.baseURI,VITE_TOGGLY_APP_KEY:'frontend-test-key',VITE_TOGGLY_BASE_URL:service.baseURI,PORT:'5197',HOST:'127.0.0.1'};
const run=(cmd,args)=>new Promise((resolve,reject)=>{const p=spawn(cmd,args,{env,stdio:'inherit'});p.on('exit',code=>code===0?resolve():reject(Error(`${cmd} exited ${code}`)));});
let server,browser;
try{
 const {build}=await import('vite');
 await assert.rejects(build({configFile:false,logLevel:'silent',build:{write:false,lib:{entry:'boundary.ts',formats:['es']}}}),/No known conditions|Failed to resolve|Missing.*server|not exported/);
 await run('npm',['run','build']);
 const files=await readdir('.output/public/_build/assets');
 for(const name of files.filter(n=>n.endsWith('.js'))){const text=await readFile(`.output/public/_build/assets/${name}`,'utf8');assert.doesNotMatch(text,/backend-private-key-sentinel|toggly-node-core|node:crypto|node:fs|backend-only-sentinel/);}
 server=spawn(process.execPath,['.output/server/index.mjs'],{env,stdio:'inherit'});
 let response;
 for(let i=0;i<100;i++){try{response=await fetch('http://127.0.0.1:5197/');if(response.status===200)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 assert.equal(response?.status,200);
 const [aliceHTML,bobHTML]=await Promise.all(['alice','bob'].map(identity=>fetch(`http://127.0.0.1:5197/?identity=${identity}`).then(r=>r.text())));assert.match(aliceHTML,/Beta enabled/);assert.match(bobHTML,/Beta disabled/);
 const html=await response.text();assert.match(html,/Beta enabled/);assert.doesNotMatch(html,/backend-private-key-sentinel|backend-only-sentinel|"secret"/);
 const statuses=await Promise.all(['alice','bob','alice','bob'].map(identity=>fetch('http://127.0.0.1:5197/api/action',{method:'POST',headers:{'x-test-identity':identity}}).then(r=>r.status)));
 assert.deepEqual(statuses,[200,404,200,404]);
 browser=await chromium.launch({headless:true});const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
 const attack='</script><script>globalThis.__snapshotXss=true</script>';
 await page.goto(`http://127.0.0.1:5197/?identity=${encodeURIComponent(attack)}`);await page.getByRole('heading',{name:'Beta disabled'}).waitFor();assert.equal(await page.evaluate(()=>globalThis.__snapshotXss),undefined);
 await page.goto('http://127.0.0.1:5197/');await page.getByRole('heading',{name:'Beta enabled'}).waitFor();await page.getByText('VIP checkout',{exact:true}).waitFor();
 await page.getByRole('link',{name:'Bob',exact:true}).click();await page.getByRole('heading',{name:'Beta disabled'}).waitFor();
 await page.getByRole('link',{name:'Alice',exact:true}).click();await page.getByRole('heading',{name:'Beta enabled'}).waitFor();
 // A legacy notification without a revision must bypass the browser HTTP cache.
 service.state.on=false;service.state.revision++;const before=service.state.requests.length;service.broadcast('update');await page.getByText('Live off',{exact:true}).waitFor();
 const refresh=service.state.requests.slice(before).find(r=>r.url.includes('/evaluated-signed/'));assert(refresh);assert.equal(refresh.headers['if-none-match'],undefined);
 service.state.on=true;service.state.revision++;service.broadcast(JSON.stringify({type:'flags-updated'}));await page.getByText('Live on',{exact:true}).waitFor();
 // A valid signature does not make malformed entity rules safe to evaluate.
 const goodRevision=`"rev${service.state.revision}"`;service.state.malformed=true;service.state.on=false;service.state.revision++;service.broadcast('update');await page.waitForTimeout(600);
 assert(await page.getByText('Live on',{exact:true}).isVisible());assert(await page.getByText('VIP checkout',{exact:true}).isVisible());
 const probe=service.state.requests.length;await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.waitForTimeout(200);
 const malformedRefresh=service.state.requests.slice(probe).find(r=>r.url.includes('/evaluated-signed/'));assert.equal(malformedRefresh.headers['if-none-match'],goodRevision);
 for(const identity of ['observer-throw','observer-reject']){const result=await fetch(`http://127.0.0.1:5197/?identity=${identity}`);assert.equal(result.status,200);assert.match(await result.text(),/Beta disabled/);}
 service.state.malformed=false;
 // Signature failure at a NEW revision retains the verified previous snapshot.
 service.state.invalid=true;service.state.on=false;service.state.revision++;service.broadcast('flags-updated');await page.waitForTimeout(600);assert(await page.getByText('Live on',{exact:true}).isVisible());
 service.state.invalid=false;service.state.offline=true;await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.waitForTimeout(200);assert(await page.getByText('Live on',{exact:true}).isVisible());service.state.offline=false;
 await page.getByRole('link',{name:'Leave',exact:true}).click();await page.getByRole('heading',{name:'Away'}).waitFor();const left=service.state.requests.length;service.broadcast('update');await page.waitForTimeout(600);assert.equal(service.state.requests.length,left);
 assert.deepEqual(errors,[]);console.log('PASS packed SolidStart SSR, signed hydration, concurrent guarded actions, navigation, entity gates, live invalidation, invalid signature and malformed map retention, isolated throwing/rejecting observers, offline retention, disposal and browser secret/import scan');
}finally{await browser?.close();server?.kill('SIGTERM');await service.close();}
