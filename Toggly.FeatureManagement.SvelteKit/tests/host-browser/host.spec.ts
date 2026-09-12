import {test,expect} from '@playwright/test';
const definitions=process.env.TOGGLY_HOST_DEFINITIONS!;
test('packed host binds concurrent contexts, guards actions and hydrates exact signed entity snapshots',async({page,request,baseURL})=>{
 const [a,b]=await Promise.all([request.get('/server?user=alice'),request.get('/server?user=bob')]);
 expect(await a.json()).toEqual({on:true,all:false,any:true,negate:true,vip:true,noEntity:false});expect((await b.json()).on).toBe(false);
 expect((await request.get('/denied')).status()).toBe(404);
 expect((await request.post('/one?user=bob&/submit',{form:{},headers:{origin:baseURL!}})).status()).toBe(404);
 expect((await request.post('/one?user=alice&/submit',{form:{},headers:{origin:baseURL!}})).status()).toBe(200);
 const html=await (await request.get('/one?user=alice')).text();expect(html).toContain('data-testid="on"');expect(html).not.toContain('server-secret');expect(html).not.toContain('backend-private-fixture');expect(html).not.toContain('not-exposed');
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{(window as any).wrongFlash=false;new MutationObserver(()=>{if(document.querySelector('[data-testid="off"]'))(window as any).wrongFlash=true;}).observe(document,{subtree:true,childList:true});});
 await page.goto('/one?user=alice');await expect(page.getByTestId('on')).toBeVisible();await expect(page.getByTestId('vip')).toHaveText('true');await expect(page.getByTestId('no-entity')).toHaveText('false');await expect(page.getByTestId('any')).toBeVisible();await expect(page.getByTestId('negate')).toBeVisible();
 await expect.poll(async()=>(await (await request.get(definitions+'/state')).json()).active).toBe(1);
 expect(await page.evaluate(()=>(window as any).wrongFlash)).toBe(false);
 await page.getByRole('button',{name:'Local prerequisite'}).click();await expect(page.getByTestId('off')).toBeVisible();await page.getByRole('button',{name:'Local prerequisite'}).click();await expect(page.getByTestId('on')).toBeVisible();
 await page.getByRole('link',{name:'Bob',exact:true}).click();await expect(page.getByTestId('off')).toBeVisible();await expect(page.getByTestId('snapshot')).toContainText('bob');
 const connections=(await (await request.get(definitions+'/state')).json()).connections;
 await page.getByRole('link',{name:'Alice',exact:true}).click();await expect(page.getByTestId('on')).toBeVisible();
 await expect.poll(async()=>(await (await request.get(definitions+'/state')).json()).connections).toBeGreaterThan(connections);
 await expect.poll(async()=>(await (await request.get(definitions+'/state')).json()).active).toBe(1);
 // Deliberately retain r1 while changing content: forced invalidations must bypass a stale HTTP validator.
 for(const [i,message] of ['update','flags-updated',{type:'update'},{type:'flags-updated',etag:'r2'}].entries()){
  const enabled=i%2!==0;await request.post(definitions+'/control',{data:{enabled,message,revision:typeof message==='object'&&'etag'in message?'r2':'r1'}});
  try { await expect(page.getByTestId(enabled?'on':'off')).toBeVisible(); } catch(error) { console.log('Protocol state',await (await request.get(definitions+'/state')).json()); throw error; }
 }
 const before=(await (await request.get(definitions+'/state')).json()).jwks;
 await request.post(definitions+'/control',{data:{rotate:true,message:{type:'signing-key-updated'}}});await expect.poll(async()=>(await (await request.get(definitions+'/state')).json()).jwks).toBeGreaterThan(before);
 await request.post(definitions+'/control',{data:{invalid:true,message:'update'}});await page.waitForTimeout(550);await expect(page.getByTestId('on')).toBeVisible();
 await request.post(definitions+'/control',{data:{invalid:false,offline:true}});await page.waitForTimeout(350);await expect(page.getByTestId('on')).toBeVisible();
 // Throwing server observers must leave the exposed default snapshot usable.
 const offlineSSR=await request.get('/one?user=alice');expect(offlineSSR.status()).toBe(200);expect(await offlineSSR.text()).toContain('data-testid="off"');
 await request.post(definitions+'/control',{data:{offline:false,delayUser:'alice',message:'update'}});await page.waitForTimeout(330);await page.getByRole('link',{name:'Bob',exact:true}).click();await expect(page.getByTestId('off')).toBeVisible();await page.waitForTimeout(750);await expect(page.getByTestId('off')).toBeVisible();
 await page.getByRole('button',{name:'Toggle owner'}).click();await expect.poll(async()=>(await (await request.get(definitions+'/state')).json()).active).toBe(0);
 const state=await (await request.get(definitions+'/state')).json();await page.waitForTimeout(400);expect((await (await request.get(definitions+'/state')).json()).requests.length).toBe(state.requests.length);
 const evaluated=state.requests.filter((r:any)=>r.path.startsWith('/evaluated-signed/'));expect(evaluated.some((r:any)=>r.pin==='r2'&&r.revision===null)).toBe(true);expect(evaluated.some((r:any)=>r.claims==='admin'&&r.groups.includes('staff'))).toBe(true);
 expect(errors).toEqual([]);
});
