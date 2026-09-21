import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from './packed-process.cjs';
const absent = pid => { try { process.kill(pid, 0); return false; } catch (error) { assert.equal(error.code, 'ESRCH'); return true; } };
for (const mode of ['timeout', 'parent-exit', 'failure']) test(`reaps actual listener and worker after ${mode}`, async () => {
  const root = await mkdtemp(join(tmpdir(), 'toggly-native-cleanup-'));
  const file = join(root, 'owned.json');
  const worker = `const fs=require('fs');const s=require('net').createServer();s.listen(0,'127.0.0.1',()=>fs.writeFileSync(${JSON.stringify(file)},JSON.stringify({pid:process.pid,port:s.address().port})));setInterval(()=>{},1000)`;
  const parent = `const {spawn}=require('child_process');const fs=require('fs');spawn(process.execPath,['-e',${JSON.stringify(worker)}],{stdio:'inherit'});const t=setInterval(()=>{if(fs.existsSync(${JSON.stringify(file)})){clearInterval(t);${mode === 'parent-exit' ? 'process.exit(0)' : mode === 'failure' ? 'process.exit(7)' : 'setInterval(()=>{},1000)'}}},10)`;
  try {
    const pending = run(process.execPath, ['-e', parent], { timeoutMs: 1500, capture: true });
    if (mode === 'parent-exit') await pending; else await assert.rejects(pending, mode === 'failure' ? /exited 7/ : /exceeded/);
    const {pid, port} = JSON.parse(await readFile(file, 'utf8'));
    for (let i=0;i<100&&!absent(pid);i++) await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(absent(pid), true);
    const net = await import('node:net'); const socket = net.connect(port, '127.0.0.1');
    await new Promise((resolve,reject)=>{socket.once('connect',()=>{socket.destroy();reject(new Error('owned listener survived'))});socket.once('error',error=>{assert.equal(error.code,'ECONNREFUSED');resolve()});});
  } finally { await rm(root,{recursive:true,force:true}); }
});
test('does not report successful cleanup when executable launch fails', async()=>{
 await assert.rejects(run('/no-such-toggly-executable',[],{timeoutMs:500,capture:true}),/ENOENT/);
});
