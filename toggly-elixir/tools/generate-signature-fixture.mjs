// Independent WebCrypto signer matching Definitions Worker semantics. No private
// key is persisted. Regenerate from the umbrella root with Node 22+.
import {webcrypto, createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
const pair=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
const jwk=await webcrypto.subtle.exportKey('jwk',pair.publicKey);
jwk.alg='ES256';
jwk.kid=createHash('sha1').update(Buffer.concat([Buffer.from(jwk.x,'base64url'),Buffer.from(jwk.y,'base64url')])).digest('hex').toUpperCase()+'ES256';
const raw='[ {"featureKey":"webcrypto", "filters":[{"name":"AlwaysOn"}], "metrics":[]} ]';
const timestamp=1700000000;
const data=new TextEncoder().encode(raw+'|'+timestamp);
const digest=await webcrypto.subtle.digest('SHA-256',data);
const signature=Buffer.from(await webcrypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},pair.privateKey,digest)).toString('base64');
const body=`{"defs":${raw},"timestamp":${timestamp},"kid":"${jwk.kid}","signature":"${signature}"}`;
writeFileSync('apps/toggly/test/fixtures/webcrypto.json',JSON.stringify({body,jwks:{keys:[jwk]}},null,2)+'\n');
