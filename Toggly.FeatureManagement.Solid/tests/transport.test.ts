import { expect, it, vi } from 'vitest';
import { captureEvaluatedResponse } from '../src/transport';
it.each(['string','url','request'])('captures exact evaluated bytes from %s inputs without consuming responses',async representation=>{
 const url='https://fixture.test/evaluated-signed/app/Production';
 const input=representation==='string'?url:representation==='url'?new URL(url):new Request(url);
 const capture=captureEvaluatedResponse(vi.fn(async()=>new Response('{ "visible": true }')));
 const response=await capture.fetch(input);expect(capture.body()).toBe('{ "visible": true }');expect(await response.text()).toBe('{ "visible": true }');
});
it('never persists JWKS or unsuccessful response bodies',async()=>{
 const capture=captureEvaluatedResponse(vi.fn(async()=>new Response('error',{status:500})));
 await capture.fetch('https://fixture.test/evaluated-signed/app/Production');expect(capture.body()).toBeUndefined();
 const keys=captureEvaluatedResponse(vi.fn(async()=>new Response('{"keys":[]}')));
 await keys.fetch('https://fixture.test/.well-known/jwks');expect(keys.body()).toBeUndefined();
});
