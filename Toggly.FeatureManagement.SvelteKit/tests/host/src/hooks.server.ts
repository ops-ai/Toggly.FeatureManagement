import {env} from '$env/dynamic/private';
import {createTogglyClient,createTogglyHandle} from '@ops-ai/toggly-sveltekit/server';
const client=createTogglyClient({appKey:env.TOGGLY_APP_KEY,baseUrl:env.TOGGLY_BASE_URI,verifySignatures:true,enableStreaming:false,refreshInterval:0,enableMetrics:false,enableUsageTracking:false});
await client.init();
process.once('SIGTERM',()=>{void client.close();});
export const handle=createTogglyHandle({client,context:event=>({identity:event.url.searchParams.get('user')??'alice',groups:['staff'],claims:{role:'admin',privateClaim:'server-secret'}}),clientContext:(_event,context)=>({identity:context.identity,groups:context.groups,claims:{role:context.claims!.role}}),frontend:{appKey:'frontend-fixture',baseURI:env.TOGGLY_BASE_URI,expose:['on','off','Order'],featureDefaults:{on:false}}});
