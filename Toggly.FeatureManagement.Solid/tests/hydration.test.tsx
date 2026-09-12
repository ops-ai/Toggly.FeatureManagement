import { afterEach, expect, it, vi } from 'vitest';
import { render, screen, cleanup } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { TogglyProvider, Feature, useToggly } from '../src';
import type { TogglySnapshot } from '../src/snapshot';
afterEach(cleanup);
const snapshot=(enabled:boolean):TogglySnapshot=>({definitions:{visible:enabled,secret:true},context:{identity:enabled?'alice':'bob'},expose:['visible'],source:'signed'});
it('renders the server snapshot and replaces it on client navigation', async () => {
  let navigate!:(value:TogglySnapshot)=>void;
  const Status=()=>{const t=useToggly(); return <pre data-testid="flags">{JSON.stringify(t.flags())}</pre>;};
  render(()=>{const [current,set]=createSignal(snapshot(true));navigate=set;return <TogglyProvider snapshot={current()}><Feature feature="visible" fallback={<p>Hidden</p>}><p>Visible</p></Feature><Status /></TogglyProvider>});
  expect(screen.getByText('Visible')).toBeTruthy();expect(screen.getByTestId('flags').textContent).not.toContain('secret');
  navigate(snapshot(false)); await screen.findByText('Hidden');
});

import { createClient } from '../src/client';
it('navigation aborts stale responses and keeps allowlists on subsequent refresh',async()=>{
 let resolve!:(value:Response)=>void;
 const fetcher=vi.fn().mockImplementationOnce(()=>new Promise<Response>(r=>resolve=r)).mockImplementation(()=>Promise.resolve(new Response('{"visible":false,"secret":true}')));
 const client=createClient({appKey:'test',fetch:fetcher,verifySignatures:false},snapshot(true));
 const previous=client.refresh();client.hydrate(snapshot(false));
 expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
 resolve(new Response('{"visible":true,"secret":true}'));await previous;
 expect(client.flags()).toEqual({visible:false});await client.refresh();expect(client.flags()).toEqual({visible:false});
 expect(String(fetcher.mock.calls[1][0])).toContain('u=bob');client.dispose();client.hydrate(snapshot(true));expect(client.flags()).toEqual({visible:false});
});
it('rejects malformed initial snapshot definitions',()=>{
 expect(()=>createClient({}, {...snapshot(true),definitions:[] as any})).toThrow('Invalid evaluated definitions');
});
