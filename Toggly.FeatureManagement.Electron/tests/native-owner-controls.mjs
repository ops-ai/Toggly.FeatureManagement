// macOS-only real native ownership controls, also run inside each packed row.
import assert from 'node:assert/strict'
import cp from 'node:child_process'
import { syncBuiltinESMExports, createRequire } from 'node:module'
import { promisify } from 'node:util'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { createConnection } from 'node:net'

if (process.platform !== 'darwin') process.exit(0)
const host = process.argv[2]
const application = dirname(dirname(dirname(createRequire(join(host, 'package.json'))('electron'))))
let denied = false
const original = cp.execFile
function observed(file, args, options, callback) {
  if (denied && file === '/bin/ps') {
    queueMicrotask(() => callback(Object.assign(new Error('Injected process observation failure'), { code: 'EACCES' })))
    return
  }
  return original(file, args, options, callback)
}
observed[promisify.custom] = (...args) => new Promise((resolve, reject) => observed(...args, (error, stdout, stderr) => error ? reject(error) : resolve({ stdout, stderr })))
cp.execFile = observed
syncBuiltinESMExports()
const helperURL = new URL('./owned-process.mjs', import.meta.url).href
const { launchOwnedElectron, stopOwnedElectron, run } = await import(helperURL)
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const observedProcesses = root => new Promise((resolve,reject)=>original('/bin/ps',['-axo','pid=,command='],{timeout:5000,maxBuffer:8_000_000},(error,stdout)=>error?reject(error):resolve(stdout.split('\n').filter(line=>line.replaceAll('/private/var/','/var/').includes(root.replaceAll('/private/var/','/var/'))))))
const alive = pid => { try { process.kill(pid, 0); return true } catch (error) { if (error.code === 'ESRCH') return false; throw error } }

function writeFixture(root, marker) {
  writeFileSync(join(root, 'package.json'), JSON.stringify({ type: 'module', main: 'main.mjs' }))
  writeFileSync(join(root, 'main.mjs'), `import {app,BrowserWindow} from 'electron';import {createServer} from 'node:http';import {writeFileSync} from 'node:fs';app.setPath('userData',${JSON.stringify(join(root,'profile'))});app.whenReady().then(async()=>{const win=new BrowserWindow({show:false});await win.loadURL('data:text/html,owned');const server=createServer((_q,r)=>r.end('owned'));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));writeFileSync(${JSON.stringify(marker)},JSON.stringify({pid:process.pid,port:server.address().port}));while(true){}})`)
}

