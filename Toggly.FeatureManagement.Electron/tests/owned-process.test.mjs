import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run } from './owned-process.mjs'
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const alive=pid=>{try{process.kill(pid,0);return true}catch(error){if(error.code==='ESRCH')return false;throw error}}
for(const mode of ['success','failure','timeout']) test(`reaps an actual inherited worker after parent ${mode}`,async()=>{
 const root=await mkdtemp(join(tmpdir(),'electron-command-control-')), marker=join(root,'pid')
 let pid
 try{
  const code=`const {spawn}=require('node:child_process');const fs=require('node:fs');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync(${JSON.stringify(marker)},String(child.pid));${mode==='timeout'?'setInterval(()=>{},1000)':'process.exit('+ (mode==='failure'?7:0)+')'}`
  if(mode==='success')await run(process.execPath,['-e',code],root)
  else await assert.rejects(run(process.execPath,['-e',code],root,{timeoutMs:500}),mode==='timeout'?/exceeded/:/exited 7/)
  pid=Number(await readFile(marker,'utf8'));assert.ok(pid>0)
  assert.equal(alive(pid),false)
 }finally{
  if(!pid)pid=Number(await readFile(marker,'utf8').catch(()=>0))
  if(pid&&alive(pid)){process.kill(pid,'SIGKILL');for(let n=0;n<100&&alive(pid);n++)await delay(20);assert.equal(alive(pid),false)}
  await rm(root,{recursive:true,force:true})
 }
})
test('retains executable failure with bounded cleanup',async()=>{
 await assert.rejects(run('/definitely-absent-electron-control',[],tmpdir(),{timeoutMs:500}),/ENOENT/)
})
