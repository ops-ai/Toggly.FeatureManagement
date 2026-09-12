import { createTogglyClient, createTogglyRequest } from '@ops-ai/solid-feature-flags-toggly/server';
import { getRequestEvent } from 'solid-js/web';
const backend=createTogglyClient({appKey:process.env.TOGGLY_BACKEND_APP_KEY,baseUrl:process.env.TOGGLY_BASE_URL,featureDefaults:{BetaDashboard:true},verifySignatures:true,enableFileCache:false,enableStreaming:false,refreshInterval:0,enableUsageTracking:false,enableMetrics:false,registerContextsOnStartup:false});
const initialized=backend.init();
export async function scope(identity:string,request=getRequestEvent()!.request){
 await initialized;
 return createTogglyRequest({client:backend,request,context:{identity,groups:identity==='alice'?['staff']:[],claims:{role:identity==='alice'?'admin':'user'}},clientContext:{identity},frontend:{appKey:process.env.VITE_TOGGLY_APP_KEY,baseURI:process.env.TOGGLY_BASE_URL,expose:['BetaDashboard','LiveFeature','ExpressCheckout'],flagDefaults:{BetaDashboard:false}}});
}
export async function requestFlags(identity:string){const flags=await scope(identity);try{return await flags.snapshot();}finally{flags.dispose();}}