for (const mode of ['observation', 'parent0', 'parent7']) {
  const root = mkdtempSync(join(tmpdir(), 'toggly-electron-owner-control-'))
  const marker = join(root, 'started.json')
  writeFixture(root, marker)
  let pending, record, primary, sentinelRoot, sentinelPending, sentinelRecord
  try {
    const args = ['-W','-n','-g','-a',application,'--args',root,'--headless','--disable-gpu']
    if (mode === 'observation') {
      sentinelRoot=mkdtempSync(join(tmpdir(),'toggly-electron-unrelated-control-'))
      const sentinelMarker=join(sentinelRoot,'started.json')
      writeFixture(sentinelRoot,sentinelMarker)
      sentinelPending=launchOwnedElectron('/usr/bin/open',['-W','-n','-g','-a',application,'--args',sentinelRoot,'--headless','--disable-gpu'],sentinelRoot,application,process.env,20000).then(()=>({ok:true}),error=>({error}))
      const start=Date.now()+5000
      while(!existsSync(sentinelMarker)&&Date.now()<start)await pause(20)
      assert.ok(existsSync(sentinelMarker),'Unrelated native sentinel must start')
      sentinelRecord=JSON.parse(readFileSync(sentinelMarker,'utf8'))
      pending = launchOwnedElectron('/usr/bin/open', args, root, application, process.env, 6000).then(() => ({ ok: true }), error => ({ error }))
      const deadline = Date.now()+5000
      while (!existsSync(marker) && Date.now()<deadline) await pause(20)
      assert.ok(existsSync(marker), 'Actual native app must start before observation fails')
      denied = true
      const result = await pending
      assert.ok(result.error)
      // The original command timeout remains the first failure, even when
      // process-group and post-native observation also fail independently.
      let first = result.error
      while (first instanceof AggregateError) first = first.errors[0]
      assert.match(String(first), /exceeded 6000ms/)
      assert.equal(alive(sentinelRecord.pid),true,'Same-binary unrelated app must survive target retirement')
    } else {
      const code = Number(mode.slice(6))
      const parent = join(root, 'parent.mjs')
      writeFileSync(parent, `import {launchOwnedElectron} from ${JSON.stringify(helperURL)};import {existsSync} from 'node:fs';void launchOwnedElectron('/usr/bin/open',${JSON.stringify(args)},${JSON.stringify(root)},${JSON.stringify(application)},process.env,10000).catch(()=>{});const deadline=Date.now()+8000;while(!existsSync(${JSON.stringify(marker)})&&Date.now()<deadline)await new Promise(r=>setTimeout(r,20));if(!existsSync(${JSON.stringify(marker)}))throw Error('native app never started');process.exit(${code});`)
      if (code) await assert.rejects(run(process.execPath, [parent], root, { timeoutMs: 20000 }), /exited 7/)
      else await run(process.execPath, [parent], root, { timeoutMs: 20000 })
    }
    record = JSON.parse(readFileSync(marker, 'utf8'))
    const deadline = Date.now()+3000
    while (alive(record.pid) && Date.now()<deadline) await pause(20)
    assert.equal(alive(record.pid), false, 'Native guardian must retire its app independently')
    const connected = await new Promise((resolve,reject)=>{const socket=createConnection({host:'127.0.0.1',port:record.port});socket.setTimeout(1000,()=>{socket.destroy();reject(Error('Port probe deadline'))});socket.once('connect',()=>{socket.destroy();resolve(true)});socket.once('error',()=>resolve(false))})
    assert.equal(connected,false)
    const retired=Date.now()+3000
    let remaining=await observedProcesses(root)
    while(remaining.length&&Date.now()<retired){await pause(25);remaining=await observedProcesses(root)}
    assert.deepEqual(remaining,[], 'Parent, native app and guardian must all retire')
    console.log(`Actual ${mode} native cleanup passed: PID ${record.pid}, port ${record.port}`)
  } catch (error) { primary = error }
  const cleanup=[]
  denied = false
  try { await stopOwnedElectron(root, application) } catch (error) { cleanup.push(error) }
  try { await pending } catch (error) { cleanup.push(error) }
  try { if(sentinelRoot)await stopOwnedElectron(sentinelRoot,application) } catch(error) { cleanup.push(error) }
  try { if(sentinelPending)await sentinelPending } catch(error) { cleanup.push(error) }
  try { if(sentinelRoot)rmSync(sentinelRoot,{recursive:true,force:true}) } catch(error) { cleanup.push(error) }
  try { rmSync(root, {recursive:true,force:true}) } catch (error) { cleanup.push(error) }
  if (cleanup.length) throw new AggregateError([...(primary?[primary]:[]),...cleanup], 'Native control and cleanup failed')
  if (primary) throw primary
}
const failedRoot = mkdtempSync(join(tmpdir(), 'toggly-electron-owner-launch-failure-'))
try {
  await assert.rejects(launchOwnedElectron('/definitely-absent-electron-launcher', [], failedRoot, application, process.env, 1000), /ENOENT/)
  assert.deepEqual(await observedProcesses(failedRoot), [])
  console.log('Actual native guardian launch-failure cleanup passed')
} finally {
  await stopOwnedElectron(failedRoot, application)
  rmSync(failedRoot, {recursive:true,force:true})
}
cp.execFile = original
syncBuiltinESMExports()
