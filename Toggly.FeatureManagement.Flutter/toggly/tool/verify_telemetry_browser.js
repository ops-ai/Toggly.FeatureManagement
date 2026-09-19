async (page) => {
  const assert = {equal:(a,b)=>{if(a!==b)throw Error(`Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`)},ok:v=>{if(!v)throw Error('Assertion failed')},deepEqual:(a,b)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw Error('Array mismatch')}};
  const context=await page.context().browser().newContext();
  try {
    page=await context.newPage();
    const evidence = [];
    for (const crossOrigin of [false,true]) {
      await page.context().addCookies([{name:'must-not-be-sent',value:'loopback-cookie',url:'http://127.0.0.1:18765'}]);
      await page.addInitScript(() => {
        if(window.telemetryFetchInstrumented)return;
        window.telemetryFetchInstrumented=true;
        window.telemetryFetches=[];
        const fetch=window.fetch;
        window.fetch=function(url, options) {
          if(String(url).includes('/api/frontend/telemetry')) {
            window.telemetryFetches.push({credentials:options.credentials,keepalive:options.keepalive,headers:options.headers});
          }
          return fetch.apply(this,arguments);
        };
      });
      await page.goto(`http://127.0.0.1:18765/${crossOrigin?'?metrics=http://127.0.0.1:18766':''}`);
      await page.waitForFunction(()=>window.telemetryStatus==='ready');
      assert.ok(await page.evaluate(()=>document.cookie.includes('must-not-be-sent=loopback-cookie')));
      const start=(await (await page.request.get('http://127.0.0.1:18765/records')).json()).length;
      const command=async(action)=>{
        await page.evaluate(action=>window.telemetryCommand(action),action);
        await page.waitForFunction(()=>window.telemetryStatus==='done');
      };
      await command('normal');
      await page.evaluate(()=>{window.CompressionStream=undefined;});
      await command('fallback');
      await command('queue');
      await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('pagehide'));});
      await page.waitForFunction(()=>window.telemetryFetches.length===3);
      await command('queue');
      await command('dispose');
      await page.waitForFunction(()=>window.telemetryFetches.length===4);
      await command('after');
      await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
      await page.waitForTimeout(150);
      const fetches=await page.evaluate(()=>window.telemetryFetches);
      assert.equal(fetches.length,4);
      assert.ok(fetches.every(f=>f.credentials==='omit'));
      assert.deepEqual(fetches.map(f=>f.keepalive),[false,false,true,true]);
      const records=(await(await page.request.get('http://127.0.0.1:18765/records')).json()).slice(start);
      const posts=records.filter(r=>r.method==='POST');
      assert.equal(posts.length,4);
      assert.ok(posts.every(r=>r.cookie===null && r.bytes<=49152 && r.path==='/api/frontend/telemetry'));
      assert.equal(posts[0].encoding,'gzip');assert.equal(posts[0].body.i,'loopback-token');
      assert.equal(posts[1].encoding,null);assert.equal(posts[1].body.u,'alice');assert.equal(posts[1].body.i,undefined);
      assert.ok(posts.slice(2).every(r=>r.encoding===null && r.body.u==='alice'));
      if(crossOrigin)assert.ok(records.some(r=>r.method==='OPTIONS'));
      evidence.push({crossOrigin,fetches,preflights:records.filter(r=>r.method==='OPTIONS').length,posts:posts.map(r=>({...r,body:{k:r.body.k,e:r.body.e,i:r.body.i,u:r.body.u,metrics:r.body.m,featureCount:Object.keys(r.body.f||{}).length}}))});
    }
    const browser=page.context().browser().version();
    return {browser,scenarios:evidence};
  } finally {
    await context.close();
  }
}
