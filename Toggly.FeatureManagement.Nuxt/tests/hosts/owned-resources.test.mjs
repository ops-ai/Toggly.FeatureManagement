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
