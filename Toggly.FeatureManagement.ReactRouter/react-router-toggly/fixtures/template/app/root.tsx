import {useEffect, useState} from 'react';
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from 'react-router';
import { RouterTogglyProvider } from '@ops-ai/react-router-toggly/client';
import { toggly } from './toggly.server';

export async function loader(args: { request: Request }) {
  return toggly.getLoaderData(args);
}

export default function App() {
  const [mounted,setMounted]=useState(true);
  const [replacement,setReplacement]=useState(false);
  useEffect(()=>{Object.assign(window,{host:{unmount:()=>setMounted(false),remount:()=>setMounted(true),replace:()=>setReplacement(true)}});},[]);
  const config={appKey:replacement?'replacement':'host-test-key',environment:replacement?'New':'Development',
    baseUrl:typeof window==='undefined'?'http://127.0.0.1:9':window.location.origin+'/definitions-fixture',
    metricsBaseUrl:typeof window==='undefined'?undefined:new URLSearchParams(window.location.search).get('metrics')??undefined};
  return (
    <html lang="en">
      <head>
        <Meta />
        <link rel="icon" href="data:," />
        <Links />
      </head>
      <body>
        {mounted && <RouterTogglyProvider routeId="root" config={config}>
          <Outlet />
        </RouterTogglyProvider>}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
