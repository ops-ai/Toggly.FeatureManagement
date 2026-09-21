import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {test} from 'node:test';
import {withResources, closeServer, stopChild, ownBrowser, readHttp} from './host-resources.mjs';

async function probe(scenario) {
 const servers=[],children=[];
 const child=()=>{const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});children.push(c);return c;};
 const listener=async()=>{const s=createServer();servers.push(s);await new Promise(resolve=>s.listen(0,'127.0.0.1',resolve));return s;};
 const messages=error=>[String(error),...(error.errors??[]).flatMap(messages)].join('\n');
 try {
  if(scenario==='negative-child')child();
  if(scenario==='negative-listener')await listener();
  await assert.rejects(withResources(async defer=>{
   for(let i=0;i<2;i++){const s=await listener();defer(()=>closeServer(s));}
   const host=child();defer(()=>stopChild(host));
   if(scenario==='launch-failure')throw Error('launch failed');
   const chrome=child();ownBrowser(defer,{process:()=>chrome,close:async()=>{
    if(scenario==='close-failure')throw Error('close failed');
    if(scenario==='close-timeout')return new Promise(()=>{});
    await stopChild(chrome);
   }});
   throw Error('verification failed');
  }),error=>{
   assert.match(messages(error),scenario==='launch-failure'?/launch failed/:/verification failed/);
   if(scenario==='close-failure')assert.match(messages(error),/close failed/);
   if(scenario==='close-timeout')assert.match(messages(error),/Browser cleanup timed out/);
   return true;
  });
  assert.equal(servers.filter(s=>s.listening).length,0,'owned listener leaked');
  assert.equal(children.filter(c=>c.exitCode===null&&c.signalCode===null).length,0,'owned child leaked');
 } finally {await Promise.all(servers.map(closeServer));await Promise.all(children.map(stopChild));}
}
for(const scenario of ['launch-failure','verification-failure','close-failure','close-timeout'])
 test(`independent cleanup after ${scenario}`,{timeout:10000},()=>probe(scenario));
for(const scenario of ['negative-listener','negative-child'])
 test(`reject deliberate leak ${scenario}`,{timeout:10000},()=>assert.rejects(probe(scenario),scenario==='negative-listener'?/owned listener leaked/:/owned child leaked/));

for (const exited of [false, true]) test(`reap owned descendants with parent already exited=${exited}`, {timeout:10000}, async()=>{
 const {mkdtemp,readFile,rm}=await import('node:fs/promises');
 const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const {setTimeout:delay}=await import('node:timers/promises');
 const root=await mkdtemp(join(tmpdir(),'astro-owned-command-'));const file=join(root,'pid');
 let parent,descendant;
 const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
 try {
  parent=spawn(process.execPath,['-e',`const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});require('node:fs').writeFileSync(${JSON.stringify(file)},String(c.pid));${exited?'c.unref();':'setInterval(()=>{},1000);'}`],{stdio:'ignore',detached:true});
  for(let i=0;i<100;i++){try{descendant=Number(await readFile(file,'utf8'));break;}catch{await delay(10);}}
  assert(descendant);
  if(exited)for(let i=0;i<100&&parent.exitCode===null;i++)await delay(10);
  await stopChild(parent);
  assert.equal(alive(descendant),false,'owned descendant leaked');
 } finally {
  try{process.kill(-parent.pid,'SIGKILL');}catch{}
  await stopChild(parent);await rm(root,{recursive:true,force:true});
 }
});

for (const stage of ['headers','body']) test(`abort held HTTP ${stage} before cleanup`, {timeout:10000}, async()=>{
 let socket;
 const server=createServer((_request,response)=>{
  socket=response.socket;
  if(stage==='body'){response.writeHead(200,{'Content-Type':'text/plain'});response.write('partial');}
 });
 try {
  await assert.rejects(withResources(async defer=>{
   await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
   defer(()=>closeServer(server));
   await readHttp(`http://127.0.0.1:${server.address().port}`,100);
  }),/HTTP response timed out/);
  assert.equal(server.listening,false);
  assert.equal(socket.destroyed,true);
 } finally {await closeServer(server);}
});
test('reads the complete HTTP body within its operation deadline',async()=>{
 const server=createServer((_request,response)=>{response.writeHead(201, {'Content-Type':'text/plain'});response.end('complete');});
 try {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const response = await readHttp(`http://127.0.0.1:${server.address().port}`);
  assert.equal(response.status,201);assert.equal(response.body,'complete');
  assert.equal(response.headers.get('content-type'),'text/plain');
 } finally {await closeServer(server);}
});
