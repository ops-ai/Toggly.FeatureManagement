// No Node, filesystem or trusted server dependencies: this module executes in a browser.
const decode = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
export async function verify(definitions, timestamp, signature, kid, jwksJson) {
  try {
    const keys = JSON.parse(jwksJson).keys.filter(key => key.kid === kid);
    if (keys.length !== 1) return false;
    const key = keys[0];
    if (key.kty !== 'EC' || key.crv !== 'P-256' || key.alg !== 'ES256') return false;
    const x = decode(key.x), y = decode(key.y);
    if (x.length !== 32 || y.length !== 32) return false;
    const point = new Uint8Array([...x, ...y]);
    const fingerprint = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-1', point)), b => b.toString(16).padStart(2, '0')).join('').toUpperCase() + 'ES256';
    if (fingerprint !== kid) return false;
    const imported = await crypto.subtle.importKey('jwk', key, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    // Worker signs SHA256(raw definitions + timestamp) using ECDSA/SHA256.
    // WebCrypto applies the second SHA256 internally; it expects P1363 signatures.
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(definitions + '|' + timestamp));
    return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, imported, decode(signature), digest);
  } catch { return false; }
}
export function load(contextKey) {
  try { return JSON.parse(sessionStorage.getItem('toggly:' + contextKey)); } catch { return null; }
}
export function save(contextKey, snapshot) {
  try { sessionStorage.setItem('toggly:' + contextKey, JSON.stringify(snapshot)); } catch { /* Storage denial/quota must not stop evaluation. */ }
}
