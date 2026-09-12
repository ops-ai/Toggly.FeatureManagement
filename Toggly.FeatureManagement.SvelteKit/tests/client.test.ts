import { it, expect } from 'vitest';
import {get} from 'svelte/store';
import { createToggly } from '../src/index.js';
it('hydrates synchronously, preserves entity gates and composes gate options',()=>{
 const toggly=createToggly({definitions:{on:true,off:false,Order:{requirement:'all',rules:[{property:'Vip',op:'eq',value:'true',type:'boolean'}]}},context:{},expose:['on','off','Order']});
 expect(get(toggly).definitions.on).toBe(true);
 expect(toggly.isEnabled('Order',{entity:{kind:'Order',key:'vip',attributes:{Vip:true}}})).toBe(true);
 expect(toggly.isEnabled('Order')).toBe(false);
 expect(toggly.gate(['on','off'],{requirement:'any'})).toBe(true);
 expect(toggly.gate(['on','off'],{negate:true})).toBe(true);
 expect(toggly.isEnabled('missing',{defaultValue:true})).toBe(true);
 toggly.dispose();
});
import {vi,afterEach} from 'vitest';
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
it('owns its snapshot and local gate notifications, ignores navigation after dispose and avoids transport during SSR',async()=>{
 let local=false;const initial={definitions:{on:true},context:{},expose:['on']};
 const t=createToggly(initial,{localGates:[{id:'device',flagKeys:['on'],isEnabled:()=>local}]});
 initial.definitions.on=false;expect(t.isEnabled('on')).toBe(false);
 local=true;t.notifyLocalGatesChanged();expect(t.isEnabled('on')).toBe(true);
 t.update({definitions:{off:true},context:{identity:'bob'},expose:['off']});expect(t.isEnabled('on')).toBe(false);
 await t.start(); t.dispose();t.update(initial);await t.start();expect(t.isEnabled('off')).toBe(true);
});
