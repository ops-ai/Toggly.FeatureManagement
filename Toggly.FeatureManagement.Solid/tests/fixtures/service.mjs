import { createServer } from 'node:http';
import { generateKeyPairSync, createHash, sign } from 'node:crypto';
import { WebSocketServer } from 'ws';
const { privateKey, publicKey } = generateKeyPairSync('ec', {namedCurve:'prime256v1'});
const jwk = publicKey.export({format:'jwk'});
const kid = createHash('sha1').update(Buffer.concat([Buffer.from(jwk.x,'base64url'),Buffer.from(jwk.y,'base64url')])).digest('hex').toUpperCase()+'ES256';
export const jwks={keys:[{...jwk,kid,alg:'ES256'}]};
export function envelope(defs, encoding='der', timestamp=Math.floor(Date.now()/1000)) {
  const raw=JSON.stringify(defs);
  const digest=createHash('sha256').update(`${raw}|${timestamp}`).digest();
  return JSON.stringify({defs, timestamp,kid,signature:sign('sha256',digest,{key:privateKey,dsaEncoding:encoding}).toString('base64')});
}
export const backendDefinitions=[
 {featureKey:'backend-only-sentinel',filters:[{name:'AlwaysOn',parameters:{}}]},
 {featureKey:'BetaDashboard',filters:[{name:'Targeting',parameters:{'Audience.Users:0':'alice','Audience.DefaultRolloutPercentage':0}}]},
 {featureKey:'GroupTargeting',filters:[{name:'Targeting',parameters:{'Audience.Groups:0':'staff','Audience.DefaultRolloutPercentage':0}}]},
 {featureKey:'ClaimsTargeting',filters:[{name:'UserClaims',parameters:{Percentage:100,Claim:'role',Value:'admin'}}]},
 {featureKey:'ExpressCheckout',requirementType:'Any',contextRequirementType:'All',filters:[{name:'AlwaysOn',parameters:{}},{name:'ContextProperty',parameters:{Property:'Vip',Operator:'eq',Value:'true',ValueType:'boolean'}}]},
];
export async function startService() {
 const state={on:true,invalid:false,malformed:false,offline:false,revision:1,requests:[]};
 const server=createServer((req,res)=>{
   res.setHeader('Access-Control-Allow-Origin','*');
   res.setHeader('Access-Control-Allow-Headers','*');
   res.setHeader('Access-Control-Expose-Headers','ETag');
   if(req.method==='OPTIONS'){res.end();return;}
   const url=new URL(req.url,'http://localhost');
   state.requests.push({url:url.toString(),headers:req.headers});
   if(state.offline){res.writeHead(503).end('offline');return;}
   if(url.pathname.includes('.well-known')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(jwks));return;}
   const backend=url.pathname.includes('/definitions-signed/');
   const defs=backend?backendDefinitions:{BetaDashboard:state.on&&url.searchParams.get('u')==='alice',LiveFeature:state.on,secret:true,ExpressCheckout:{requirement:'all',rules:[{property:'Vip',op:'eq',value:'true',type:'boolean'}]}};
   const etag=`"rev${state.revision}"`;
   if(req.headers['if-none-match']===etag){res.writeHead(304).end();return;}
   res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','public,max-age=0');res.setHeader('ETag',etag);
   const payload=!backend&&state.malformed?{...defs,ExpressCheckout:{requirement:'all',rules:[{property:'Vip'}]}}:defs;
   const body=envelope(payload,backend?'der':'ieee-p1363');
   res.end(state.invalid?body.replace(/"signature":"./,'"signature":"!'):body);
 });
 const sockets=new WebSocketServer({server});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {state,baseURI:`http://127.0.0.1:${server.address().port}`,broadcast(data){for(const ws of sockets.clients)ws.send(data);}, async close(){for(const ws of sockets.clients)ws.terminate();await new Promise(resolve=>sockets.close(resolve));await new Promise(resolve=>server.close(resolve));}};
}
