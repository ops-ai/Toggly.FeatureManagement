import {createHash, generateKeyPairSync, sign} from 'node:crypto';
const {privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'P-256'});
const raw=publicKey.export({format:'jwk'});
export const jwk={...raw,kid:createHash('sha1').update(Buffer.from(raw.x!,'base64url')).update(Buffer.from(raw.y!,'base64url')).digest('hex').toUpperCase()+'ES256',alg:'ES256',use:'sig'};
// Match the Definitions Worker: prehash once, then ES256 hashes once more.
export function envelope(defs:unknown,timestamp=Math.floor(Date.now()/1000)) {
 const json=JSON.stringify(defs);
 const first=createHash('sha256').update(json+'|'+timestamp).digest();
 return JSON.stringify({defs,signature:sign('sha256',first,{key:privateKey,dsaEncoding:'ieee-p1363'}).toString('base64'),timestamp,kid:jwk.kid});
}
