import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {spawn} from 'node:child_process'
import {mkdtemp,rm,access} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {withResources,closeServer,stopChild,bounded,launchBrowser,runOwned} from './owned-resources.mjs'
for(const scenario of ['launch','assertion','close-reject','close-hang','cleanup'])test(`independently cleans all real resources after ${scenario}`,async()=>{
 let server,child,dir
 const failure=Error(`original ${scenario}`)
 try {
  await assert.rejects(withResources(async own=>{
   dir=await mkdtemp(join(tmpdir(),'nuxt-cleanup-probe-'));own(()=>rm(dir,{recursive:true,force:true}))
   server=createServer();own(()=>closeServer(server));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
   const chromium={launchServer:async()=>{
    if(scenario==='launch')throw failure
    child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'})
    return{process:()=>child,wsEndpoint:()=>'',close:async()=>{if(scenario==='close-reject')throw Error('close failed');if(scenario==='close-hang')return new Promise(()=>{});await stopChild(child)}}
   },connect:async()=>({close:async()=>{}})}
   await launchBrowser(chromium,cleanup=>own(()=>bounded(cleanup,'injected deadline',40)))
   if(scenario==='cleanup')own(()=>{throw Error('artifact cleanup failed')})
   throw failure
  }),error=>error.cause===failure)
  assert.equal(server.listening,false);assert(child===undefined||child.exitCode!==null||child.signalCode!==null)
  await assert.rejects(access(dir),{code:'ENOENT'})
 } finally {if(server)await closeServer(server);await stopChild(child);if(dir)await rm(dir,{recursive:true,force:true})}
})
test('bounds an actual hung child command',async()=>{
 const started=Date.now()
 await assert.rejects(runOwned(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'},50))
 assert(Date.now()-started<3000)
})
test('negative control detects a deliberately unowned listener',async()=>{
 const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 try{await withResources(async()=>{});assert.throws(()=>assert.equal(server.listening,false))}finally{await closeServer(server)}
})
test('negative control detects a deliberately unowned child',async()=>{
 const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'})
 try{await withResources(async()=>{});assert.throws(()=>assert(child.exitCode!==null||child.signalCode!==null))}finally{await stopChild(child)}
})

for(const phase of ['headers','body'])test(`aborts held HTTP ${phase} before cleanup`,async()=>{
 const {readHttp}=await import('./owned-resources.mjs');let closed=false
 const server=createServer((_request,response)=>{response.on('close',()=>{closed=true});if(phase==='body'){response.writeHead(200);response.write('partial')}})
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  await assert.rejects(readHttp(`http://127.0.0.1:${server.address().port}`,{},100),/HTTP response timed out/)
  for(let i=0;i<50&&!closed;i++)await new Promise(resolve=>setTimeout(resolve,10))
  assert.equal(closed,true);assert.equal(server.listening,true)
 }finally{await closeServer(server)}
})
test('preserves complete response status, headers and body',async()=>{
 const {readHttp}=await import('./owned-resources.mjs')
 const server=createServer((_request,response)=>{response.writeHead(201,{'x-fixture':'yes'});response.end('{"ok":true}')})
 try{await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const result=await readHttp(`http://127.0.0.1:${server.address().port}`);assert.equal(result.status,201);assert.equal(result.headers.get('x-fixture'),'yes');assert.deepEqual(JSON.parse(result.body),{ok:true})}finally{await closeServer(server)}
})

for(const exited of [false,true])test(`cleans actual command descendant after parent exit=${exited}`,async()=>{
 const {readFile}=await import('node:fs/promises');const dir=await mkdtemp(join(tmpdir(),'nuxt-descendant-'));const file=join(dir,'pid');let parent,pid
 const alive=value=>{try{process.kill(value,0);return true}catch(error){if(error.code==='ESRCH')return false;throw error}}
 try{
  parent=spawn(process.execPath,['-e',`const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});require('node:fs').writeFileSync(${JSON.stringify(file)},String(child.pid));${exited?'child.unref()':'setInterval(()=>{},1000)'}`],{stdio:'ignore',detached:true})
  for(let i=0;i<100;i++){try{pid=Number(await readFile(file,'utf8'));break}catch{await new Promise(r=>setTimeout(r,10))}}
  assert(pid);if(exited)for(let i=0;i<100&&parent.exitCode===null;i++)await new Promise(r=>setTimeout(r,10))
  await stopChild(parent,true)
  for(let i=0;i<100&&alive(pid);i++)await new Promise(r=>setTimeout(r,10))
  assert.equal(alive(pid),false)
 }finally{await stopChild(parent,true);if(pid&&alive(pid))process.kill(pid,'SIGKILL');await rm(dir,{recursive:true,force:true})}
})
