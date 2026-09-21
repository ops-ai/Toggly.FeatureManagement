import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {test} from 'node:test';
import {withResources, closeServer, stopChild, ownBrowser} from './host-resources.mjs';

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
